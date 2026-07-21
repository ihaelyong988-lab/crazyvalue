/**
 * 법원경매정보(courtauction.go.kr) 수집기 — 유찰 2회 이상 전국 물건.
 *
 * 흐름(docs/CRAWLER.md 전략 A):
 *   1) GET /pgj/index.on 으로 JSESSIONID 세션 취득
 *   2) POST searchControllerMain.on — flbdNcntMin=2·전국(cortOfcCd 공백)·매각기일 창 오늘+42일, pageSize 40 페이지네이션
 *   3) 물건별 POST selectAuctnCsSrchRslt.on — 기일 이력(gdsDspslDxdyLst)·매수보증금비율(prchDposRate) 취득.
 *      실패 시 그 물건만 유찰횟수·저감율 역산 폴백(buildBackcalcHistory 주석 참조)
 *   4) 검증 게이트(전건 zod·건수>0·id 중복 0) 통과 시에만 public/data/{region}.json 17개 + meta.json 기록.
 *      실패 시 기존 파일 무변경 exit 1 — 앱은 직전 데이터로 동작한다(PLAN §5.4)
 *
 * 예절(CRAWLER.md §4): 요청 간격 ≥1.1초 · UA CrazyValueBot/0.1 · 재시도 3회 지수 백오프 ·
 *   HTTP 550/errors 봉투·로봇탐지(ipcheck=false)는 즉시 중단.
 *
 * 실행: npm run crawl [-- --region <key>] [--dry-run] [--limit <n>]
 *   --region  해당 시·도만 산출(요청은 전국 조회 동일 — 소재지 검색 모드는 미실측이라 서버측 지역 필터를
 *             쓰지 않고 응답을 클라이언트에서 거른다. 쓰기 모드에서는 해당 지역 파일과 meta만 갱신)
 *   --dry-run 쓰기 없음 · 검색 1페이지만 조회(수집 로직·계약 검증용)
 *   --limit   물건 수 상한(상세 요청 수 제한용)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AuctionItemSchema,
  REGIONS,
  regionNameByKey,
  type AuctionItem,
  type HistoryEntry,
  type Meta,
} from "../src/types/auction";
import {
  BASE_URL,
  CATEGORY_RULES,
  COURT_BY_CODE,
  DETAIL_URL,
  DXDY,
  ENDPOINTS,
  LAND_EXACT,
  POLITENESS,
  REGION_KEY_BY_SD_CD,
  REGION_KEY_BY_SIDO_PREFIX,
  SEARCH,
  SEARCH_INFO_KEYS,
  USER_AGENT,
} from "./crawl-config";

// ---------------------------------------------------------------------------
// CLI 옵션
// ---------------------------------------------------------------------------

interface CliOptions {
  region: string | null;
  dryRun: boolean;
  limit: number | null;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { region: null, dryRun: false, limit: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--region") {
      const v = argv[++i];
      if (!v || !REGIONS.some((r) => r.key === v)) {
        console.error(`--region 값이 올바르지 않습니다. 사용 가능: ${REGIONS.map((r) => r.key).join(", ")}`);
        process.exit(1);
      }
      opts.region = v;
    } else if (arg === "--limit") {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v <= 0) {
        console.error("--limit 값은 1 이상의 정수여야 합니다.");
        process.exit(1);
      }
      opts.limit = v;
    } else {
      console.error(`알 수 없는 옵션입니다: ${arg}`);
      process.exit(1);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// KST 날짜 유틸 — 수집 기준 시각은 항상 Asia/Seoul(UTC+9)
// ---------------------------------------------------------------------------

const KST_OFFSET_MS = 9 * 3600_000;

/** KST 현재 시각의 구성요소를 UTC getter로 읽기 위한 시프트된 Date */
function kstNow(): Date {
  return new Date(Date.now() + KST_OFFSET_MS);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** KST 기준 오늘+offsetDays 를 YYYYMMDD 로 */
function ymdKst(offsetDays: number): string {
  const d = new Date(Date.now() + KST_OFFSET_MS + offsetDays * 86_400_000);
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`;
}

/** KST 현재를 +09:00 오프셋 포함 ISO 문자열로 */
function isoKstNow(): string {
  const d = kstNow();
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}+09:00`
  );
}

/** 다음 일요일 03:00 KST(주간 cron `0 18 * * 6` UTC의 다음 실행 시각) */
function nextSundayThreeAmKst(): string {
  const now = kstNow();
  const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 0, 0));
  candidate.setUTCDate(candidate.getUTCDate() + ((7 - candidate.getUTCDay()) % 7));
  if (candidate.getTime() <= now.getTime()) candidate.setUTCDate(candidate.getUTCDate() + 7);
  return (
    `${candidate.getUTCFullYear()}-${pad2(candidate.getUTCMonth() + 1)}-${pad2(candidate.getUTCDate())}` +
    `T03:00:00+09:00`
  );
}

