#!/usr/bin/env node
/**
 * 산출물 가치 게이트 — public/data 를 "방문자에게 쓸모가 있는가"로 채점한다.
 *
 * 왜 필요한가(2026-08-02 주인님 질책): 기존 검증은 파이프라인 성공(런 종료코드·유효 건수·배포 반영)만 봤다.
 * 그래서 산출 1,000건이 전부 하루짜리 기일이어도, 시도 5곳이 0건이어도, "이번 주 신규"가 0건이어도
 * 전부 통과·배포·성공 보고로 끝났다. 검증이 파이프라인 안쪽에서 멈추고 방문자 화면까지 오지 않으면
 * 같은 구멍이 반복된다 — 리마인더가 아니라 채점기가 필요하다(AGENTS.md §3·하네스 Loop 규칙).
 *
 * 판정 기준 시각은 실행 시각이 아니라 meta.crawledAt이다. "갱신 시점에 이 산출물이 배분 창
 * (OUTPUT_WINDOW_DAYS)을 덮었는가"를 묻는 것이라 며칠 뒤 돌려도 같은 결과가 나온다(결정적 채점).
 *
 * 사용: node .claude/hooks/data-value-gate.mjs [--check|--pass]
 *   (인자 없음)   Stop 훅 — 데이터 변경 세션에서 마커·위반을 검사해 마감 차단 여부를 결정한다
 *   --check(기본 인자) 채점 후 위반이 있으면 exit 1
 *   --pass        위반 0건일 때만 통과 마커를 기록한다
 *
 * 마커는 --pass가 쓰고 Stop 훅 분기가 읽는다. 쓰기만 하고 읽는 곳이 없으면 "규칙은 있고 게이트는
 * 없는" 상태라 채점을 건너뛴 마감이 그대로 성립한다(헌법 제10조 ④ · AGENTS.md §3).
 * 배선은 ui-quality-gate.mjs와 같은 구조다 — 변경 감지 → 채점·마커 검사 → decision:block + 체크리스트 재주입.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = join(ROOT, "public", "data");
const STATE = join(ROOT, ".claude", "hooks", ".state");
const MARKER = join(STATE, "data-value-pass");

/**
 * 산출물이 덮는 매각기일 창(수집일 포함 일수). scripts/crawl-config.ts OUTPUT_WINDOW_DAYS와
 * 같은 값 — 한쪽만 바꾸면 채점이 거짓이 된다(창은 8일인데 게이트는 7일치만 요구하는 식).
 * .mjs에서 .ts를 import할 수 없어 복제한다.
 */
const OUTPUT_WINDOW_DAYS = 7;

