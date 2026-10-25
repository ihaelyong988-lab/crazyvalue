import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as jsxRuntime from "react/jsx-runtime";
import * as watchlist from "@/lib/watchlist";
import * as catalog from "@/types/catalog";
import * as format from "@/lib/format";
import type { AuctionItem } from "@/types/auction";
import {
  click, createReactStub, find, installWindow, loadModule, makeStub, propsOf, textOf,
  type Mounted, type TestWindow,
} from "./react-harness";

const WATCH_KEY = "crazyvalue.watchlist.v1";
const ITEM: AuctionItem = {
  id: "gyeonggi-2025타경10000-1", court: "수원지방법원", caseNo: "2025타경10000", itemNo: "1",
  category: "아파트", address: "경기 수원시 영통구 중앙로 1", region: "경기", district: "수원시 영통구",
  appraisalPrice: 100_000_000, minPrice: 49_000_000, priceRatio: 0.49, failCount: 2,
  saleDate: "2026-11-01", saleTime: "10:00", courtRoom: "경매법정 제1호", deposit: 4_900_000,
  areaBuilding: 84.9, areaLand: null, photoUrl: null, detailUrl: "https://www.courtauction.go.kr/",
  history: [], specialNote: null,
};

let win: TestWindow;
let view: Mounted<unknown> | undefined;
let dataset: { status: "ready"; items: AuctionItem[]; retry: () => void };
let Card: ReturnType<typeof makeStub>;
let Empty: ReturnType<typeof makeStub>;

// The shared harness deliberately returns fresh callbacks. These screens have callback-dependent
// subscriptions, so retain React's dependency semantics without changing the shared test utility.
function hooksForWatch() {
  const hooks = createReactStub();
  const refCell = hooks.react.useRef as <T>(value: T) => { current: T };
  hooks.react.useCallback = <T>(fn: T, deps: unknown[]) => {
    const ref = refCell({ fn, deps });
    if (deps.some((d, i) => !Object.is(d, ref.current.deps[i]))) ref.current = { fn, deps };
    return ref.current.fn;
  };
  return hooks;
}

function draw() {
  view!.render();
  return view!.render();
}

function mountPage() {
  const hooks = hooksForWatch();
  Card = makeStub();
  Empty = makeStub();
  const page = loadModule<{ default: () => unknown }>("src/app/watch/page.tsx", {
    react: hooks.react, "react/jsx-runtime": jsxRuntime, "next/link": { default: makeStub() },
    "@/types/catalog": catalog, "@/lib/format": format, "@/lib/watchlist": watchlist,
    "@/lib/use-auction-data": { useAuctionData: () => dataset },
    "@/components/WatchCard": { WatchCard: Card },
    "@/components/Skeleton": { ListSkeleton: makeStub() },
    "@/components/ErrorState": { ErrorState: makeStub() },
    "@/components/EmptyState": { EmptyState: Empty },
  });
  view = hooks.mount(page.default);
  return draw();
}

function removeCard(tree: unknown) {
  const card = propsOf(tree, Card);
  (card.onRemove as (id: string) => void)(ITEM.id);
  return draw();
}

function alert(tree: unknown) {
  return find(tree, (el) => el.props.role === "alert");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T00:00:00Z"));
  win = installWindow();
  Object.assign(window, { setTimeout, clearTimeout });
  dataset = { status: "ready", items: [ITEM], retry: () => {} };
  watchlist.toggleWatch(ITEM, new Date("2026-07-20T00:00:00Z"));
});

afterEach(() => {
  view?.unmount();
  view = undefined;
  vi.useRealTimers();
});