/** "20260812" → "2026-08-12" (형식 불일치 시 null) */
function ymdToIso(ymd: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(ymd);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** "1000"·"930" → "10:00"·"09:30" (형식 불일치 시 "") */
function hmToClock(hm: string): string {
  const digits = hm.replace(/\D/g, "");
  if (digits.length < 3 || digits.length > 4) return "";
  const p = digits.padStart(4, "0");
  return `${p.slice(0, 2)}:${p.slice(2)}`;
}

const addDaysIso = (dateOnly: string, days: number): string =>
  new Date(Date.parse(`${dateOnly}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// 성명 마스킹 — specialNote의 자연인 성명 비식별화(PLAN §13 규칙 2)
// ---------------------------------------------------------------------------

const ROLE_WORDS = "채무자|소유자|임차인|공유자";

/**
 * 성명이 아닌 상투 문구 화이트리스트 — "임차인 존재"·"소유자 점유"류의 오마스킹을 막는다.
 * 성명일 수 없는 단어만 넣는다(의심 시 마스킹하는 쪽이 안전).
 */
const NON_NAME_WORDS = new Set([
  "있음", "없음", "존재", "점유", "미상", "불명", "여부", "현황", "확인", "제외", "포함",
  "대항", "대항력", "전입", "배당", "보증금", "임대차", "지분", "전부", "일부", "겸용",
]);

/** 성명 뒤에 붙을 수 있는 조사 — 이 경계까지를 성명으로 본다("최미영으로부터" → 최미영) */
const PARTICLES = "으로부터|로부터|에게서|으로|에게|에서|한테|부터|까지|와|과|의|은|는|이|가|을|를|도|만";

/**
 * 역할어(채무자·소유자·임차인·공유자, "채무자 겸 소유자" 복합형 포함) 뒤에 붙는
 * 한글 2~4자 성명을 첫 글자+** 로 마스킹한다. 예) "채무자 홍길동" → "채무자 홍**".
 * 성명 자리에 또 다른 역할어·상투 문구가 오는 경우는 마스킹하지 않는다(오마스킹 방지).
 */
export function maskNames(text: string): string {
  const re = new RegExp(
    `(${ROLE_WORDS})((?:\\s*겸\\s*(?:${ROLE_WORDS}))*)([\\s:：·,.]*)(?!(?:${ROLE_WORDS})(?![가-힣]))` +
      `([가-힣]{2,4}?)(?=$|[^가-힣]|(?:${PARTICLES})(?![가-힣]))`,
    "g",
  );
  return text.replace(re, (m, role: string, roleMore: string, sep: string, name: string) => {
    if (NON_NAME_WORDS.has(name)) return m;
    return `${role}${roleMore}${sep}${name[0]}**`;
  });
}

// ---------------------------------------------------------------------------
// HTTP 계층 — 쿠키 유지·간격 1.1초·재시도 3회·차단 신호 즉시 중단
// ---------------------------------------------------------------------------

/** 사이트가 수집 중단을 요구하는 신호(550/errors 봉투·로봇탐지) — 재시도 없이 전체 중단 */
class CrawlAbortError extends Error {}

const cookieJar = new Map<string, string>();

function absorbCookies(res: Response): void {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headers.getSetCookie?.() ?? (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
  for (const line of setCookies) {
    const pair = line.split(";", 1)[0];
    const eq = pair.indexOf("=");
    if (eq > 0) cookieJar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}

function cookieHeader(): string {
  return [...cookieJar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

let lastRequestAt = 0;
let liveRequestCount = 0;

async function politeDelay(): Promise<void> {
  const wait = lastRequestAt + POLITENESS.minIntervalMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

interface PoliteInit {
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

/**
 * 예절 규칙이 적용된 단일 요청. 네트워크 오류·타임아웃·5xx(550 제외)는
 * POLITENESS.backoffsMs 지수 백오프로 최대 3회 재시도한다.
 * HTTP 550 또는 body에 errors 봉투가 오면 사이트의 거절 신호로 보고 즉시 전체 중단한다.
 */
async function request(path: string, init: PoliteInit): Promise<{ status: number; text: string }> {
  let attempt = 0;
  for (;;) {
    await politeDelay();
    lastRequestAt = Date.now();
    liveRequestCount++;
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: init.method,
        body: init.body,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json, text/plain, */*",
          ...(cookieJar.size > 0 ? { Cookie: cookieHeader() } : {}),
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(POLITENESS.timeoutMs),
        redirect: "follow",
      });
      absorbCookies(res);
      const text = await res.text();
      if (res.status === 550) {
        throw new CrawlAbortError(`HTTP 550 거절 응답 — 즉시 중단: ${text.slice(0, 200)}`);
      }
      if (res.status >= 500 || res.status === 429) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (res.status >= 400) {
        throw new CrawlAbortError(`HTTP ${res.status} — 요청 구성 오류 가능성, 중단: ${text.slice(0, 200)}`);
      }
      return { status: res.status, text };
    } catch (err) {
      if (err instanceof CrawlAbortError) throw err;
      if (attempt >= POLITENESS.retries) {
        throw new Error(`요청 실패(재시도 ${POLITENESS.retries}회 소진) ${path}: ${String(err)}`);
      }
      const backoff = POLITENESS.backoffsMs[Math.min(attempt, POLITENESS.backoffsMs.length - 1)];
      console.error(`[재시도 ${attempt + 1}/${POLITENESS.retries}] ${path} — ${String(err)} · ${backoff}ms 대기`);
      await new Promise((r) => setTimeout(r, backoff));
      attempt++;
    }
  }
}

interface Envelope {
  data?: Record<string, unknown>;
  errors?: { errorMessage?: string };
}

/** JSON POST + 봉투 검사(errors·로봇탐지 ipcheck=false → 즉시 중단) */
async function postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
  const { text } = await request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8", Referer: `${BASE_URL}/pgj/index.on` },
    body: JSON.stringify(body),
  });
  let parsed: Envelope;
  try {
    parsed = JSON.parse(text) as Envelope;
  } catch {
    throw new Error(`JSON 파싱 실패 ${path}: ${text.slice(0, 120)}`);
  }
  if (parsed.errors) {
    throw new CrawlAbortError(`errors 봉투 수신 — 즉시 중단: ${parsed.errors.errorMessage ?? JSON.stringify(parsed.errors)}`);
  }
  const data = parsed.data;
  if (!data || typeof data !== "object") throw new Error(`data 봉투 없음 ${path}`);
  // PGJ15BM01.xml 실측: data.ipcheck는 로봇탐지 통과 플래그(참=정상). 명시적 false는 차단 신호다.
  if ("ipcheck" in data && data.ipcheck === false) {
    throw new CrawlAbortError("로봇탐지(ipcheck=false) — 즉시 중단");
  }
  return data;
}

// ---------------------------------------------------------------------------
// 응답 행 접근 헬퍼 — 필드명은 PGJ151M01.xml dlt_srchResult columnInfo 실측(crawl-config 주석)
// ---------------------------------------------------------------------------

type RawRow = Record<string, unknown>;

function str(row: RawRow, key: string): string {
  const v = row[key];
  return v == null ? "" : String(v).trim();
}

function num(row: RawRow, key: string): number {
  const raw = str(row, key).replace(/,/g, "");
  if (raw === "") return NaN;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

/** 표시 셀 텍스트 정리 — 실측상 printCsNo 등에 <br/> 마크업이 섞여 온다(dry-run 표본) */
function stripTags(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 비고류 텍스트 정리: HTML 태그·연속 공백 제거 후 성명 마스킹 */
function cleanNote(raw: string): string | null {
  const cleaned = stripTags(raw);
  return cleaned === "" ? null : maskNames(cleaned);
}

// ---------------------------------------------------------------------------
// 도메인 매핑
// ---------------------------------------------------------------------------

/** 매각용도명 → 앱 카테고리(첫 일치). 단일 지목은 완전일치만 토지 처리(오탐 방지) */
function toCategory(usageName: string): AuctionItem["category"] {
  if (LAND_EXACT.has(usageName)) return "토지";
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(usageName)) return rule.category as AuctionItem["category"];
  }
  return "기타";
}

/** region 판정 — 주소(행정구역명)·시도코드 우선, 법원 코드는 최후 폴백(config 표 주석 참조) */
function resolveRegionKey(row: RawRow): string | null {
  const sido = str(row, "hjguSido") || str(row, "printSt") || str(row, "realSt");
  for (const [prefix, key] of REGION_KEY_BY_SIDO_PREFIX) {
    if (sido.startsWith(prefix)) return key;
  }
  const sdCd = str(row, "daepyoSidoCd").slice(0, 2);
  if (sdCd && REGION_KEY_BY_SD_CD[sdCd]) return REGION_KEY_BY_SD_CD[sdCd];
  const court = COURT_BY_CODE[str(row, "boCd")];
  return court ? court.regionKey : null;
}

/** 주소에서 시·군·구 추출 — "수원시 영통구"처럼 시+구/군 2단은 결합 */
function parseDistrict(address: string): string {
  const parts = address.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return "";
  if (/시$/.test(parts[1]) && parts.length >= 3 && /(구|군)$/.test(parts[2])) {
    return `${parts[1]} ${parts[2]}`;
  }
  return parts[1];
}

/** 면적 문자열(areaList 등)에서 첫 숫자(㎡)를 뽑는다. 확신 없으면 null(스키마 허용) */
function firstArea(raw: string): number | null {
  const m = /(\d+(?:\.\d+)?)/.exec(raw.replace(/,/g, ""));
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// ---------------------------------------------------------------------------
// 검색(목록) 수집
// ---------------------------------------------------------------------------

function buildSearchInfo(): Record<string, string> {
  // 브라우저는 dataMap의 키 전부를 직렬화하므로 동일하게 전체 키를 빈 문자열로 채운다(crawl-config 주석).
  const info: Record<string, string> = {};
  for (const key of SEARCH_INFO_KEYS) info[key] = "";
  info.cortAuctnSrchCondCd = SEARCH.cortAuctnSrchCondCd;
  info.mvprpRletDvsCd = SEARCH.mvprpRletDvsCd;
  info.bidDvsCd = SEARCH.bidDvsCd;
  info.cortStDvs = SEARCH.cortStDvs;
  info.cortOfcCd = ""; // 공백 = 전국(CRAWLER.md §2.6 1안)
  info.flbdNcntMin = SEARCH.flbdNcntMin;
  info.bidBgngYmd = ymdKst(0);
  info.bidEndYmd = ymdKst(SEARCH.windowDays);
  info.pgmId = SEARCH.pgmId;
  info.statNum = "1"; // CRAWLER.md §2.3 실측 예시 값
  info.notifyLoc = "off";
  return info;
}

interface SearchPage {
  rows: RawRow[];
  totalCnt: number;
}

async function fetchSearchPage(searchInfo: Record<string, string>, pageNo: number, knownTotal: number): Promise<SearchPage> {
  const body = {
    dma_pageInfo: {
      pageNo,
      pageSize: SEARCH.pageSize,
      startRowNo: (pageNo - 1) * SEARCH.pageSize,
      totalYn: "Y",
      totalCnt: knownTotal,
    },
    dma_srchGdsDtlSrchInfo: searchInfo,
  };
  const data = await postJson(ENDPOINTS.search, body);
  const rows = Array.isArray(data.dlt_srchResult) ? (data.dlt_srchResult as RawRow[]) : [];
  const pageInfo = (data.dma_pageInfo ?? {}) as RawRow;
  const totalCnt = num(pageInfo, "totalCnt");
  return { rows, totalCnt: Number.isFinite(totalCnt) ? totalCnt : rows.length };
}

// ---------------------------------------------------------------------------
// 상세(기일 이력) 수집
// ---------------------------------------------------------------------------

interface DetailResult {
  dxdyRows: RawRow[]; // gdsDspslDxdyLst — 회차별 기일 이력(실데이터)
  saleInfo: RawRow; // dspslGdsDxdyInfo — 매수보증금비율·기일 시각·장소
}

async function fetchDetail(row: RawRow, searchInfo: Record<string, string>): Promise<DetailResult | null> {
  // PGJ151M01.xml moveDtlPage 실측: csNo=srnSaNo, cortOfcCd=boCd, dspslGdsSeq=maemulSer,
  // srchInfo는 검색조건 전체(sideDvsCd 미지정 시 '2'). 요청 봉투 키는 dma_srchGdsDtlSrch(PGJ15BM01.xml).
  const body = {
    dma_srchGdsDtlSrch: {
      csNo: str(row, "srnSaNo") || str(row, "saNo"),
      cortOfcCd: str(row, "boCd"),
      dspslGdsSeq: str(row, "maemulSer"),
      pgmId: SEARCH.pgmId,
      srchInfo: { ...searchInfo, sideDvsCd: "2" },
    },
  };
  try {
    const data = await postJson(ENDPOINTS.detail, body);
    const result = (data.dma_result ?? {}) as RawRow;
    const dxdyRows = Array.isArray(result.gdsDspslDxdyLst) ? (result.gdsDspslDxdyLst as RawRow[]) : [];
    const saleInfo = (result.dspslGdsDxdyInfo ?? {}) as RawRow;
    return { dxdyRows, saleInfo };
  } catch (err) {
    if (err instanceof CrawlAbortError) throw err; // 차단 신호는 폴백 없이 전체 중단
    console.error(`[상세 실패 → 역산 폴백] ${str(row, "printCsNo")}-${str(row, "maemulSer")}: ${String(err)}`);
    return null;
  }
}

/**
 * 유찰 결과코드 런타임 자가 보정(crawl-config DXDY 주석) —
 * 화면은 공통코드 캐시로 번역해 정적 XML에 유찰 코드값이 없다. 유찰 2회 이상 물건만 수집하므로
 * 과거 매각기일 행에서 가장 빈번한 비매각(≠001) 결과코드가 곧 유찰 코드다.
 */
function calibrateFailedCode(details: (DetailResult | null)[], todayYmd: string): string {
  const freq = new Map<string, number>();
  for (const d of details) {
    if (!d) continue;
    for (const r of d.dxdyRows) {
      if (str(r, "auctnDxdyKndCd") !== DXDY.KND_SALE) continue;
      if (str(r, "dxdyYmd") >= todayYmd) continue;
      const code = str(r, "auctnDxdyRsltCd");
      if (code === "" || code === DXDY.RSLT_SOLD) continue;
      freq.set(code, (freq.get(code) ?? 0) + 1);
    }
  }
  let best = DXDY.RSLT_FAILED_DEFAULT as string;
  let bestCount = 0;
  for (const [code, count] of freq) {
    if (count > bestCount) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

/**
 * 실데이터 기일 이력 구성 — 과거 매각기일(knd=01) 행을 시간순으로 유찰/변경으로 분류한다.
 * 매각(001) 전력 행(재매각 사건)은 스키마 enum 제약상 "변경"으로 기록한다.
 * 분류된 유찰 수가 검색 응답의 유찰횟수와 다르면 null을 돌려 역산 폴백으로 넘긴다(계약 §superRefine).
 */
function buildRealHistory(detail: DetailResult, failCount: number, todayYmd: string, failedCode: string): HistoryEntry[] | null {
  const past = detail.dxdyRows
    .filter(
      (r) =>
        str(r, "auctnDxdyKndCd") === DXDY.KND_SALE &&
        str(r, "dxdyYmd") !== "" &&
        str(r, "dxdyYmd") < todayYmd &&
        str(r, "auctnDxdyRsltCd") !== "",
    )
    .sort((a, b) => str(a, "dxdyYmd").localeCompare(str(b, "dxdyYmd")));
  if (past.length === 0) return null;

  const entries: HistoryEntry[] = [];
  for (const r of past) {
    const date = ymdToIso(str(r, "dxdyYmd"));
    const price = num(r, "tsLwsDspslPrc");
    if (!date || !Number.isInteger(price) || price <= 0) return null;
    entries.push({ date, minPrice: price, result: str(r, "auctnDxdyRsltCd") === failedCode ? "유찰" : "변경" });
  }
  const fails = entries.filter((e) => e.result === "유찰").length;
  return fails === failCount ? entries : null;
}

/**
 * 역산 폴백(사양 ② 명기) — 상세 취득 실패 시 검색 응답만으로 이력을 재구성한다.
 * 회차별 저감율 r 은 minPrice = appraisal × (1-r)^failCount 에서 역산하고,
 * 기일 간격은 통상 회차 간격(약 35일)로 추정한다(gen-mock.ts 선례와 동일 형태·날짜는 추정치).
 */
function buildBackcalcHistory(appraisal: number, minPrice: number, failCount: number, saleDate: string): HistoryEntry[] {
  const rate = 1 - Math.pow(minPrice / appraisal, 1 / failCount);
  const entries: HistoryEntry[] = [
    { date: addDaysIso(saleDate, -35 * (failCount + 1)), minPrice: appraisal, result: "신건" },
  ];
  for (let k = 1; k <= failCount; k++) {
    entries.push({
      date: addDaysIso(saleDate, -35 * (failCount + 1 - k)),
      minPrice: Math.max(1, Math.round(appraisal * Math.pow(1 - rate, k - 1))),
      result: "유찰",
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// 행 → AuctionItem 매핑
// ---------------------------------------------------------------------------

interface MapOutcome {
  item: AuctionItem | null;
  skipReason: string | null;
  historySource: "실취득" | "역산" | null;
}

function mapRow(row: RawRow, detail: DetailResult | null, todayYmd: string, failedCode: string): MapOutcome {
  // printCsNo는 "법원명<br/>2008타경25092<br/>…(중복)" 형태의 표시 셀(dry-run 실측) — 대표 사건번호만 추출한다.
  const caseNo = /\d{4}타경\d+/.exec(str(row, "printCsNo"))?.[0] ?? "";
  const itemNo = str(row, "maemulSer");
  const address = stripTags(str(row, "printSt") || str(row, "realSt"));
  const appraisal = num(row, "gamevalAmt");
  const failCount = num(row, "yuchalCnt");
  const saleYmdRaw = str(row, "maeGiil");
  const saleDate = ymdToIso(saleYmdRaw);

  // 현재(다음) 회차 최저매각가격 — 실측상 minmaePrice는 직전 회차 가격으로 관측되었다(dry-run:
  // minmaePrice=감정가 194,000,000 · 다가오는 회차 tsLwsDspslPrc=155,200,000). 매각기일과 일치하는
  // 기일 이력 행의 가격을 최우선으로, 공고 1차 가격(notifyMinmaePrice1)·상세 공고가·목록가 순으로 폴백한다.
  const upcomingSameDay = (detail?.dxdyRows ?? []).find(
    (r) => str(r, "auctnDxdyKndCd") === DXDY.KND_SALE && str(r, "dxdyYmd") === saleYmdRaw,
  );
  const priceCandidates = [
    upcomingSameDay ? num(upcomingSameDay, "tsLwsDspslPrc") : NaN,
    num(row, "notifyMinmaePrice1"),
    detail ? num(detail.saleInfo, "fstPbancLwsDspslPrc") : NaN,
    num(row, "minmaePrice"),
  ];
  const minPrice = priceCandidates.find((v) => Number.isInteger(v) && v > 0) ?? NaN;

  if (!caseNo || !itemNo || !address) return { item: null, skipReason: "식별자·주소 결측", historySource: null };
  if (!Number.isInteger(appraisal) || appraisal <= 0 || !Number.isInteger(minPrice) || minPrice <= 0) {
    return { item: null, skipReason: "가격 결측", historySource: null };
  }
  // 서버측 flbdNcntMin=2 필터의 안전망 재검(CRAWLER.md §2.6 폴백)
  if (!Number.isInteger(failCount) || failCount < 2) return { item: null, skipReason: "유찰 2회 미만", historySource: null };
  if (minPrice > appraisal) return { item: null, skipReason: "최저가>감정가(계약 밖 표본)", historySource: null };
  if (!saleDate) return { item: null, skipReason: "매각기일 결측", historySource: null };
  // 검색 창(bidBgngYmd~) 서버 필터의 안전망 — 창 회귀 시 기일 경과 물건 유입을 차단한다.
  if (saleYmdRaw < todayYmd) return { item: null, skipReason: "기일 경과", historySource: null };

  const regionKey = resolveRegionKey(row);
  if (!regionKey) return { item: null, skipReason: "지역 판정 불가", historySource: null };
  const district = str(row, "hjguSigu") || parseDistrict(address) || (regionKey === "sejong" ? "세종시" : "");
  if (!district) return { item: null, skipReason: "시·군·구 판정 불가", historySource: null };
  const court = COURT_BY_CODE[str(row, "boCd")]?.name || stripTags(str(row, "jiwonNm"));
  if (!court) return { item: null, skipReason: "법원명 결측", historySource: null };

  const saleInfo = detail?.saleInfo ?? {};
  const upcoming =
    upcomingSameDay ??
    (detail?.dxdyRows ?? []).find((r) => str(r, "auctnDxdyKndCd") === DXDY.KND_SALE && str(r, "dxdyYmd") >= todayYmd);

  const realHistory = detail ? buildRealHistory(detail, failCount, todayYmd, failedCode) : null;
  const history = realHistory ?? buildBackcalcHistory(appraisal, minPrice, failCount, saleDate);

  // 매수신청보증금 — 상세의 비율(prchDposRate)과 사이트 동일 산식(100원 단위 올림, PGJ15BM01.xml 실측).
  // 상세 미취득 시 기본 최저매각가격의 10%(민사집행규칙 제63조 기본 보증금)로 계산한다.
  const rateRaw = num(saleInfo, "prchDposRate");
  const depositRate = Number.isFinite(rateRaw) && rateRaw > 0 ? rateRaw : 10;
  const deposit = Math.ceil((minPrice * depositRate) / 100 / 100) * 100;

  const usage = str(row, "dspslUsgNm");
  const category = toCategory(usage);
  const areaRaw = str(row, "areaList");
  const area = firstArea(areaRaw);
  const isLand = category === "토지";

  const item: AuctionItem = {
    id: `${regionKey}-${caseNo}-${itemNo}`,
    court,
    caseNo,
    itemNo,
    category,
    address,
    region: regionNameByKey[regionKey],
    district,
    appraisalPrice: appraisal,
    minPrice,
    priceRatio: Number((minPrice / appraisal).toFixed(4)),
    failCount,
    saleDate,
    saleTime: hmToClock(str(row, "maeHh1")) || hmToClock(str(upcoming ?? {}, "dxdyHm")) || hmToClock(str(saleInfo, "fstDspslHm")),
    courtRoom: stripTags(str(row, "maePlace") || str(upcoming ?? {}, "dxdyPlcNm") || str(saleInfo, "dspslPlcNm")),
    deposit,
    areaBuilding: isLand ? null : area,
    areaLand: isLand ? area : null,
    photoUrl: null, // MVP는 무사진(핫링크 리스크, CRAWLER.md §4) — 화면은 용도별 플레이스홀더
    detailUrl: DETAIL_URL,
    history,
    specialNote: cleanNote(str(row, "mulBigo")),
  };
  return { item, skipReason: null, historySource: realHistory ? "실취득" : "역산" };
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const todayYmd = ymdKst(0);

  console.log(
    `수집 시작 — 대상 전국 유찰 2회 이상 · 매각기일 창 ${ymdKst(0)}~${ymdKst(SEARCH.windowDays)}` +
      `${opts.region ? ` · 지역 ${opts.region}` : ""}${opts.dryRun ? " · dry-run(쓰기 없음·1페이지)" : ""}` +
      `${opts.limit ? ` · limit ${opts.limit}` : ""}`,
  );

  // 1) 세션 취득 — JSESSIONID 쿠키(CRAWLER.md §2.2)
  await request(ENDPOINTS.session, { method: "GET" });
  if (!cookieJar.has("JSESSIONID")) {
    console.error("세션 쿠키(JSESSIONID) 미취득 — 중단합니다.");
    process.exit(1);
  }

  // 2) 목록 페이지네이션
  const searchInfo = buildSearchInfo();
  const rows: RawRow[] = [];
  let totalCnt = 0;
  let pageNo = 1;
  // 폭주 방지 상한 — 실측(2026-07-19) 전국 유찰 2회 이상은 약 1만 9천 건(488페이지)이므로 여유 있게 둔다.
  const HARD_PAGE_CAP = 600;
  for (;;) {
    const page = await fetchSearchPage(searchInfo, pageNo, totalCnt);
    totalCnt = page.totalCnt;
    rows.push(...page.rows);
    const collectedEnough = opts.limit !== null && rows.length >= opts.limit;
    const exhausted = page.rows.length < SEARCH.pageSize || rows.length >= totalCnt;
    if (opts.dryRun || collectedEnough || exhausted) break;
    if (pageNo >= HARD_PAGE_CAP) {
      console.error(`페이지 상한(${HARD_PAGE_CAP}) 도달 — 서버 총 ${totalCnt}건 중 ${rows.length}건에서 절단합니다.`);
      break;
    }
    pageNo++;
  }
  console.log(`목록 조회 — 서버 총 ${totalCnt}건 중 ${rows.length}건 수신(${pageNo}페이지)`);

  let picked = rows;
  if (opts.region) {
    picked = picked.filter((r) => resolveRegionKey(r) === opts.region);
    console.log(`지역 필터(${opts.region}) — ${picked.length}건`);
  }
  if (opts.limit !== null) picked = picked.slice(0, opts.limit);

  // 3) 물건별 상세(기일 이력) — 실패한 물건은 역산 폴백
  const details: (DetailResult | null)[] = [];
  for (const row of picked) details.push(await fetchDetail(row, searchInfo));
  const failedCode = calibrateFailedCode(details, todayYmd);

  if (opts.dryRun && picked.length > 0) {
    // 필드 매핑 점검용 원시 표본(1건) — 비고는 마스킹 후 출력한다.
    const sample = picked[0];
    const fields = [
      "printCsNo", "maemulSer", "boCd", "jiwonNm", "dspslUsgNm", "yuchalCnt", "gamevalAmt", "minmaePrice",
      "maeGiil", "maeHh1", "maePlace", "hjguSido", "hjguSigu", "daepyoSidoCd", "areaList", "buldList", "jimokList",
    ] as const;
    const dump = fields.map((f) => `${f}=${JSON.stringify(str(sample, f)).slice(0, 60)}`).join(" ");
    console.log(`원시 표본: ${dump} mulBigo=${JSON.stringify(cleanNote(str(sample, "mulBigo")) ?? "")}`);
    const firstDetail = details.find((d) => d !== null);
    if (firstDetail) {
      const rounds = firstDetail.dxdyRows
        .map((r) => `${str(r, "dxdyYmd")}/${str(r, "auctnDxdyKndCd")}/${str(r, "auctnDxdyRsltCd") || "-"}/${str(r, "tsLwsDspslPrc") || "-"}`)
        .join(" · ");
      console.log(`기일 이력 표본: ${rounds || "없음"} · prchDposRate=${str(firstDetail.saleInfo, "prchDposRate") || "-"}`);
    }
  }

  // 4) 매핑
  const items: AuctionItem[] = [];
  const skips = new Map<string, number>();
  let realCount = 0;
  let backcalcCount = 0;
  picked.forEach((row, i) => {
    const outcome = mapRow(row, details[i], todayYmd, failedCode);
    if (!outcome.item) {
      skips.set(outcome.skipReason ?? "기타", (skips.get(outcome.skipReason ?? "기타") ?? 0) + 1);
      return;
    }
    if (outcome.historySource === "실취득") realCount++;
    else backcalcCount++;
    items.push(outcome.item);
  });
  if (skips.size > 0) {
    console.error(`수집 제외 — ${[...skips.entries()].map(([k, v]) => `${k} ${v}건`).join(" · ")}`);
  }
  console.log(`기일 이력 — 실취득 ${realCount}건 · 역산 폴백 ${backcalcCount}건 (유찰 결과코드 보정값 ${failedCode})`);

  // 5) 검증 게이트 — 전건 zod + 건수>0 + id 중복 0. 실패 시 기존 파일 무변경 exit 1(PLAN §5.4)
  const ids = new Set<string>();
  let errors = 0;
  for (const item of items) {
    const parsed = AuctionItemSchema.safeParse(item);
    if (!parsed.success) {
      errors++;
      console.error(`[검증 실패] ${item.id}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    }
    if (ids.has(item.id)) {
      errors++;
      console.error(`[중복 id] ${item.id}`);
    }
    ids.add(item.id);
  }
  if (errors > 0 || items.length === 0) {
    console.error(`검증 게이트 실패 — 오류 ${errors}건 · 수집 ${items.length}건. 기존 파일을 변경하지 않습니다.`);
    process.exit(1);
  }

  const picks = items.filter((i) => i.priceRatio <= 0.5).length;
  const byRegion = new Map<string, AuctionItem[]>();
  for (const item of items) {
    const key = REGIONS.find((r) => r.name === item.region)?.key as string;
    if (!byRegion.has(key)) byRegion.set(key, []);
    (byRegion.get(key) as AuctionItem[]).push(item);
  }
  for (const list of byRegion.values()) {
    list.sort((a, b) => a.saleDate.localeCompare(b.saleDate) || a.id.localeCompare(b.id));
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (opts.dryRun) {
    for (const item of items) {
      console.log(
        `  ${item.id} · ${item.category} · ${item.region} ${item.district} · 감정 ${item.appraisalPrice.toLocaleString("ko-KR")}원 · ` +
          `최저 ${item.minPrice.toLocaleString("ko-KR")}원(${(item.priceRatio * 100).toFixed(1)}%) · 유찰 ${item.failCount}회 · 기일 ${item.saleDate} ${item.saleTime}`,
      );
    }
    console.log(`dry-run 완료(쓰기 없음) — 총 ${items.length}건 · 픽 ${picks}건 · 지역 ${byRegion.size}개 · 소요 ${elapsed}초`);
    console.log(`라이브 요청 ${liveRequestCount}회`);
    return;
  }

  // 6) 산출 — --region이면 해당 지역 파일과 meta만, 아니면 17개 전 파일 + meta
  const outDir = join(process.cwd(), "public", "data");
  mkdirSync(outDir, { recursive: true });
  const targets = opts.region ? REGIONS.filter((r) => r.key === opts.region) : REGIONS;
  const countsByRegion: Record<string, number> = {};
  for (const r of REGIONS) {
    if (targets.some((t) => t.key === r.key)) {
      countsByRegion[r.key] = byRegion.get(r.key)?.length ?? 0;
      continue;
    }
    // 부분 수집(--region) 시 나머지 지역은 기존 파일 건수를 유지한다(meta 합계 계약 §MetaSchema).
    const file = join(outDir, `${r.key}.json`);
    try {
      countsByRegion[r.key] = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as unknown[]).length : 0;
    } catch {
      countsByRegion[r.key] = 0;
    }
  }
  for (const r of targets) {
    writeFileSync(join(outDir, `${r.key}.json`), JSON.stringify(byRegion.get(r.key) ?? [], null, 1));
  }
  const meta: Meta = {
    crawledAt: isoKstNow(),
    totalCount: Object.values(countsByRegion).reduce((a, b) => a + b, 0),
    countsByRegion,
    nextUpdateAt: nextSundayThreeAmKst(),
  };
  writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 1));

  console.log(`수집 완료 — 총 ${items.length}건 · 픽 ${picks}건 · 지역 ${byRegion.size}개 · 소요 ${elapsed}초`);
}

// 직접 실행 시에만 수집을 시작한다 — maskNames() 등을 import하는 쪽에 부작용이 없도록.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    // 어떤 실패에서도 산출 파일은 건드리지 않은 상태다(쓰기는 게이트 통과 후 마지막 단계).
    console.error(`수집 중단 — ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