/** date-only 기준 n일 이동. 기일 연산은 UTC 자정 고정으로만 한다(§13 규칙 12와 동일 규약). */
const shiftDays = (dateOnly, days) =>
  new Date(Date.parse(`${dateOnly}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * 토·일 — 법원 매각기일은 평일에만 잡힌다(2026-08-02 실측: 산출 5일이 전부 월~금).
 * 갱신 직전일이 주말이면 그날 물건이 없는 것이 정상이므로 커버리지 기준일에서 제외한다.
 */
const isWeekend = (dateOnly) => {
  const dow = new Date(Date.parse(`${dateOnly}T00:00:00Z`)).getUTCDay();
  return dow === 0 || dow === 6;
};

/** ISO 시각 → Asia/Seoul 날짜. 파싱 불가면 null(추정 표기 금지). */
const dateOf = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t + 9 * 3_600_000).toISOString().slice(0, 10) : null;
};

function load() {
  const meta = JSON.parse(readFileSync(join(DATA, "meta.json"), "utf8"));
  const items = [];
  for (const key of Object.keys(meta.countsByRegion ?? {})) {
    const file = join(DATA, `${key}.json`);
    if (!existsSync(file)) continue;
    for (const item of JSON.parse(readFileSync(file, "utf8"))) items.push(item);
  }
  return { meta, items };
}

function grade({ meta, items }) {
  const base = dateOf(meta.crawledAt);
  if (!base) {
    return {
      base: null,
      violations: [{ rule: "R0", msg: `meta 시각을 읽을 수 없다 — crawledAt=${meta.crawledAt}` }],
    };
  }
  const violations = [];
  const live = items.filter((i) => typeof i.saleDate === "string" && i.saleDate >= base);
  const dates = [...new Set(live.map((i) => i.saleDate))].sort();
  // 배분 창의 마지막 날. 갱신이 매일이 된 뒤로 "다음 갱신 직전일"은 항상 내일이라 아무것도 묻지
  // 않는 기준이 됐다 — 물어야 하는 것은 산출물이 배분 창 7일을 실제로 덮었는가다.
  let lastUseful = shiftDays(base, OUTPUT_WINDOW_DAYS - 1);
  while (isWeekend(lastUseful)) lastUseful = shiftDays(lastUseful, -1);

  // R1 기일 커버리지 — 산출물이 하루로 수렴하면 그 다음 날부터 전 물건이 기일 경과가 된다.
  if (dates.length < 2) {
    violations.push({
      rule: "R1",
      msg: `미경과 매각기일이 ${dates.length}일뿐이다(${dates.join(", ") || "없음"}) — 갱신 주기 내내 물건이 남아야 한다`,
    });
  }
  // R2 배분 창 생존 — 창 마지막 날까지 입찰 가능한 물건이 남아야 한다.
  const maxDate = dates.at(-1) ?? null;
  if (!maxDate || maxDate < lastUseful) {
    violations.push({
      rule: "R2",
      msg: `최종 매각기일 ${maxDate ?? "없음"} < 배분 창 ${OUTPUT_WINDOW_DAYS}일 마지막 날 ${lastUseful} — 그 사이 방문자에게는 전 물건이 기일 경과다`,
    });
  }
  // R3 지역 커버리지 — 절반 넘는 시도가 0건이면 지역 필터가 대부분 빈 결과가 된다.
  const zero = Object.entries(meta.countsByRegion ?? {})
    .filter(([, n]) => n === 0)
    .map(([k]) => k);
  if (zero.length > 8) {
    violations.push({ rule: "R3", msg: `0건 시도 ${zero.length}개(${zero.join(", ")})` });
  }
  // R4(갱신 체감)는 폐기했다 — 번호는 재사용하지 않는다(순번 불변). 남는 규칙은 R1·R2·R3·R5다.
  //
  // newCount===0을 위반으로 본 판정은 구조적으로 매주 2일 오발화한다. 배분 창은 하루씩 굴러가는데
  // 토·일·월의 창은 평일 집합이 완전히 같아(08-08 창[08-08,08-14] · 08-09 창[08-09,08-15] ·
  // 08-10 창[08-10,08-16]이 모두 평일 08-10~08-14) 새 기일을 하나도 물어오지 못한다.
  //
  // 폐기 당시의 또 다른 근거 — 단순 id 차집합이던 옛 집계에는 창이 하루 굴러 들어온 기일 한 칸이
  // 통째로 섞여 있었다 — 은 2026-08-05 저녁 집계 정정(`countNewOnSharedDates`, 겹치는 매각기일 한정)으로
  // 사라졌다. 그래도 R4는 되살리지 않는다: 위 오발화 구조는 집계와 무관하게 남는다.
  //
  // 갱신 인식은 이제 데이터가 아니라 화면 구조가 보장한다: 기준일 바가 배지를 상시 노출하고 실수집
  // 시각을 표기하므로 데이터 채점으로 막을 대상이 아니다. 커버리지는 R1·R2가 이미 지킨다.
  // newCount는 채점하지 않고 요약에 관측값으로만 싣는다.
  const newCount = meta.newCount ?? null;
  // R5 관측 신호 정합 — meta의 기일수가 실제와 어긋나면 이후 운영 판정이 전부 거짓 위에 선다.
  const spread = new Set(items.map((i) => i.saleDate)).size;
  if (meta.outputDateSpread !== undefined && meta.outputDateSpread !== spread) {
    violations.push({
      rule: "R5",
      msg: `meta.outputDateSpread=${meta.outputDateSpread} ≠ 실제 기일수 ${spread}`,
    });
  }
  return { base, violations, stats: { total: items.length, dates: dates.length, newCount, zero: zero.length } };
}

/** 채점 1회. 산출물을 읽지 못하는 것도 판정 불능이 아니라 위반이다(안전 기본값 = 차단). */
function run() {
  try {
    return grade(load());
  } catch (err) {
    return {
      base: null,
      violations: [{ rule: "R0", msg: `산출물을 읽을 수 없다 — ${err.message}` }],
      stats: null,
    };
  }
}

const summarize = ({ base, violations, stats }) =>
  `산출물 가치 게이트 — 기준 ${base ?? "미확인"} · 총 ${stats?.total ?? 0}건 · ` +
  `미경과 기일 ${stats?.dates ?? 0}일 · ` +
  `직전 대비 신규 ${typeof stats?.newCount === "number" ? `${stats.newCount}건` : "미비교"} · ` +
  `0건 시도 ${stats?.zero ?? 0}개 · 위반 ${violations.length}건`;

const mode = process.argv[2] ?? "";

// ---- --check / --pass ----
if (mode) {
  const graded = run();
  console.log(summarize(graded));
  for (const v of graded.violations) console.log(`  [${v.rule}] ${v.msg}`);

  if (mode === "--pass") {
    if (graded.violations.length > 0) {
      console.error("위반이 남아 통과 마커를 기록하지 않는다.");
      process.exit(1);
    }
    mkdirSync(STATE, { recursive: true });
    writeFileSync(MARKER, graded.base ?? "");
    console.log(`통과 마커 기록 — ${MARKER}`);
    process.exit(0);
  }
  process.exit(graded.violations.length > 0 ? 1 : 0);
}

// ---- Stop 훅 모드(인자 없음) ----
const sh = (cmd) => {
  try {
    // stderr는 버린다 — 기준 브랜치가 없는 저장소에서 git이 뱉는 fatal이 훅 출력에 섞인다.
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
};

/** 채점 대상 = 산출물 자체와 그것을 만드는 수집 파이프라인. 둘 중 하나만 바뀌어도 산출 가치가 바뀐다. */
const isData = (p) =>
  /^public\/data\/./.test(p) ||
  /^scripts\/crawl[^/]*\.ts$/.test(p) ||
  p === ".github/workflows/crawl.yml";

/** 이번 세션의 변경분 — 미커밋 + 기준 브랜치 대비 커밋분(ui-quality-gate.mjs와 같은 판정). */
function changedDataFiles() {
  const unquote = (p) => p.trim().replace(/^"|"$/g, "");
  const found = new Set();
  for (const line of sh("git status --porcelain").split("\n").filter(Boolean)) {
    let p = line.slice(3);
    if (p.includes(" -> ")) p = p.split(" -> ").pop();
    p = unquote(p);
    if (isData(p)) found.add(p);
  }
  for (const base of ["main", "master"]) {
    const mb = sh(`git merge-base HEAD ${base}`).trim();
    if (!mb) continue;
    for (const line of sh(`git diff --name-only ${mb} HEAD`).split("\n").filter(Boolean)) {
      const p = unquote(line);
      if (isData(p)) found.add(p);
    }
    break;
  }
  return [...found];
}

/**
 * 변경 시각. 파일이 사라졌으면(삭제) 상위 디렉터리의 mtime을 쓴다 — 항목이 지워지면 디렉터리
 * mtime이 갱신되므로 삭제 뒤 --pass로 해소할 수 있다. 그마저 못 읽으면 Infinity =
 * "마커는 언제나 이보다 낡았다" → 차단. 비교 대상이 없을 때 통과로 떨어지면 게이트가 없는 것과 같다.
 */
function changedAt(rel) {
  const abs = join(ROOT, rel);
  try {
    return statSync(abs).mtimeMs;
  } catch {
    try {
      return statSync(dirname(abs)).mtimeMs;
    } catch {
      return Infinity;
    }
  }
}

/** 통과 마커가 데이터 변경보다 뒤인가. 문제가 없으면 null, 있으면 차단 사유 1줄. */
function markerStatus(files) {
  if (!existsSync(MARKER)) return "통과 마커가 없다 — 이번 변경이 한 번도 채점되지 않았다";
  let markerAt;
  try {
    markerAt = statSync(MARKER).mtimeMs;
  } catch {
    return "통과 마커 시각을 읽을 수 없다";
  }
  let newest = -Infinity;
  let newestFile = null;
  for (const f of files) {
    const t = changedAt(f);
    if (t > newest) {
      newest = t;
      newestFile = f;
    }
  }
  if (!(markerAt < newest)) return null;
  const at = Number.isFinite(newest) ? new Date(newest).toISOString() : "시각 미확인";
  return `통과 마커(${new Date(markerAt).toISOString()})가 변경(${newestFile} · ${at})보다 낡았다`;
}

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {}
const sessionId = input.session_id || "nosession";

const files = changedDataFiles();
if (files.length === 0) process.exit(0); // 이번 세션 데이터 변경 없음 → 통과

const graded = run();
const stale = markerStatus(files);
if (graded.violations.length === 0 && !stale) process.exit(0);

mkdirSync(STATE, { recursive: true });
const blockMarker = join(STATE, `data-blocks-${sessionId}`);

// 무한 루프 방지 — 세션당 3회 초과 차단 시 경고만 내고 통과(사람 판단으로 넘긴다).
let blocked = 0;
if (existsSync(blockMarker)) {
  try {
    blocked = parseInt(readFileSync(blockMarker, "utf8"), 10) || 0;
  } catch {}
}
if (blocked >= 3) {
  process.stdout.write(
    JSON.stringify({
      systemMessage: "산출물 가치 게이트: 검증 미통과지만 차단 3회 초과로 통과시킨다. 수동 점검 필요.",
    }),
  );
  process.exit(0);
}
writeFileSync(blockMarker, String(blocked + 1));

const shown = files.slice(0, 8).join(", ") + (files.length > 8 ? ` 외 ${files.length - 8}건` : "");
const reason = [
  "산출물 가치 게이트(검증 루프): 데이터 산출물·수집 파이프라인을 변경했는데 가치 채점이 통과 상태가 아닙니다.",
  `변경: ${shown}`,
  stale ? `마커: ${stale}` : "마커: 기록 있음(변경보다 최신)",
  summarize(graded),
  ...graded.violations.map((v) => `  [${v.rule}] ${v.msg}`),
  "",
  "기준(AGENTS.md §3): 파이프라인 성공이 아니라 방문자 가치 —",
  "  R1 미경과 매각기일 2일 이상 · R2 배분 창 7일 마지막 날까지 생존 · R3 0건 시도 8개 이하 · R5 meta 기일수 정합.",
  "점검: `node .claude/hooks/data-value-gate.mjs --check`",
  "통과 기록(위반 0건일 때만): `node .claude/hooks/data-value-gate.mjs --pass`",
].join("\n");

process.stdout.write(JSON.stringify({ decision: "block", reason }));
