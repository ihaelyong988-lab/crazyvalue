import { describe, expect, it } from "vitest";
import {
  STALL_PAGE_LIMIT,
  acceptPage,
  buildSummaryLine,
  capBySaleDate,
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

describe("capBySaleDate — 산출물 상한: 매각기일 임박순 상위 OUTPUT_CAP건", () => {
  it("1,001건 입력 → 임박순 1,000건 선별·cappedFrom=1001", () => {
    expect(OUTPUT_CAP).toBe(1000);
    // saleDate를 역순으로 만들어 정렬이 실제로 작동하는지 본다(입력 순서 의존 금지).
    const items = Array.from({ length: OUTPUT_CAP + 1 }, (_, i) => ({
      id: `id-${String(i).padStart(4, "0")}`,
      saleDate: `2026-${pad2(12 - (i % 5))}-${pad2(1 + (i % 28))}`,
    }));
    const { capped, cappedFrom } = capBySaleDate(items, OUTPUT_CAP);
    expect(cappedFrom).toBe(OUTPUT_CAP + 1);
    expect(capped).toHaveLength(OUTPUT_CAP);
    // 임박순(오름차순) 정렬 검증 + 잘려나간 1건은 가장 먼 기일이어야 한다
    const sortedAll = [...items].sort((a, b) => a.saleDate.localeCompare(b.saleDate) || a.id.localeCompare(b.id));
    expect(capped).toEqual(sortedAll.slice(0, OUTPUT_CAP));
    for (let i = 1; i < capped.length; i++) {
      expect(capped[i - 1].saleDate <= capped[i].saleDate).toBe(true);
    }
  });
  it("동일 매각기일은 id 순 안정 정렬", () => {
    const { capped } = capBySaleDate(
      [
        { id: "b", saleDate: "2026-08-01" },
        { id: "a", saleDate: "2026-08-01" },
        { id: "c", saleDate: "2026-07-01" },
      ],
      2,
    );
    expect(capped.map((i) => i.id)).toEqual(["c", "a"]);
  });
  it("상한 이하 입력은 그대로(정렬만) 통과·입력 배열 불변", () => {
    const items = [
      { id: "b", saleDate: "2026-09-01" },
      { id: "a", saleDate: "2026-08-01" },
    ];
    const { capped, cappedFrom } = capBySaleDate(items, OUTPUT_CAP);
    expect(capped.map((i) => i.id)).toEqual(["a", "b"]);
    expect(cappedFrom).toBe(2);
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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
