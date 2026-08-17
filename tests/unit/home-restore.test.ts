import { beforeEach, describe, expect, it } from "vitest";
import * as jsxRuntime from "react/jsx-runtime";
import * as dataLib from "@/lib/data";
import * as queryLib from "@/lib/query";
import * as watchlist from "@/lib/watchlist";
import {
  chooseHomeRestore,
  getWatchState,
  setPrefs,
  type HomeRestoreInput,
} from "@/lib/watchlist";
import {
  createReactStub,
  installWindow,
  loadModule,
  makeStub,
  propsOf,
  type Mounted,
  type TestWindow,
} from "./react-harness";

// 홈 복원 회귀(감사 3차 32) — /me에서 바꾼 관심조건이 홈에 영영 반영되지 않던 결함.
// 원인은 두 곳이었다: ① 옛 URL을 세션 미러로 되써서 방금 무효화한 미러를 부활시켰다
// ② 미러 분기가 관심조건 분기보다 앞이라 이후 재마운트가 prefs에 도달하지 못했다.
// 그래서 판정은 "마운트 → 이펙트 → 재마운트"를 실제 순서대로 돌려 화면에 실린 필터로 한다.

const WATCH_KEY = "crazyvalue.watchlist.v1";
const MIRROR_KEY = "crazyvalue.home-filters.v1";
const MIRROR_AT_KEY = "crazyvalue.home-filters-at.v1";

let win: TestWindow;

beforeEach(() => {
  win = installWindow();
});

// 홈이 그리는 자식은 전부 자리표시로 바꾼다 — 검증 대상은 자식에 넘어가는 필터값이다.
const RegionFilter = makeStub();
const PriceFilter = makeStub();

function pageStubs(react: Record<string, unknown>): Record<string, unknown> {
  return {
    react,
    "react/jsx-runtime": jsxRuntime,
    "@/lib/data": dataLib,
    "@/lib/query": queryLib,
    "@/lib/watchlist": watchlist,
    "@/lib/use-auction-data": {
      useAuctionData: () => ({ status: "ready", items: [], retry: () => {} }),
    },
    "@/components/RegionFilter": { RegionFilter },
    "@/components/PriceFilter": { PriceFilter },
    "@/components/CategoryFilter": { CategoryFilter: makeStub() },
    "@/components/ResultButton": { ResultButton: makeStub() },
    "@/components/RecentViewed": { RecentViewed: makeStub() },
    "@/components/OnboardingSheet": { OnboardingSheet: makeStub() },
    "@/components/Skeleton": { ListSkeleton: makeStub() },
    "@/components/ErrorState": { ErrorState: makeStub() },
  };
}

interface Home {
  /** 홈을 한 번 연다(마운트 + 복원 이펙트). 같은 tab 인스턴스의 재호출 = 같은 문서의 재마운트. */
  open(): View;
}
interface View {
  /** 화면에 실린 지역 필터. */
  regions(): string[];
  /** 지역 칩 조작 — 사용자가 직접 만진 필터. */
  pick(regions: string[]): void;
  /** 홈을 떠난다(다른 탭으로 이동). */
  leave(): void;
}

/** 새 탭(새 문서) 하나. 모듈 스코프 플래그가 초기화돼 첫 open은 직접 진입이 된다. */
function openTab(): Home {
  const stub = createReactStub();
  const page = loadModule<{ default: () => unknown }>(
    "src/app/page.tsx",
    pageStubs(stub.react),
  );
  return {
    open() {
      const view: Mounted<unknown> = stub.mount(() => page.default());
      view.render(); // 마운트 렌더 + 복원 이펙트
      const settled = view.render(); // 이펙트 결과가 실린 트리
      return {
        regions: () => propsOf(settled, RegionFilter).regions as string[],
        pick: (regions: string[]) => {
          const onChange = propsOf(settled, RegionFilter).onChange as (
            r: string[],
            d: string[],
          ) => void;
          onChange(regions, []);
        },
        leave: () => view.unmount(),
      };
    },
  };
}

