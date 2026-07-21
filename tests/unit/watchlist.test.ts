import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HOME_FILTERS_KEY,
  diffWatch,
  getRecentIds,
  getWatchState,
  isOnboarded,
  markOnboarded,
  pushRecent,
  resetAll,
  setPrefs,
  subscribePrefs,
  subscribeWatchState,
  toggleWatch,
  type Prefs,
} from "@/lib/watchlist";
import type { AuctionItem } from "@/types/auction";

// node 환경 window 셧: 관심함 로직은 localStorage·sessionStorage·storage 이벤트만 사용한다.
// blockWrite = 용량 초과·프라이빗 모드 모사(감사 2차 31) — localStorage 쓰기만 던진다.
const store = new Map<string, string>();
const session = new Map<string, string>();
const listeners = new Set<(e: StorageEvent) => void>();
let blockWrite = false;
let blockRemove = false;

// length·key(i)는 resetAll의 키 열거(감사 2차 53)가 쓰는 Storage API다 — 실제 저장소와 같은 계약으로 흉내낸다.
// blockRemove = 삭제 자체가 막힌 저장소 모사(초기화 실패 표면화).
function shim(map: Map<string, string>, blockable: boolean) {
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (blockable && blockWrite) throw new Error("QuotaExceededError");
      map.set(k, v);
    },
    removeItem: (k: string) => {
      if (blockable && blockRemove) throw new Error("SecurityError");
      map.delete(k);
    },
  };
}

/** 타 탭 저장 모사 — storage 이벤트는 저장한 탭이 아닌 다른 탭에서만 발생한다(감사 2차 33). */
function fireStorage(key: string | null): void {
  for (const fn of [...listeners]) fn({ key } as unknown as StorageEvent);
}

