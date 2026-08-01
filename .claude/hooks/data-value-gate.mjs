#!/usr/bin/env node
/**
 * 산출물 가치 게이트 — public/data 를 "방문자에게 쓸모가 있는가"로 채점한다.
 *
 * 왜 필요한가(2026-08-02 주인님 질책): 기존 검증은 파이프라인 성공(런 종료코드·유효 건수·배포 반영)만 봤다.
 * 그래서 산출 1,000건이 전부 하루짜리 기일이어도, 시도 5곳이 0건이어도, "이번 주 신규"가 0건이어도
 * 전부 통과·배포·성공 보고로 끝났다. 검증이 파이프라인 안쪽에서 멈추고 방문자 화면까지 오지 않으면
 * 같은 구멍이 반복된다 — 리마인더가 아니라 채점기가 필요하다(AGENTS.md §3·하네스 Loop 규칙).
 *
 * 판정 기준 시각은 실행 시각이 아니라 meta.crawledAt이다. "갱신 시점에 이 산출물이 다음 갱신까지
 * 버틸 수 있었는가"를 묻는 것이라 며칠 뒤 돌려도 같은 결과가 나온다(결정적 채점).
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
  const nextUpdate = dateOf(meta.nextUpdateAt);
  if (!base || !nextUpdate) {
    return {
      base: null,
      violations: [
        {
          rule: "R0",
          msg: `meta 시각을 읽을 수 없다 — crawledAt=${meta.crawledAt} nextUpdateAt=${meta.nextUpdateAt}`,
        },
      ],
    };
  }
  const violations = [];
  const live = items.filter((i) => typeof i.saleDate === "string" && i.saleDate >= base);
  const dates = [...new Set(live.map((i) => i.saleDate))].sort();
  let lastUseful = shiftDays(nextUpdate, -1);
  while (isWeekend(lastUseful)) lastUseful = shiftDays(lastUseful, -1);

  // R1 기일 커버리지 — 산출물이 하루로 수렴하면 그 다음 날부터 전 물건이 기일 경과가 된다.
  if (dates.length < 2) {
    violations.push({
      rule: "R1",
      msg: `미경과 매각기일이 ${dates.length}일뿐이다(${dates.join(", ") || "없음"}) — 갱신 주기 내내 물건이 남아야 한다`,
    });
  }
  // R2 갱신 주기 생존 — 다음 갱신 직전일까지 입찰 가능한 물건이 남아야 한다.
  const maxDate = dates.at(-1) ?? null;
  if (!maxDate || maxDate < lastUseful) {
    violations.push({
      rule: "R2",
      msg: `최종 매각기일 ${maxDate ?? "없음"} < 다음 갱신 직전일 ${lastUseful} — 그 사이 방문자에게는 전 물건이 기일 경과다`,
    });
  }
  // R3 지역 커버리지 — 절반 넘는 시도가 0건이면 지역 필터가 대부분 빈 결과가 된다.
  const zero = Object.entries(meta.countsByRegion ?? {})
    .filter(([, n]) => n === 0)
    .map(([k]) => k);
  if (zero.length > 8) {
    violations.push({ rule: "R3", msg: `0건 시도 ${zero.length}개(${zero.join(", ")})` });
  }
  // R4 갱신 체감 — "이번 주 신규"가 0이면 홈에서 섹션이 통째로 사라져 갱신이 화면에 드러나지 않는다.
  // 앱(data.ts isNewThisWeek)과 같은 규칙을 게이트가 독립 재구현해 대조한다(적대적 채점).
  const from = shiftDays(base, -7);
  const fresh = items.filter((i) => {
    const fails = (i.history ?? [])
      .filter((h) => h.result === "유찰")
      .map((h) => h.date)
      .sort();
    return fails.length >= 2 && fails[1] >= from && fails[1] <= base;
  });
  if (fresh.length === 0) {
    violations.push({
      rule: "R4",
      msg: `이번 주 신규 0건(판정창 ${from}~${base}) — 홈 신규 섹션이 사라져 방문자가 갱신을 인식하지 못한다`,
    });
  }
  // R5 관측 신호 정합 — meta의 기일수가 실제와 어긋나면 이후 운영 판정이 전부 거짓 위에 선다.
  const spread = new Set(items.map((i) => i.saleDate)).size;
  if (meta.outputDateSpread !== undefined && meta.outputDateSpread !== spread) {
    violations.push({
      rule: "R5",
      msg: `meta.outputDateSpread=${meta.outputDateSpread} ≠ 실제 기일수 ${spread}`,
    });
  }
  return { base, violations, stats: { total: items.length, dates: dates.length, fresh: fresh.length, zero: zero.length } };
}

const mode = process.argv[2] ?? "--check";
const loaded = load();
const { base, violations, stats } = grade(loaded);
console.log(
  `산출물 가치 게이트 — 기준 ${base ?? "미확인"} · 총 ${stats?.total ?? 0}건 · ` +
    `미경과 기일 ${stats?.dates ?? 0}일 · 이번 주 신규 ${stats?.fresh ?? 0}건 · 0건 시도 ${stats?.zero ?? 0}개 · ` +
    `위반 ${violations.length}건`,
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