describe("관심조건 변경이 홈에 반영된다(감사 3차 32)", () => {
  it("/me에서 바꾼 조건이 홈 복귀에 열리고, 다시 홈에 들어와도 유지된다", () => {
    const tab = openTab();

    // ① 홈에서 서울을 직접 고른다 — 미러·URL이 함께 서울이 된다.
    const first = tab.open();
    first.pick(["서울"]);
    expect(win.session.map.get(MIRROR_KEY)).toBe("?r=%EC%84%9C%EC%9A%B8");
    expect(win.url()).toBe("?r=%EC%84%9C%EC%9A%B8");
    first.leave();

    // ② /me에서 관심조건을 부산으로 저장한다(PrefsEditor가 하는 일 그대로).
    expect(setPrefs({ regions: ["부산"], priceBands: [] }, Date.now() + 5)).toBe(true);
    expect(win.session.map.has(MIRROR_KEY)).toBe(false);

    // ③ 홈 복귀 — 주소창은 떠날 때의 스냅샷(서울)이지만 열려야 할 조건은 부산이다.
    const second = tab.open();
    expect(second.regions()).toEqual(["부산"]);
    // 옛 조건이 미러로 부활하면 이후 진입이 전부 옛 조건이 된다 — 되쓰기 값도 새 조건이어야 한다.
    expect(win.session.map.get(MIRROR_KEY)).toBe("?r=%EB%B6%80%EC%82%B0");
    second.leave();

    // ④ 하단탭 [홈]으로 다시 진입(주소창 쿼리 없음) — 새 조건이 유지된다.
    win.setUrl("");
    expect(tab.open().regions()).toEqual(["부산"]);
  });

  it("미러 무효화가 막힌 기기에서도 저장 시각이 새 조건을 앞세운다", () => {
    const tab = openTab();
    const first = tab.open();
    first.pick(["서울"]);
    first.leave();

    win.session.blockRemove = true; // 세션 삭제가 막힌 저장소 — 미러가 옛 조건 그대로 남는다
    setPrefs({ regions: ["부산"], priceBands: [] }, Date.now() + 5);
    expect(win.session.map.get(MIRROR_KEY)).toBe("?r=%EC%84%9C%EC%9A%B8");

    win.setUrl("");
    expect(tab.open().regions()).toEqual(["부산"]);
  });

  it("새 문서의 공유 링크는 저장한 관심조건보다 URL이 앞선다", () => {
    setPrefs({ regions: ["부산"], priceBands: [] });
    win.setUrl("?r=%EC%84%9C%EC%9A%B8");

    expect(openTab().open().regions()).toEqual(["서울"]); // 새 탭 = 방문 의도가 곧 URL
  });

  it("리스트에서 바꾼 조건(시각 미상 미러)은 옛 관심조건으로 덮이지 않는다(감사 2차 55)", () => {
    setPrefs({ regions: ["부산"], priceBands: [] });
    const tab = openTab();
    tab.open().leave();

    // 리스트 화면의 미러 갱신은 기록 시각을 남기지 않는다 — 그래도 이 세션의 최신값이다.
    win.session.map.set(MIRROR_KEY, "?r=%EA%B2%BD%EA%B8%B0");
    win.session.map.delete(MIRROR_AT_KEY);
    win.setUrl("");

    expect(tab.open().regions()).toEqual(["경기"]);
  });

  it("저장한 조건이 없으면 필터를 걸지 않는다(첫 방문)", () => {
    expect(openTab().open().regions()).toEqual([]);
  });
});

describe("복원 우선순위 표(chooseHomeRestore)", () => {
  const base: HomeRestoreInput = {
    remounted: false,
    hasUrlFilters: false,
    hasMirror: false,
    mirrorAt: null,
    prefsSavedAt: 0,
  };
  const at = (over: Partial<HomeRestoreInput>) => chooseHomeRestore({ ...base, ...over });

  it("새 문서의 URL이 최우선", () => {
    expect(at({ hasUrlFilters: true, prefsSavedAt: 100 })).toBe("url");
  });
  it("재마운트에서 관심조건이 미러보다 최신이면 관심조건", () => {
    expect(
      at({ remounted: true, hasUrlFilters: true, hasMirror: true, mirrorAt: 100, prefsSavedAt: 200 }),
    ).toBe("prefs");
  });
  it("미러가 관심조건보다 최신이면 미러", () => {
    expect(at({ remounted: true, hasMirror: true, mirrorAt: 300, prefsSavedAt: 200 })).toBe("mirror");
  });
  it("시각 미상 미러는 최신으로 본다", () => {
    expect(at({ remounted: true, hasMirror: true, mirrorAt: null, prefsSavedAt: 200 })).toBe("mirror");
  });
  it("저장 시각이 없는 구버전 값은 종전 순서(URL → 미러 → 관심조건)를 그대로 쓴다", () => {
    expect(at({ remounted: true, hasUrlFilters: true, hasMirror: true, mirrorAt: null })).toBe("mirror");
    expect(at({ remounted: true, hasUrlFilters: true })).toBe("url");
    expect(at({ remounted: true })).toBe("prefs");
  });
});

describe("관심조건 저장 시각(Prefs.savedAt)", () => {
  it("저장할 때마다 시각을 남긴다", () => {
    setPrefs({ regions: ["대구"], priceBands: [] }, 1_700_000_000_000);
    expect(getWatchState().prefs.savedAt).toBe(1_700_000_000_000);
  });

  it("구버전 저장값(시각 없음)은 그대로 읽힌다", () => {
    win.local.map.set(
      WATCH_KEY,
      JSON.stringify({ items: {}, prefs: { regions: ["제주"], priceBands: ["b1"] } }),
    );
    expect(getWatchState().prefs).toEqual({ regions: ["제주"], priceBands: ["b1"] });
  });

  it("손상된 시각은 폐기하고 복구본으로 치환 저장한다", () => {
    win.local.map.set(
      WATCH_KEY,
      JSON.stringify({ items: {}, prefs: { regions: ["제주"], priceBands: [], savedAt: "어제" } }),
    );
    expect(getWatchState().prefs.savedAt).toBeUndefined();
    expect(JSON.parse(win.local.map.get(WATCH_KEY) ?? "{}").prefs.savedAt).toBeUndefined();
  });
});
