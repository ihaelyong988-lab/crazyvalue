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
 *   --check(기본) 채점 후 위반이 있으면 exit 1
 *   --pass        위반 0건일 때만 통과 마커를 기록한다
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  // 08-10 창[08-10,08-16]이 모두 평일 08-10~08-14) 새 기일을 하나도 물어오지 못한다. 반대로 평일의
  // "신규 200건"도 새 물건이 아니라 창이 하루 굴러 들어온 기일 한 칸이다 — newCount가 재는 값에는
  // 창 회전량이 섞여 있어 "새로 유입된 물건"의 척도가 아니다.
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

const mode = process.argv[2] ?? "--check";
const loaded = load();
const { base, violations, stats } = grade(loaded);
console.log(
  `산출물 가치 게이트 — 기준 ${base ?? "미확인"} · 총 ${stats?.total ?? 0}건 · ` +
    `미경과 기일 ${stats?.dates ?? 0}일 · ` +
    `직전 대비 신규 ${typeof stats?.newCount === "number" ? `${stats.newCount}건` : "미비교"} · ` +
    `0건 시도 ${stats?.zero ?? 0}개 · 위반 ${violations.length}건`,
);
for (const v of violations) console.log(`  [${v.rule}] ${v.msg}`);

if (mode === "--pass") {
  if (violations.length > 0) {
    console.error("위반이 남아 통과 마커를 기록하지 않는다.");
    process.exit(1);
  }
  mkdirSync(STATE, { recursive: true });
  writeFileSync(MARKER, base ?? "");
  console.log(`통과 마커 기록 — ${MARKER}`);
  process.exit(0);
}
process.exit(violations.length > 0 ? 1 : 0);
