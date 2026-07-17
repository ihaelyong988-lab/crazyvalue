import { beforeEach, describe, expect, it } from "vitest";
import { diffWatch, getRecentIds, getWatchState, pushRecent, toggleWatch } from "@/lib/watchlist";
import type { AuctionItem } from "@/types/auction";

// node 환경 localStorage 셧: 관심함 로직은 window.localStorage만 사용한다.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
});

function mk(over: Partial<AuctionItem>): AuctionItem {
  return {
    id: "t-1",
    court: "수원지방법원",
    caseNo: "2025타경10000",
    itemNo: "1",
    category: "아파트",
    address: "경기 수원시 영통구 중앙로 1",
    region: "경기",
    district: "수원시 영통구",
    appraisalPrice: 100_000_000,
    minPrice: 49_000_000,
    priceRatio: 0.49,
    failCount: 2,
    saleDate: "2026-08-01",
    saleTime: "10:00",
    courtRoom: "경매법정 제1호",
    deposit: 4_900_000,
    areaBuilding: 84.9,
    areaLand: null,
    photoUrl: null,
    detailUrl: "https://www.courtauction.go.kr/",
    history: [
      { date: "2026-06-05", minPrice: 100_000_000, result: "유찰" },
      { date: "2026-07-10", minPrice: 70_000_000, result: "유찰" },
    ],
    specialNote: null,
    ...over,
  };
}

describe("관심함 토글·저장", () => {
  it("등록 → 해제 왕복", () => {
    const item = mk({});
    expect(toggleWatch(item)).toBe(true);
    expect(Object.keys(getWatchState().items)).toEqual(["t-1"]);
    expect(toggleWatch(item)).toBe(false);
    expect(Object.keys(getWatchState().items)).toEqual([]);
  });
  it("손상된 JSON은 기본값으로 복구(§13 규칙 5)", () => {
    store.set("crazyvalue.watchlist.v1", "{손상");
    expect(getWatchState().items).toEqual({});
  });
});

describe("diffWatch — 재유찰·기일 변경·매각 종료", () => {
  const snapshot = { minPrice: 49_000_000, saleDate: "2026-08-01", failCount: 2 };
  it("최저가 인하 = 재유찰", () => {
    expect(diffWatch(snapshot, mk({ minPrice: 34_300_000, priceRatio: 0.343, failCount: 3 }))).toBe("재유찰");
  });
  it("기일만 바뀌면 기일 변경", () => {
    expect(diffWatch(snapshot, mk({ saleDate: "2026-08-15" }))).toBe("기일 변경");
  });
  it("목록 소멸 = 매각 종료", () => {
    expect(diffWatch(snapshot, undefined)).toBe("매각 종료");
  });
  it("변화 없음 = null", () => {
    expect(diffWatch(snapshot, mk({}))).toBe(null);
  });
});

describe("최근 본 물건 — 최대 5건·중복 제거·최신 우선", () => {
  it("push 순서와 상한", () => {
    for (const id of ["a", "b", "c", "d", "e", "f"]) pushRecent(id);
    expect(getRecentIds()).toEqual(["f", "e", "d", "c", "b"]);
  });
  it("재열람 시 맨 앞으로", () => {
    for (const id of ["a", "b", "c"]) pushRecent(id);
    pushRecent("a");
    expect(getRecentIds()).toEqual(["a", "c", "b"]);
  });
});
