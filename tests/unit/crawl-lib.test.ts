import { describe, expect, it } from "vitest";
import {
  STALL_PAGE_LIMIT,
  acceptPage,
  buildSummaryLine,
  capAcrossSaleDates,
  createListAccumulator,
  deriveRowKey,
  gateItems,
  isStalled,
  type RawRow,
} from "../../scripts/crawl-lib";
import { OUTPUT_CAP } from "../../scripts/crawl-config";

// 수집 파이프라인 순수 헬퍼 계약(2026-07-30 강등 설계) — 서버 재서빙·정체 종결·강등 게이트·산출 상한.

function row(caseNo: string, itemNo: string, boCd = "B000210"): RawRow {
  return { printCsNo: `서울중앙지방법원<br/>${caseNo}`, maemulSer: itemNo, boCd };
}

describe("deriveRowKey — 기존 id 유도와 동일 원천 필드(사건번호·물건번호·법원)", () => {
  it("printCsNo의 사건번호 + maemulSer + boCd 조합", () => {
    expect(deriveRowKey(row("2025타경10000", "1"))).toBe("B000210-2025타경10000-1");
  });
  it("printCsNo 결측 시 srnSaNo·saNo 폴백", () => {
    expect(deriveRowKey({ srnSaNo: "20250130010000", maemulSer: "2", boCd: "B000240" })).toBe(
      "B000240-20250130010000-2",
    );
  });
  it("식별 불가(사건번호·물건번호 결측)는 null — 중복 판정 없이 수용", () => {
    expect(deriveRowKey({ maemulSer: "1" })).toBeNull();
    expect(deriveRowKey(row("2025타경10000", ""))).toBeNull();
  });
});

describe("acceptPage — 서버 재서빙 시뮬: 같은 행 반복 수신에도 고유만 축적(seenRowKeys)", () => {
  it("같은 행이 여러 페이지에 걸쳐 재서빙돼도 첫 등장만 남는다", () => {
    const acc = createListAccumulator();
    const a = row("2025타경10000", "1");
    const b = row("2025타경10001", "1");
    const c = row("2025타경10002", "1");
    // 야간 배치 재서빙 실측 형태: 같은 행이 페이지마다 반복 등장
    expect(acceptPage(acc, [a, b])).toBe(2);
    expect(acceptPage(acc, [a, b, c])).toBe(1); // a·b 재서빙 → c만 신규
    expect(acceptPage(acc, [a, a, b, c])).toBe(0); // 전량 재서빙 → 신규 0
    expect(acc.rows).toHaveLength(3);
    expect(acc.received).toBe(9); // 수신 총량은 중복 포함
    expect([...acc.seenRowKeys]).toHaveLength(3);
  });
  it("같은 id 154회 재서빙(실측 최대치)에도 1건만 축적", () => {
    const acc = createListAccumulator();
    const a = row("2008타경25092", "1");
    for (let i = 0; i < 154; i++) acceptPage(acc, [a]);
    expect(acc.rows).toHaveLength(1);
    expect(acc.received).toBe(154);
  });
  it("식별 불가 행(null 키)은 중복 판정 없이 수용된다", () => {
    const acc = createListAccumulator();
    expect(acceptPage(acc, [{ maemulSer: "1" }, { maemulSer: "1" }])).toBe(2);
    expect(acc.rows).toHaveLength(2);
  });
});