describe("watch page persistence and current-list evidence", () => {
  it("a missing current item is unavailable in this list without claiming a sale result", () => {
    dataset.items = [];
    const tree = mountPage();
    expect(textOf(tree)).toContain("현재 목록 확인 불가");
    expect(textOf(tree)).not.toMatch(/매각 종료|매각·취하/);
    expect(textOf(tree)).toContain("4,900만");
    expect(watchlist.getWatchState().items[ITEM.id]).toBeDefined();
  });

  it("a failed remove retains the card and reports failure without offering undo", () => {
    const tree = mountPage();
    win.local.blockWrite = true;
    const after = removeCard(tree);
    expect(find(after, (el) => el.type === Card)).not.toBeNull();
    expect(alert(after)).not.toBeNull();
    expect(textOf(after)).not.toContain("되돌리기");
    expect(watchlist.getWatchState().items[ITEM.id]).toBeDefined();
  });

  it("successful remove is persisted immediately and undo retains original registration", () => {
    const entry = watchlist.getWatchState().items[ITEM.id];
    const after = removeCard(mountPage());
    expect(watchlist.getWatchState().items[ITEM.id]).toBeUndefined();
    expect(textOf(after)).toContain("되돌리기");
    click(after, "되돌리기");
    expect(find(draw(), (el) => el.type === Card)).not.toBeNull();
    expect(watchlist.getWatchState().items[ITEM.id]).toEqual(entry);
  });

  it("failed undo keeps the item removed and permits another save attempt", () => {
    let tree = removeCard(mountPage());
    win.local.blockWrite = true;
    click(tree, "되돌리기");
    tree = draw();
    expect(find(tree, (el) => el.type === Card)).toBeNull();
    expect(watchlist.getWatchState().items[ITEM.id]).toBeUndefined();
    expect(alert(tree)).not.toBeNull();
    expect(textOf(tree)).toContain("되돌리기");
    vi.advanceTimersByTime(9_000);
    tree = draw();
    expect(alert(tree)).not.toBeNull();
    expect(textOf(tree)).toContain("되돌리기");
    win.local.blockWrite = false;
    click(tree, "되돌리기");
    expect(find(draw(), (el) => el.type === Card)).not.toBeNull();
  });

  it("undo retains a change badge that was acknowledged before removing", () => {
    dataset.items = [{ ...ITEM, minPrice: 34_300_000 }];
    const after = removeCard(mountPage());
    click(after, "되돌리기");
    const restored = propsOf(draw(), Card);
    expect(restored.diff).toBe("재유찰");
    expect(restored.prev).toEqual({ minPrice: 49_000_000, saleDate: "2026-11-01" });
  });

  it("undo cannot acknowledge an unseen newer registration with this tab's stale dataset", () => {
    const after = removeCard(mountPage());
    const newerEntry = {
      addedAt: "2026-10-25T01:00:00.000Z",
      snapshot: {
        minPrice: 34_300_000, saleDate: "2026-11-08", failCount: 3,
        address: ITEM.address, category: ITEM.category,
      },
    };
    const state = watchlist.getWatchState();
    state.items[ITEM.id] = newerEntry;
    win.local.map.set(WATCH_KEY, JSON.stringify(state));
    // The second tab's storage notification has not reached this page yet.
    click(after, "되돌리기");
    expect(find(draw(), (el) => el.type === Card)).not.toBeNull();
    expect(watchlist.getWatchState().items[ITEM.id]).toEqual(newerEntry);
  });

  it("cross-tab changes update cards and a reset cancels stale undo", () => {
    mountPage();
    win.local.map.set(WATCH_KEY, JSON.stringify({ items: {}, prefs: { regions: [], priceBands: [] } }));
    win.fireStorage(WATCH_KEY);
    expect(propsOf(draw(), Empty).title).toContain("관심 물건");
    watchlist.toggleWatch(ITEM);
    win.fireStorage(WATCH_KEY);
    const tree = draw();
    expect(find(tree, (el) => el.type === Card)).not.toBeNull();
    removeCard(tree);
    win.local.map.delete(WATCH_KEY);
    win.fireStorage(null);
    expect(textOf(draw())).not.toContain("되돌리기");
    expect(watchlist.getWatchState().items).toEqual({});
  });

  it("unmount after remove cannot perform a later write", () => {
    removeCard(mountPage());
    win.local.blockWrite = true;
    view!.unmount();
    vi.advanceTimersByTime(9_000);
    expect(watchlist.getWatchState().items[ITEM.id]).toBeUndefined();
  });

  it("storage sync cannot overwrite another tab's newer snapshot with this tab's older dataset", () => {
    mountPage();
    const state = watchlist.getWatchState();
    state.items[ITEM.id].snapshot.saleDate = "2026-11-08";
    win.local.map.set(WATCH_KEY, JSON.stringify(state));
    win.fireStorage(WATCH_KEY);
    expect(propsOf(draw(), Card).diff).toBe("기일 변경");
    expect(watchlist.getWatchState().items[ITEM.id].snapshot.saleDate).toBe("2026-11-08");
  });

  it("snapshot acknowledgement failure preserves the previous value and is visible", () => {
    dataset.items = [{ ...ITEM, minPrice: 34_300_000 }];
    win.local.blockWrite = true;
    const tree = mountPage();
    expect(propsOf(tree, Card).diff).toBe("재유찰");
    expect(alert(tree)).not.toBeNull();
    expect(watchlist.getWatchState().items[ITEM.id].snapshot.minPrice).toBe(49_000_000);
  });

  it("failed session-cache persistence leaves the old snapshot available next visit", () => {
    dataset.items = [{ ...ITEM, minPrice: 34_300_000 }];
    win.session.blockWrite = true;
    const tree = mountPage();
    expect(alert(tree)).not.toBeNull();
    expect(watchlist.getWatchState().items[ITEM.id].snapshot.minPrice).toBe(49_000_000);
  });
});

describe("watch toggle", () => {
  function mountToggle() {
    const hooks = hooksForWatch();
    const toggle = loadModule<{ WatchToggle: (props: { item: AuctionItem }) => unknown }>("src/components/WatchToggle.tsx", {
      react: hooks.react, "react/jsx-runtime": jsxRuntime,
      "lucide-react": { Star: makeStub() }, "@/lib/watchlist": watchlist,
    });
    view = hooks.mount(() => toggle.WatchToggle({ item: ITEM }));
    return draw();
  }

  it("a failed write keeps the persisted pressed state and shows an alert", () => {
    const tree = mountToggle();
    win.local.blockWrite = true;
    click(tree, "관심등록됨");
    const after = draw();
    expect(propsOf(after, "button")["aria-pressed"]).toBe(true);
    expect(alert(after)).not.toBeNull();
  });

  it("cross-tab removal updates the pressed state", () => {
    mountToggle();
    win.local.map.delete(WATCH_KEY);
    win.fireStorage(WATCH_KEY);
    expect(propsOf(draw(), "button")["aria-pressed"]).toBe(false);
  });
});
