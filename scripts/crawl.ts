/**
 * 법원경매정보(courtauction.go.kr) 수집기 — 유찰 2회 이상 전국 물건.
 *
 * 흐름(docs/CRAWLER.md 전략 A):
 *   1) GET /pgj/index.on 으로 JSESSIONID 세션 취득
 *   2) POST searchControllerMain.on — flbdNcntMin=2·전국(cortOfcCd 공백)·매각기일 창 오늘+42일, pageSize 40 페이지네이션
 *   3) 물건별 POST selectAuctnCsSrchRslt.on — 기일 이력(gdsDspslDxdyLst)·매수보증금비율(prchDposRate) 취득.
 *      요청은 BUDGET(총 요청 상한·상세 마감) 안에서만 하고, 초과분·조기 종료분은
 *      그 물건만 유찰횟수·저감율 역산 폴백(buildBackcalcHistory 주석 참조)
 *   4) 검증 게이트(전건 zod·건수>0·id 중복 0) 통과 시에만 public/data/{region}.json 17개 + meta.json 기록.
 *      실패 시 기존 파일 무변경 exit 1 — 앱은 직전 데이터로 동작한다(PLAN §5.4)
 *
 * 예절(CRAWLER.md §4): 요청 간격 ≥1.1초 · UA CrazyValueBot/0.1 · 재시도 3회 지수 백오프 ·
 *   HTTP 550/errors 봉투·로봇탐지(ipcheck=false)는 즉시 중단 — 단 상세 단계에서는 조기 종료로 강등한다.
 *   429(레이트리밋)는 일반 재시도에 태우지 않는다 — Retry-After를 존중해 1회만 길게 쉬고 반복되면 중단한다.
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
  BUDGET,
  CATEGORY_RULES,
  COURT_BY_CODE,
  DETAIL_URL,
  DXDY,
  DXDY_CALIBRATION,
  ENDPOINTS,
  LAND_EXACT,
  OUTPUT_CAP,
  OUTPUT_WINDOW_DAYS,
  POLITENESS,
  REGION_KEY_BY_SD_CD,
  REGION_KEY_BY_SIDO_PREFIX,
  SEARCH,
  SEARCH_INFO_KEYS,
  SESSION_BACKOFFS,
  USER_AGENT,
} from "./crawl-config";
import {
  STALL_PAGE_LIMIT,
  acceptPage,
  buildSummaryLine,
  capAcrossSaleDates,
  countNewOnSharedDates,
  createListAccumulator,
  describeError,
  gateItems,
  isStalled,
  type PreviousOutput,
} from "./crawl-lib";

// ---------------------------------------------------------------------------
// CLI 옵션
// ---------------------------------------------------------------------------

interface CliOptions {
  region: string | null;
  dryRun: boolean;
  limit: number | null;
  /** 매각기일 창(일). null이면 SEARCH.windowDays(42일) — 주간 전량 수집 기본값. */
  windowDays: number | null;
  /** 상세 요청을 건너뛴다(기일 이력 전량 역산). 리프레쉬 경량 모드의 실효 레버다. */
  noDetail: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    region: null,
    dryRun: false,
    limit: null,
    windowDays: null,
    noDetail: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--no-detail") opts.noDetail = true;
    else if (arg === "--window") {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 0) {
        console.error("--window 값은 0 이상의 정수여야 한다.");
        process.exit(1);
      }
      opts.windowDays = v;
    } else if (arg === "--region") {
      const v = argv[++i];
      if (!v || !REGIONS.some((r) => r.key === v)) {
        console.error(`--region 값이 올바르지 않다. 사용 가능: ${REGIONS.map((r) => r.key).join(", ")}`);
        process.exit(1);
      }
      opts.region = v;
    } else if (arg === "--limit") {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v <= 0) {
        console.error("--limit 값은 1 이상의 정수여야 한다.");
        process.exit(1);
      }
      opts.limit = v;
    } else {
      console.error(`알 수 없는 옵션이다: ${arg}`);
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

/** KST 기준 오늘+offsetDays 를 YYYY-MM-DD 로 — saleDate(날짜 전용)와 직접 비교하는 경계값용 */
function isoDayKst(offsetDays: number): string {
  const ymd = ymdKst(offsetDays);
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6)}`;
}

/** KST 현재를 +09:00 오프셋 포함 ISO 문자열로 */
function isoKstNow(): string {
  const d = kstNow();
  return (
    `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}+09:00`
  );
}

/**
 * 다음 03:00 KST — 매일 갱신 cron의 다음 실행 시각.
 * 정기 슬롯은 03:00 직후에 돌므로 결과가 "내일 03:00"이고, 그보다 이른 시각의 실행(리프레쉬 등)은
 * 당일 03:00이 된다 — 요일이 아니라 실제 다음 슬롯을 가리킨다.
 */
function nextThreeAmKst(): string {
  const now = kstNow();
  const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 3, 0, 0));
  if (candidate.getTime() <= now.getTime()) candidate.setUTCDate(candidate.getUTCDate() + 1);
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

/** 프로세스 시작 시각 — 최상위 실패 로그도 경과·요청 수를 남기기 위해 모듈 수준에 둔다(AGENTS.md §9). */
const startedAt = Date.now();

const elapsedSec = (from: number): string => ((Date.now() - from) / 1000).toFixed(1);

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
 * Retry-After(초 단위) → 대기 ms. 헤더가 없거나 HTTP-date 형식이면 기본 대기값을 쓴다.
 * 서버가 요구한 값이 기본값보다 짧아도 기본값 아래로는 내려가지 않는다(요청량 억제가 목적).
 */
function rateLimitWaitMs(header: string | null): number {
  const seconds = header ? Number(header.trim()) : NaN;
  const fromHeader = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  return Math.min(Math.max(fromHeader, POLITENESS.rateLimitWaitMs), POLITENESS.rateLimitMaxWaitMs);
}

/**
 * 예절 규칙이 적용된 단일 요청. 네트워크 오류·타임아웃·5xx(550 제외)는
 * backoffsMs(기본 POLITENESS.backoffsMs) 지수 백오프로 backoffsMs.length회까지 재시도한다.
 * 세션 부트스트랩 GET만 전용 백오프(SESSION_BACKOFFS, 약 65초 흡수)를 넘긴다 — 일반 요청 백오프는 불변.
 * HTTP 550 또는 body에 errors 봉투가 오면 사이트의 거절 신호로 보고 즉시 전체 중단한다.
 * HTTP 429는 5xx와 분리한다 — 레이트리밋에 재시도를 얹으면 요청량이 늘어 차단을 앞당긴다.
 */
async function request(
  path: string,
  init: PoliteInit,
  backoffsMs: readonly number[] = POLITENESS.backoffsMs,
): Promise<{ status: number; text: string }> {
  let attempt = 0;
  let rateLimitHits = 0;
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
      if (res.status === 429) {
        // 재시도 3회를 얹으면 요청 1건이 최대 4건이 된다 — 서버가 감속을 요구한 구간에서 요청량을
        // 4배로 올리는 동작이라 차단을 완화하지 않고 가속한다. 길게 1회만 쉬고 반복되면 중단한다.
        if (rateLimitHits >= POLITENESS.rateLimitRetries) {
          throw new CrawlAbortError(`HTTP 429 레이트리밋 반복 — 즉시 중단: ${path}`);
        }
        rateLimitHits++;
        const wait = rateLimitWaitMs(res.headers.get("retry-after"));
        console.error(`[레이트리밋 429] ${path} — ${wait}ms 대기 후 1회만 재시도한다.`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (res.status >= 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (res.status >= 400) {
        throw new CrawlAbortError(`HTTP ${res.status} — 요청 구성 오류 가능성, 중단: ${text.slice(0, 200)}`);
      }
      return { status: res.status, text };
    } catch (err) {
      if (err instanceof CrawlAbortError) throw err;
      if (attempt >= backoffsMs.length) {
        throw new Error(`요청 실패(재시도 ${backoffsMs.length}회 소진) ${path}: ${describeError(err)}`);
      }
      const backoff = backoffsMs[Math.min(attempt, backoffsMs.length - 1)];
      console.error(
        `[재시도 ${attempt + 1}/${backoffsMs.length}] ${path} — ${describeError(err)} · ${backoff}ms 대기`,
      );
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

function buildSearchInfo(windowDays: number = SEARCH.windowDays): Record<string, string> {
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
  info.bidEndYmd = ymdKst(windowDays);
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
  // 표본·마진 가드(DXDY_CALIBRATION) — 관측 1회짜리 코드가 기본값을 이기면 유찰/변경 라벨이
  // 통째로 뒤집힌 채 검증 게이트를 통과한다(zod는 fails==failCount만 본다).
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const samples = ranked.reduce((sum, [, count]) => sum + count, 0);
  const [topCode, topCount] = ranked[0] ?? ["", 0];
  const runnerUpCount = ranked[1]?.[1] ?? 0;
  const dominant = topCount >= runnerUpCount * DXDY_CALIBRATION.dominanceRatio;
  const adopt = samples >= DXDY_CALIBRATION.minSamples && topCode !== "" && dominant;
  const code = adopt ? topCode : (DXDY.RSLT_FAILED_DEFAULT as string);
  console.log(
    `유찰 결과코드 보정 — 채택 ${code}(${adopt ? "관측 최빈" : "기본값"}) · ` +
      `표본 ${samples}건(하한 ${DXDY_CALIBRATION.minSamples}) · ` +
      `최빈 ${topCode || "-"} ${topCount}건 · 2위 ${ranked[1]?.[0] ?? "-"} ${runnerUpCount}건`,
  );
  return code;
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
  // 유찰 2회 이상인데 최저가가 감정가 이상인 물건은 제품 정의상 존재할 수 없다 —
  // 실제로는 다음 회차 가격(notifyMinmaePrice1·상세 기일가) 결측으로 목록가(minmaePrice, 실측상 직전
  // 회차 가격)가 채택된 표본이다. 그대로 두면 priceRatio가 1.0으로 굳고 buildBackcalcHistory의
  // 저감률이 0이 돼 "유찰 2회인데 회차 가격이 그대로"인 이력이 검증 게이트를 통과한다
  // (zod superRefine은 저장값끼리의 정합만 보므로 원리적으로 검출하지 못한다).
  if (minPrice >= appraisal) return { item: null, skipReason: "최저가≥감정가(유찰 2회 계약 밖)", historySource: null };
  if (!saleDate) return { item: null, skipReason: "매각기일 결측", historySource: null };
  // 검색 창(bidBgngYmd~) 서버 필터의 안전망 — 창 회귀 시 기일 경과 물건 유입을 차단한다.
  if (saleYmdRaw < todayYmd) return { item: null, skipReason: "기일 경과", historySource: null };

  const regionKey = resolveRegionKey(row);
  if (!regionKey) return { item: null, skipReason: "지역 판정 불가", historySource: null };
  const district = str(row, "hjguSigu") || parseDistrict(address) || (regionKey === "sejong" ? "세종시" : "");
  if (!district) return { item: null, skipReason: "시·군·구 판정 불가", historySource: null };
  // 법원명은 **응답값이 원천**이다(백로그 118 · 2026-08-20). 손코딩 코드표를 앞에 두었더니 대구·부산·울산
  // 블록이 통째로 어긋나 앱이 틀린 법원을 말했다 — 사이트 실측 코드는 대구지법 B000310 · 대구서부 B000320 ·
  // 안동 B000311 · 경주 B000312 · 부산지법 B000410인데, 표는 그 코드들에 부산·울산 이름을 붙여 두었다.
  // 결과: 대구 물건이 "부산지방법원"으로 표시되고 그 법원에는 그 사건번호가 없어 원문 도달이 막혔다(실측 4/4).
  // 표는 이제 지역 판정의 마지막 폴백으로만 남는다(crawl-config 주석 참조).
  const court = stripTags(str(row, "jiwonNm")) || COURT_BY_CODE[str(row, "boCd")]?.name || "";
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
// 직전 산출물 대조 — 신규 건수(meta.newCount)
// ---------------------------------------------------------------------------

/**
 * 직전 산출물의 대조 기준 — id 전량과 매각기일 집합. 지역 파일 17개를 **전부** 읽어야 성립한다.
 * 하나라도 없거나 파싱에 실패하면 null이다 — 기준이 빠진 지역의 물건이 통째로 신규로 계상돼
 * 수치가 부풀기 때문이다(첫 실행도 같은 이유로 null: "새로 유입"을 말할 근거가 없다).
 * 매각기일까지 읽는 이유는 crawl-lib countNewOnSharedDates 주석 참조 — 직전 창에 없던 기일은
 * 신규 계산에서 통째로 빠진다.
 * 지역 파일을 덮어쓰기 전에 호출해야 한다.
 */
function readPreviousOutput(outDir: string): PreviousOutput | null {
  const ids = new Set<string>();
  const saleDates = new Set<string>();
  for (const r of REGIONS) {
    const file = join(outDir, `${r.key}.json`);
    if (!existsSync(file)) return null;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
      if (!Array.isArray(parsed)) return null;
      for (const row of parsed) {
        const { id, saleDate } = row as { id?: unknown; saleDate?: unknown };
        if (typeof id === "string") ids.add(id);
        if (typeof saleDate === "string") saleDates.add(saleDate);
      }
    } catch {
      return null;
    }
  }
  return { ids, saleDates };
}

// ---------------------------------------------------------------------------
// 메인
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const t0 = startedAt;
  const todayYmd = ymdKst(0);
  const windowDays = opts.windowDays ?? SEARCH.windowDays;

  console.log(
    `수집 시작 — 대상 전국 유찰 2회 이상 · 매각기일 창 ${ymdKst(0)}~${ymdKst(windowDays)}(${windowDays}일)` +
      `${opts.region ? ` · 지역 ${opts.region}` : ""}${opts.dryRun ? " · dry-run(쓰기 없음·1페이지)" : ""}` +
      `${opts.limit ? ` · limit ${opts.limit}` : ""}${opts.noDetail ? " · 상세 생략(이력 역산)" : ""}`,
  );

  // 1) 세션 취득 — JSESSIONID 쿠키(CRAWLER.md §2.2)
  // 세션 GET에 한해 전용 백오프(SESSION_BACKOFFS: 5s/15s/45s ≈ 65초 흡수)를 쓴다 —
  // 07-29 런이 transport 일시 장애(TypeError: fetch failed) 재시도 3회(1s/2s/4s) 소진으로 49초 만에 즉사했다.
  await request(ENDPOINTS.session, { method: "GET" }, SESSION_BACKOFFS);
  if (!cookieJar.has("JSESSIONID")) {
    console.error("세션 쿠키(JSESSIONID) 미취득 — 중단한다.");
    process.exit(1);
  }

  // 2) 목록 페이지네이션 — 수신 시점 dedupe(crawl-lib seenRowKeys).
  // 서버가 야간 배치 중 같은 행을 재서빙해도(07-28 실측: 같은 id 최대 154회) 첫 등장만 축적한다.
  // 종결 판정의 누적 행수(acc.rows.length)는 자연히 고유 건수다 — 재서빙 구간에서 고유 건수가
  // totalCnt에 영원히 못 미치면 아래 정체 종결(stallPages)이 목록을 정상 종결한다.
  const searchInfo = buildSearchInfo(windowDays);
  const acc = createListAccumulator();
  let totalCnt = 0;
  let pageNo = 1;
  // 폭주 방지 상한 — 실측(2026-07-19) 전국 유찰 2회 이상은 약 1만 9천 건(488페이지)이므로 여유 있게 둔다.
  const HARD_PAGE_CAP = 600;
  for (;;) {
    // 예산은 계획치가 아니라 런타임 상한이다 — request()는 재시도마다 liveRequestCount를 올리므로
    // 착수 전 1회 계산만으로는 상한이 지켜지지 않는다. 목록 단계 소진은 조기 종료로 강등하지 않는다:
    // 부분 목록은 지역별 건수를 거짓으로 만들기 때문이다(아래 상세 루프 주석과 대칭).
    if (liveRequestCount >= BUDGET.maxRequests) {
      throw new Error(
        `목록 단계에서 요청 예산(${BUDGET.maxRequests}회) 소진 — ` +
          `${pageNo}페이지 · 라이브 요청 ${liveRequestCount}회 · 경과 ${elapsedSec(t0)}초에서 중단한다.`,
      );
    }
    const page = await fetchSearchPage(searchInfo, pageNo, totalCnt);
    totalCnt = page.totalCnt;
    acceptPage(acc, page.rows);
    const collectedEnough = opts.limit !== null && acc.rows.length >= opts.limit;
    const exhausted = page.rows.length < SEARCH.pageSize || acc.rows.length >= totalCnt;
    if (opts.dryRun || collectedEnough || exhausted) break;
    // 정체 종결 — 연속 STALL_PAGE_LIMIT페이지 신규 고유 0건이면 서버 꼬리 반복으로 보고 정상 종결한다.
    // 오류·경고가 아니라 정보 로그다(수집된 고유 목록은 그대로 유효하다).
    if (isStalled(acc)) {
      console.log(
        `목록 정체 종결 — 연속 ${STALL_PAGE_LIMIT}페이지 신규 고유 0건(stallPages) · ` +
          `고유 ${acc.rows.length}건 · 서버 총 ${totalCnt}건 · ${pageNo}페이지`,
      );
      break;
    }
    if (pageNo >= HARD_PAGE_CAP) {
      console.error(`페이지 상한(${HARD_PAGE_CAP}) 도달 — 서버 총 ${totalCnt}건 중 고유 ${acc.rows.length}건에서 절단한다.`);
      break;
    }
    pageNo++;
    // 목록 단계에서 차단당해도 차단 시점을 페이지 단위로 특정할 수 있게 남긴다(AGENTS.md §9).
    if (pageNo % 100 === 0) console.log(`목록 진행 — ${pageNo}페이지 · 라이브 요청 ${liveRequestCount}회`);
  }
  const rows = acc.rows;
  console.log(`목록 조회 — 서버 총 ${totalCnt}건 중 수신 ${acc.received}건 · 고유 ${rows.length}건(${pageNo}페이지)`);

  let picked = rows;
  if (opts.region) {
    picked = picked.filter((r) => resolveRegionKey(r) === opts.region);
    console.log(`지역 필터(${opts.region}) — ${picked.length}건`);
  }
  if (opts.limit !== null) picked = picked.slice(0, opts.limit);

  // 3) 물건별 상세(기일 이력) — 요청하지 않았거나 실패한 물건은 역산 폴백(buildBackcalcHistory)
  //
  // 상세 요청 한정(2026-07-22 실측 근거): 전건 상세는 17,000회 × 1.1초 ≈ 5.2시간으로 Actions job
  // 상한 6시간에 여유가 15% 미만이었다(재시도 몇 회로 주간 갱신이 통째로 실패할 위험).
  // 매각기일 창 축소는 무효였다 — 21일 창 17,000건 ≈ 42일 창 16,302건으로, 기일이 근시일에 집중돼
  // 창을 절반으로 줄여도 대상이 줄지 않는다(0일 창 934건으로 서버 필터 자체는 정상 작동 확인).
  // 그래서 상세는 **픽 후보(최저가 ≤ 감정가 50%)에만** 요청한다. 픽 판정에 필요한 감정가·최저가는
  // 목록 응답에 이미 있어 추가 요청이 들지 않는다. 판정 불가(값 결측)는
  // 요청하는 쪽으로 기운다 — 픽을 놓치는 것이 앱의 큐레이션 정체성에 더 큰 손해다.
  //
  // 가격 필드는 mapRow의 후보 순서와 **같은 것**을 써야 한다(2026-07-27). minmaePrice는 실측상
  // 직전 회차 가격이라(mapRow 주석의 194,000,000 대 155,200,000 표본) 그것으로 판정하면 비율이
  // 한 회차분 과대평가돼 실제 픽이 상세 후보에서 탈락한다. 상세 의존 후보(기일 이력가·상세 공고가)는
  // 아직 없으므로 목록에서 얻는 notifyMinmaePrice1을 우선하고 minmaePrice로만 폴백한다.
  const needsDetail = (row: RawRow): boolean => {
    const appraisal = num(row, "gamevalAmt");
    const minPrice = [num(row, "notifyMinmaePrice1"), num(row, "minmaePrice")].find(
      (v) => Number.isInteger(v) && v > 0,
    );
    if (!(appraisal > 0 && minPrice !== undefined)) return true; // 값 결측 = 판정 불가 → 요청
    return minPrice / appraisal <= 0.5;
  };
  // 상세 대상은 picked를 재정렬하지 않고 **인덱스 집합**으로 보관한다 —
  // details[i]는 picked[i]에 1:1 대응하고 mapRow(row, details[i], …)가 그 대응에 의존한다.
  // 기일 임박순 정렬은 "예산이 후보보다 적을 때 무엇을 버릴지"를 정하는 데만 쓴다.
  const deadline = t0 + BUDGET.deadlineMinutes * 60_000;
  const candidateIdx = picked.map((_, i) => i).filter((i) => needsDetail(picked[i]));
  // 리프레쉬 경량 모드는 상세를 통째로 건너뛴다 — 상세 1건 = 요청 1회라 10분 목표에서 가장 비싼 항목이다.
  const detailBudget = opts.noDetail ? 0 : Math.max(0, BUDGET.maxRequests - liveRequestCount);
  // 예산이 후보보다 적을 때 무엇을 버릴지 — 매각기일이 먼 물건부터 버린다(임박한 기일이 사용자 가치가 크다).
  const ordered = [...candidateIdx].sort(
    (a, b) => str(picked[a], "maeGiil").localeCompare(str(picked[b], "maeGiil")) || a - b,
  );
  const targetIdx = new Set(ordered.slice(0, detailBudget));
  console.log(
    `상세 요청 대상 — 후보 ${candidateIdx.length}/${picked.length}건(픽 후보 한정) · ` +
      `선정 ${targetIdx.size}건 · 절단 ${candidateIdx.length - targetIdx.size}건(매각기일 먼 순) · ` +
      `예산 잔여 ${detailBudget}회(총 상한 ${BUDGET.maxRequests}회) · ` +
      `예상 소요 ${((targetIdx.size * POLITENESS.minIntervalMs) / 60_000).toFixed(0)}분`,
  );

  // 차단·마감을 전체 실패가 아니라 **조기 종료**로 강등한다(AGENTS.md §9 2026-07-27 원장).
  // 목록 수집이 끝난 뒤의 차단은 데이터 결손이 아니라 기일 이력의 정밀도 차이다 —
  // 미취득분은 buildBackcalcHistory 역산 폴백이 채우고 검증 게이트(zod 전건)는 그대로 통과한다.
  // 반면 목록 수집 중의 차단은 전체 실패로 둔다(위 페이지네이션 루프 무변경) —
  // 부분 목록은 지역별 건수를 거짓으로 만든다.
  const details: (DetailResult | null)[] = new Array(picked.length).fill(null);
  let aborted = false;
  let abortReason = "";
  let abortedAtRequest: number | null = null;
  let requested = 0;
  let succeeded = 0;
  for (let i = 0; i < picked.length; i++) {
    if (!targetIdx.has(i)) continue;
    // 예산 러닝 체크 — detailBudget는 착수 전 1회 계산치이고, request()는 재시도마다
    // liveRequestCount를 올린다. 이 검사가 없으면 5xx·429 구간에서 실제 요청이 상한의 몇 배가 된다.
    if (liveRequestCount >= BUDGET.maxRequests) {
      aborted = true;
      abortReason = `요청 예산(${BUDGET.maxRequests}회) 소진`;
      abortedAtRequest = liveRequestCount;
      break;
    }
    if (Date.now() >= deadline) {
      aborted = true;
      abortReason = `상세 마감(${BUDGET.deadlineMinutes}분) 도달`;
      abortedAtRequest = liveRequestCount;
      break;
    }
    requested++;
    try {
      const d = await fetchDetail(picked[i], searchInfo);
      details[i] = d;
      if (d) succeeded++;
    } catch (err) {
      if (err instanceof CrawlAbortError) {
        aborted = true;
        abortReason = err.message;
        abortedAtRequest = liveRequestCount;
        break;
      }
      throw err;
    }
  }
  if (aborted) {
    // 차단 시점의 누적 요청 수는 사후 재현이 불가능한 1회성 관측치다(AGENTS.md §9 2026-07-27).
    console.error(
      `상세 조기 종료 — ${abortReason} · 요청 ${requested}/${targetIdx.size}건 · ` +
        `라이브 요청 ${abortedAtRequest ?? liveRequestCount}회 · 경과 ${elapsedSec(t0)}초 · 나머지는 역산 폴백으로 채운다.`,
    );
  }
  const truncated = candidateIdx.length - targetIdx.size;
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

  // 5) 검증 게이트(강등 설계) — "오류 0건이어야 배포"가 아니라 "유효 부분집합은 항상 배포".
  // ① zod 실패 → 개별 드롭+invalidDropped++ ② 중복 id → 개별 드롭+dupDropped++(첫 등장 유지).
  // 전량 기각(기존 파일 무변경 exit 1)은 유효 0건일 때만 — 07-28 런은 고유 약 9,400건을 확보하고도
  // 중복 7,044건 때문에 전량 폐기됐다(오류 1건 전량 기각 게이트의 실패 선례).
  const gate = gateItems(items, (item) => {
    const parsed = AuctionItemSchema.safeParse(item);
    if (!parsed.success) {
      console.error(`[무효 드롭] ${item.id}: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
      return false;
    }
    return true;
  });
  if (gate.valid.length === 0) {
    console.error(
      `검증 게이트 기각 — 유효 0건(무효드롭 ${gate.invalidDropped}건 · 중복드롭 ${gate.dupDropped}건). ` +
        `기존 파일을 변경하지 않는다.`,
    );
    process.exit(1);
  }

  // 산출물 상한 — 수집일부터 OUTPUT_WINDOW_DAYS일의 매각기일에 배분해 OUTPUT_CAP건을 산출한다.
  // 임박순 단순 절단은 상한을 첫 기일에서 소진해 창의 나머지 날을 빈 채로 남긴다(crawl-lib 주석).
  // 창 경계는 미포함이라 오늘~오늘+6일 7일치다. 갱신 주기(nextUpdateAt)를 경계로 쓰지 않는 이유는
  // crawl-config OUTPUT_WINDOW_DAYS 주석 참조 — 매일 갱신에서는 창이 하루로 붕괴한다.
  const outputWindowEnd = isoDayKst(OUTPUT_WINDOW_DAYS);
  const {
    capped: outItems,
    cappedFrom,
    dateSpread,
  } = capAcrossSaleDates(gate.valid, OUTPUT_CAP, outputWindowEnd);
  // 원천이 무엇을 줬는지 상한 적용 **전** 값으로 기록한다(2026-08-11).
  // 이 두 값이 없으면 "원천에 그 기일·그 지역이 없어서 산출에 없는 것"과 "우리가 상한으로 잘라서
  // 없는 것"을 구분할 수단이 아예 없다. 08-11 산출이 배분 창 마지막 날을 못 덮어 게이트 R2가
  // 위반을 냈는데, 목록 조회는 서버 총 5,666건을 전량 수신하고 정상 종결했고(142페이지·조기 종결
  // 없음) 08-09 런과 08-11 런의 마지막 기일이 창 길이와 무관하게 똑같이 08-14였다 — 원천에 그
  // 이후가 없었다. 원천에 없는 것을 요구하는 채점은 영원히 빨간불이고, 매일 쌓이는 그 알림이
  // 진짜 신호를 가린다(원장 2026-08-05 R4 폐기와 같은 계열).
  const windowStart = isoDayKst(0);
  const inWindow = gate.valid.filter(
    (i) => i.saleDate >= windowStart && i.saleDate < outputWindowEnd,
  );
  const sourceLastSaleDate = inWindow.reduce<string | null>(
    (max, i) => (max === null || i.saleDate > max ? i.saleDate : max),
    null,
  );
  const candidatesByRegion: Record<string, number> = {};
  for (const r of REGIONS) candidatesByRegion[r.key] = 0;
  for (const i of inWindow) {
    const key = REGIONS.find((r) => r.name === i.region)?.key;
    if (key !== undefined) candidatesByRegion[key] += 1;
  }

  // 중복 드롭 합계 = 목록 수신 시점 dedupe(acc.received − 고유) + 게이트 중복 id.
  const dedupDropped = acc.received - rows.length + gate.dupDropped;
  const summaryLine = buildSummaryLine({
    received: acc.received,
    unique: rows.length,
    dupDropped: dedupDropped,
    invalidDropped: gate.invalidDropped,
    cappedFrom,
    output: outItems.length,
  });

  const picks = outItems.filter((i) => i.priceRatio <= 0.5).length;
  const byRegion = new Map<string, AuctionItem[]>();
  for (const item of outItems) {
    const key = REGIONS.find((r) => r.name === item.region)?.key as string;
    if (!byRegion.has(key)) byRegion.set(key, []);
    (byRegion.get(key) as AuctionItem[]).push(item);
  }
  for (const list of byRegion.values()) {
    list.sort((a, b) => a.saleDate.localeCompare(b.saleDate) || a.id.localeCompare(b.id));
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (opts.dryRun) {
    for (const item of outItems) {
      console.log(
        `  ${item.id} · ${item.category} · ${item.region} ${item.district} · 감정 ${item.appraisalPrice.toLocaleString("ko-KR")}원 · ` +
          `최저 ${item.minPrice.toLocaleString("ko-KR")}원(${(item.priceRatio * 100).toFixed(1)}%) · 유찰 ${item.failCount}회 · 기일 ${item.saleDate} ${item.saleTime}`,
      );
    }
    console.log(summaryLine);
    console.log(
      `dry-run 완료(쓰기 없음) — 총 ${outItems.length}건 · 픽 ${picks}건 · 지역 ${byRegion.size}개 · 기일 ${dateSpread}일 · 소요 ${elapsed}초`,
    );
    console.log(`라이브 요청 ${liveRequestCount}회`);
    return;
  }

  // 6) 산출 — --region이면 해당 지역 파일과 meta만, 아니면 17개 전 파일 + meta
  const outDir = join(process.cwd(), "public", "data");
  mkdirSync(outDir, { recursive: true });

  // 신규 건수 — 직전에도 수집 대상이던 매각기일에서 새로 등장한 물건 수(crawl-lib 주석: 창 회전분 제외).
  // 지역 파일을 덮어쓰기 **전에** 읽어야 비교가 성립한다.
  // 부분 수집(--region)은 비교하지 않는다 — 이번 산출에 없는 나머지 지역이 전부 이탈로 보여
  // 신규만 남은 수치가 되기 때문이다(직전 기준이 불완전할 때와 같은 왜곡).
  const previous = opts.region === null ? readPreviousOutput(outDir) : null;
  const newCount = previous === null ? null : countNewOnSharedDates(previous, outItems);

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
  // 운영 신호는 의미 단위로 분리해 기록한다. 직전 설계의 partial(=조기 종료 or 예산 절단)은
  // 후보가 예산보다 많은 상시 상태에서도 참이라 "차단이 재발했다"를 구별하지 못했다.
  // dedupDropped·invalidDropped·cappedFrom·outputCap은 이번 설계(강등 게이트·산출 상한)의 운영 신호다 —
  // src/의 MetaSchema는 비-strict z.object(미지 키 통과)·use-meta.ts isMeta는 4필드만 검사하므로 하위호환이다.
  const meta: Meta & {
    dedupDropped: number;
    invalidDropped: number;
    cappedFrom: number;
    outputCap: number;
    outputDateSpread: number;
  } = {
    crawledAt: isoKstNow(),
    totalCount: Object.values(countsByRegion).reduce((a, b) => a + b, 0),
    countsByRegion,
    // 화면은 더 이상 다음 갱신 시각을 쓰지 않지만 기록 필드로 남긴다(운영 판정에서 슬롯 간격을 읽는다).
    nextUpdateAt: nextThreeAmKst(),
    newCount,
    scope: opts.region ?? null,
    aborted,
    abortReason: aborted ? abortReason : null,
    abortedAtRequest,
    totalRequests: liveRequestCount,
    truncated,
    detailCoverage: { candidates: candidateIdx.length, requested, succeeded },
    historySource: { real: realCount, backcalc: backcalcCount },
    dedupDropped,
    invalidDropped: gate.invalidDropped,
    cappedFrom,
    outputCap: OUTPUT_CAP,
    // 산출물이 덮는 매각기일 수 — 1이면 갱신 주기의 나머지 날이 전부 기일 경과다(2026-08-02 결함의 관측 신호).
    outputDateSpread: dateSpread,
    // 상한 적용 전 원천 사실 — 게이트 R2가 "창을 덮었나"가 아니라 "원천이 준 것을 다 반영했나"를 묻는 근거.
    sourceLastSaleDate,
    candidatesByRegion,
  };
  writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 1));

  // 요청 수는 실행 모드와 무관하게 항상 남긴다 — 차단 임계는 사후 재현이 불가능한 1회성 관측치다
  // (AGENTS.md §9 2026-07-27 원장: 앞선 실패의 요청 수를 경과시간÷1.2초로 역산해야 했다).
  console.log(summaryLine);
  console.log(
    `수집 완료 — 총 ${outItems.length}건 · 픽 ${picks}건 · 신규 ${newCount ?? "미비교"}건 · ` +
      `지역 ${byRegion.size}개 · 기일 ${dateSpread}일 · 소요 ${elapsed}초 · ` +
      `라이브 요청 ${liveRequestCount}회 · 상세 ${succeeded}/${candidateIdx.length}건(절단 ${truncated}건) · ` +
      `조기 종료 ${aborted ? abortReason : "없음"}`,
  );
}

// 직접 실행 시에만 수집을 시작한다 — maskNames() 등을 import하는 쪽에 부작용이 없도록.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    // 어떤 실패에서도 산출 파일은 건드리지 않은 상태다(쓰기는 게이트 통과 후 마지막 단계).
    // 요청 수·경과는 실패 경로에서도 남긴다 — 목록 단계 차단은 여기로 떨어지고,
    // 차단 임계는 사후 재현이 불가능한 1회성 관측치다(AGENTS.md §9 2026-07-27).
    console.error(
      `수집 중단 — ${err instanceof Error ? err.message : String(err)} · ` +
        `라이브 요청 ${liveRequestCount}회 · 경과 ${elapsedSec(startedAt)}초`,
    );
    process.exit(1);
  });
}