describe("isStalled — 연속 5페이지 신규 고유 0건이면 정체 종결(stallPages)", () => {
  const dup = row("2025타경10000", "1");
  it("연속 STALL_PAGE_LIMIT(5)페이지 신규 0건에서 정체 종결", () => {
    const acc = createListAccumulator();
    acceptPage(acc, [dup]);
    for (let p = 0; p < STALL_PAGE_LIMIT - 1; p++) {
      acceptPage(acc, [dup]);
      expect(isStalled(acc)).toBe(false); // 4페이지까지는 계속
    }
    acceptPage(acc, [dup]); // 5페이지째
    expect(acc.stallPages).toBe(STALL_PAGE_LIMIT);
    expect(isStalled(acc)).toBe(true);
  });
  it("중간에 신규 고유 1건이 나오면 카운터가 리셋된다", () => {
    const acc = createListAccumulator();
    acceptPage(acc, [dup]);
    for (let p = 0; p < STALL_PAGE_LIMIT - 1; p++) acceptPage(acc, [dup]);
    expect(acc.stallPages).toBe(STALL_PAGE_LIMIT - 1);
    acceptPage(acc, [dup, row("2025타경20000", "1")]); // 신규 등장
    expect(acc.stallPages).toBe(0);
    expect(isStalled(acc)).toBe(false);
  });
});

describe("gateItems — 강등 게이트: 개별 드롭+카운트, 유효 부분집합만 통과", () => {
  interface T {
    id: string;
    ok: boolean;
  }
  const isValid = (t: T) => t.ok;
  it("중복·무효 섞인 입력 — 드롭 카운트 정확·유효만 통과(첫 등장 유지)", () => {
    const items: T[] = [
      { id: "a", ok: true },
      { id: "b", ok: false }, // 무효
      { id: "a", ok: true }, // 중복 → 드롭(첫 a 유지)
      { id: "c", ok: true },
      { id: "c", ok: false }, // 무효가 중복보다 먼저 판정된다(① zod ② 중복 순회 순서)
      { id: "d", ok: false }, // 무효
    ];
    const got = gateItems(items, isValid);
    expect(got.valid.map((t) => t.id)).toEqual(["a", "c"]);
    expect(got.invalidDropped).toBe(3);
    expect(got.dupDropped).toBe(1);
  });
  it("전건 유효면 드롭 0", () => {
    const got = gateItems<T>([{ id: "a", ok: true }, { id: "b", ok: true }], isValid);
    expect(got.valid).toHaveLength(2);
    expect(got.invalidDropped).toBe(0);
    expect(got.dupDropped).toBe(0);
  });
  it("유효 0건일 때만 전량 기각 조건이 성립한다(호출부 exit 1 판정 근거)", () => {
    const allBad = gateItems<T>([{ id: "a", ok: false }, { id: "b", ok: false }], isValid);
    expect(allBad.valid).toHaveLength(0); // → crawl.ts가 "유효 0건" exit 1
    const oneGood = gateItems<T>([{ id: "a", ok: false }, { id: "b", ok: true }], isValid);
    expect(oneGood.valid).toHaveLength(1); // 유효 1건 이상 = 배포 계속
  });
});