beforeEach(() => {
  store.clear();
  session.clear();
  listeners.clear();
  blockWrite = false;
  blockRemove = false;
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: shim(store, true),
    sessionStorage: shim(session, false),
    addEventListener: (type: string, fn: (e: StorageEvent) => void) => {
      if (type === "storage") listeners.add(fn);
    },
    removeEventListener: (type: string, fn: (e: StorageEvent) => void) => {
      if (type === "storage") listeners.delete(fn);
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

/** 저장소 원문에 담긴 관심함 상태(복구본 치환 검증용). */
function storedWatch(): { items?: Record<string, unknown>; onboarded?: boolean } {
  return JSON.parse(store.get("crazyvalue.watchlist.v1") ?? "{}");
}

describe("관심함 토글·저장", () => {
  it("등록 → 해제 왕복", () => {
    const item = mk({});
    expect(toggleWatch(item)).toEqual({ watched: true, saved: true });
    expect(Object.keys(getWatchState().items)).toEqual(["t-1"]);
    expect(toggleWatch(item)).toEqual({ watched: false, saved: true });
    expect(Object.keys(getWatchState().items)).toEqual([]);
  });
  it("손상된 JSON은 기본값으로 복구(§13 규칙 5)", () => {
    store.set("crazyvalue.watchlist.v1", "{손상");
    expect(getWatchState().items).toEqual({});
  });
});

describe("저장 실패 표면화(감사 2차 31)", () => {
  it("용량 초과 시 등록은 saved=false·직전 상태를 반환한다", () => {
    blockWrite = true;
    expect(toggleWatch(mk({}))).toEqual({ watched: false, saved: false });
    expect(getWatchState().items).toEqual({});
  });
  it("용량 초과 시 해제는 관심 상태를 유지한 채 실패를 알린다", () => {
    toggleWatch(mk({}));
    blockWrite = true;
    expect(toggleWatch(mk({}))).toEqual({ watched: true, saved: false });
    expect(Object.keys(getWatchState().items)).toEqual(["t-1"]);
  });
  it("관심조건·온보딩 저장도 성공 여부를 반환한다", () => {
    expect(setPrefs({ regions: ["경기"], priceBands: ["b2"] })).toBe(true);
    expect(markOnboarded()).toBe(true);
    blockWrite = true;
    expect(setPrefs({ regions: ["서울"], priceBands: [] })).toBe(false);
    expect(markOnboarded()).toBe(false);
    expect(getWatchState().prefs.regions).toEqual(["경기"]);
  });
});

describe("관심조건 저장과 홈 세션 미러(감사 2차 32)", () => {
  it("setPrefs가 홈 필터 세션 미러를 무효화한다", () => {
    session.set(HOME_FILTERS_KEY, "?r=11&b=b1");
    setPrefs({ regions: ["부산"], priceBands: ["b3"] });
    expect(session.has(HOME_FILTERS_KEY)).toBe(false);
  });
  it("저장 실패 시에는 미러를 건드리지 않는다", () => {
    session.set(HOME_FILTERS_KEY, "?r=11");
    blockWrite = true;
    expect(setPrefs({ regions: ["부산"], priceBands: [] })).toBe(false);
    expect(session.get(HOME_FILTERS_KEY)).toBe("?r=11");
  });
});

describe("타 탭 변경 구독(감사 2차 33)", () => {
  it("관심함 키 변경만 통지하고 해제 후에는 통지하지 않는다", () => {
    const seen = vi.fn();
    const unsubscribe = subscribeWatchState(seen);
    fireStorage("crazyvalue.watchlist.v1");
    expect(seen).toHaveBeenCalledTimes(1);
    fireStorage("crazyvalue.recent.v1");
    expect(seen).toHaveBeenCalledTimes(1);
    fireStorage(null); // 타 탭의 storage.clear()
    expect(seen).toHaveBeenCalledTimes(2);
    unsubscribe();
    fireStorage("crazyvalue.watchlist.v1");
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

describe("관심조건 변경만 구독(감사 2차 33)", () => {
  const otherTabWrite = (state: unknown) => {
    store.set("crazyvalue.watchlist.v1", JSON.stringify(state));
    fireStorage("crazyvalue.watchlist.v1");
  };

  it("관심함 항목만 바뀐 통지는 걸러낸다", () => {
    const seen = vi.fn();
    let mine: Prefs = { regions: ["경기"], priceBands: [] };
    subscribePrefs(
      () => mine,
      (next) => {
        mine = next;
        seen(next);
      },
    );
    otherTabWrite({
      items: {
        "t-1": {
          addedAt: "2026-07-20T00:00:00.000Z",
          snapshot: { minPrice: 1, saleDate: "2026-08-01", failCount: 2 },
        },
      },
      prefs: { regions: ["경기"], priceBands: [] },
    });
    expect(seen).not.toHaveBeenCalled();

    otherTabWrite({ items: {}, prefs: { regions: ["경기", "부산"], priceBands: ["b2"] } });
    expect(seen).toHaveBeenCalledWith({ regions: ["경기", "부산"], priceBands: ["b2"] });
    expect(mine.regions).toEqual(["경기", "부산"]);
  });
});

describe("온보딩 완료 플래그 분리(감사 2차 34)", () => {
  it("관심조건 저장은 온보딩 완료로 간주하지 않는다", () => {
    setPrefs({ regions: ["대구"], priceBands: [] });
    expect(isOnboarded()).toBe(false);
    expect(storedWatch().onboarded).toBeUndefined();
  });
  it("markOnboarded만 완료 플래그를 세운다", () => {
    markOnboarded();
    expect(isOnboarded()).toBe(true);
    setPrefs({ regions: ["대구"], priceBands: [] });
    expect(isOnboarded()).toBe(true); // 이후 조건 변경이 플래그를 되돌리지 않는다
  });
});

describe("내 데이터 초기화(감사 2차 53)", () => {
  it("crazyvalue.* 저장값만 전부 지운다(다른 네임스페이스는 보존)", () => {
    toggleWatch(mk({}));
    pushRecent("t-1");
    setPrefs({ regions: ["서울"], priceBands: ["b1"] });
    markOnboarded();
    session.set(HOME_FILTERS_KEY, "?r=서울");
    session.set("crazyvalue.watchdiff.session.v1", "{}");
    store.set("other.app.v1", "keep");
    session.set("other.session.v1", "keep");

    expect(resetAll()).toBe(true);
    expect([...store.keys()]).toEqual(["other.app.v1"]);
    expect([...session.keys()]).toEqual(["other.session.v1"]);
    expect(getWatchState()).toEqual({ items: {}, prefs: { regions: [], priceBands: [] } });
    expect(getRecentIds()).toEqual([]);
    expect(isOnboarded()).toBe(false);
  });

  it("삭제가 막히면 false를 돌려주고 저장값은 그대로다", () => {
    setPrefs({ regions: ["부산"], priceBands: [] });
    blockRemove = true;
    expect(resetAll()).toBe(false);
    expect(getWatchState().prefs.regions).toEqual(["부산"]);
  });
});

describe("스냅샷 형태 가드(감사 2차 35)", () => {
  const entry = (snapshot: Record<string, unknown>) => ({ addedAt: "2026-07-20T00:00:00.000Z", snapshot });

  it("기일이 YYYY-MM-DD가 아닌 항목은 폐기한다", () => {
    store.set(
      "crazyvalue.watchlist.v1",
      JSON.stringify({
        items: {
          good: entry({ minPrice: 1, saleDate: "2026-08-01", failCount: 2 }),
          bad1: entry({ minPrice: 1, saleDate: "2026-8-1", failCount: 2 }),
          bad2: entry({ minPrice: 1, saleDate: "undefined", failCount: 2 }),
          bad3: entry({ minPrice: 1, saleDate: "", failCount: 2 }),
        },
        prefs: { regions: [], priceBands: [] },
      }),
    );
    expect(Object.keys(getWatchState().items)).toEqual(["good"]);
    expect(Object.keys(storedWatch().items ?? {})).toEqual(["good"]); // 복구본 치환 저장
  });

  it("존재하지 않는 날짜·비유한 숫자 항목도 폐기한다", () => {
    store.set(
      "crazyvalue.watchlist.v1",
      JSON.stringify({
        items: {
          rollover: entry({ minPrice: 1, saleDate: "2026-02-30", failCount: 2 }),
          month13: entry({ minPrice: 1, saleDate: "2026-13-01", failCount: 2 }),
          nan: entry({ minPrice: null, saleDate: "2026-08-01", failCount: 2 }),
        },
        prefs: { regions: [], priceBands: [] },
      }),
    );
    expect(getWatchState().items).toEqual({});
  });

  it("기본값은 호출마다 새 객체다(오류 원장 2026-07-18)", () => {
    const first = getWatchState();
    first.items["오염"] = {
      addedAt: "2026-07-20T00:00:00.000Z",
      snapshot: { minPrice: 1, saleDate: "2026-08-01", failCount: 2 },
    };
    first.prefs.regions.push("오염");
    const second = getWatchState();
    expect(second.items).toEqual({});
    expect(second.prefs.regions).toEqual([]);
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