describe("capAcrossSaleDates — 산출물 상한: 갱신 주기 내 매각기일 배분", () => {
  // 기일 하나에 n건을 만든다. priceRatio는 i가 커질수록 비싸다(선별 순서 검증용).
  const cell = (saleDate: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `${saleDate}-${String(i).padStart(4, "0")}`,
      saleDate,
      priceRatio: i / 10_000,
    }));

  it("회귀(2026-08-02 P0): 첫 기일에 상한 이상 물량이 있어도 하루로 수렴하지 않는다", () => {
    expect(OUTPUT_CAP).toBe(1000);
    // 실측 재현 — 08-03 하루가 상한을 넘고, 직전 설계(임박순 절단)는 여기서 1,000건을 소진했다.
    const items = [
      ...cell("2026-08-03", 1200),
      ...cell("2026-08-04", 800),
      ...cell("2026-08-05", 800),
      ...cell("2026-08-06", 800),
      ...cell("2026-08-07", 800),
    ];
    const { capped, cappedFrom, dateSpread } = capAcrossSaleDates(items, OUTPUT_CAP, "2026-08-09");
    expect(cappedFrom).toBe(4400);
    expect(capped).toHaveLength(OUTPUT_CAP);
    expect(dateSpread).toBe(5); // 하루가 아니라 갱신 주기 안 5개 기일 전부
    const per = countByDate(capped);
    expect(per["2026-08-03"]).toBe(200);
    expect(per["2026-08-07"]).toBe(200);
  });

  it("얕은 기일이 남긴 몫은 다른 기일이 흡수한다(물채우기)", () => {
    const items = [...cell("2026-08-03", 10), ...cell("2026-08-04", 2000)];
    const { capped } = capAcrossSaleDates(items, OUTPUT_CAP, "2026-08-09");
    const per = countByDate(capped);
    expect(per["2026-08-03"]).toBe(10); // 공급 전량
    expect(per["2026-08-04"]).toBe(990); // 균등 쿼터 500 + 재분배 490
    expect(capped).toHaveLength(OUTPUT_CAP);
  });

  it("갱신 주기 밖 기일은 창 안을 다 채운 뒤에만 임박순으로 채운다", () => {
    const items = [
      ...cell("2026-08-03", 300), // 창 안 전량으로도 상한에 못 미친다
      ...cell("2026-08-10", 5000),
      ...cell("2026-08-17", 5000),
    ];
    const { capped, dateSpread } = capAcrossSaleDates(items, OUTPUT_CAP, "2026-08-09");
    const per = countByDate(capped);
    expect(per["2026-08-03"]).toBe(300);
    expect(per["2026-08-10"]).toBe(700); // 가까운 창 밖 기일부터
    expect(per["2026-08-17"]).toBeUndefined();
    expect(dateSpread).toBe(2);
  });

  it("기일 내 선별은 priceRatio 오름차순(저가 우선)·동일 비율 id 순", () => {
    const items = [
      { id: "b", saleDate: "2026-08-03", priceRatio: 0.4 },
      { id: "a", saleDate: "2026-08-03", priceRatio: 0.4 },
      { id: "c", saleDate: "2026-08-03", priceRatio: 0.2 },
      { id: "d", saleDate: "2026-08-03", priceRatio: 0.9 },
    ];
    const { capped } = capAcrossSaleDates(items, 3, "2026-08-09");
    expect(capped.map((i) => i.id)).toEqual(["a", "b", "c"]); // 산출 정렬은 기일·id 순
    expect(capped.some((i) => i.id === "d")).toBe(false); // 가장 비싼 1건이 탈락
  });

  it("상한 이하 입력은 전량 통과(기일 오름차순)·입력 배열 불변", () => {
    const items = [
      { id: "b", saleDate: "2026-09-01", priceRatio: 0.3 },
      { id: "a", saleDate: "2026-08-01", priceRatio: 0.5 },
    ];
    const { capped, cappedFrom, dateSpread } = capAcrossSaleDates(items, OUTPUT_CAP, "2026-08-09");
    expect(capped.map((i) => i.id)).toEqual(["a", "b"]);
    expect(cappedFrom).toBe(2);
    expect(dateSpread).toBe(2);
    expect(items.map((i) => i.id)).toEqual(["b", "a"]); // 원본 불변
  });
});

describe("buildSummaryLine — 수집 요약 1줄 형식 고정", () => {
  it("형식: 수집 요약 — 수신 N · 고유 N · 중복드롭 N · 무효드롭 N · 상한적용 N→N", () => {
    expect(
      buildSummaryLine({ received: 16444, unique: 9400, dupDropped: 7044, invalidDropped: 3, cappedFrom: 9397, output: 1000 }),
    ).toBe("수집 요약 — 수신 16444 · 고유 9400 · 중복드롭 7044 · 무효드롭 3 · 상한적용 9397→1000");
  });
});

function countByDate(items: { saleDate: string }[]): Record<string, number> {
  const per: Record<string, number> = {};
  for (const i of items) per[i.saleDate] = (per[i.saleDate] ?? 0) + 1;
  return per;
}
