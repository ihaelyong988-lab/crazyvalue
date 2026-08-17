import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import * as jsxRuntime from "react/jsx-runtime";
import * as catalog from "@/types/catalog";
import * as dataLib from "@/lib/data";
import * as watchlist from "@/lib/watchlist";
import type { AuctionItem } from "@/types/auction";
import { createReactStub, find, loadModule, makeStub, textOf } from "./react-harness";

// 이탈 가드 회귀(감사 3차 97·99).
//   97 — 앱 안으로 돌아가는 뒤로가기까지 가로챘다(홈→리스트→홈에서 뒤로 = "저장 없이 나가기").
//        홈 방문마다 센티넬이 1칸씩 더 쌓여 이력도 불어났다(실측: 화면 5개인데 9칸).
//   99 — 갱신에서 내려간 id를 세어 홈 "최근 본 물건"은 0건인데 시트만 1건이라며 가드했다.
// 판정은 실제 순서(마운트 → 이펙트 → 이력 이동 → 재마운트)를 그대로 돌려 **이력 칸 수·시트 개폐**로 한다.
// .tsx는 vitest의 vite 파이프라인이 파싱하지 못한다(tsconfig `jsx: "preserve"`) — react-harness가
// esbuild로 직접 컴파일해 싣는다(onboarding-exit.test.ts와 같은 경로).

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WATCH_KEY = "crazyvalue.watchlist.v1";
const RECENT_KEY = "crazyvalue.recent.v1";
const NAV_KEY = "crazyvalue.nav.v1";

/** 산출물에서 물건을 고른다 — 고정 id 금지(갱신마다 물건이 바뀐다, e2e fixture.ts와 같은 규약). */
function pickFixture(count: number): { region: string; items: AuctionItem[] } {
  for (const region of catalog.REGIONS) {
    const file = path.join(ROOT, "public", "data", `${region.key}.json`);
    const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(raw)) continue;
    const items = raw.filter(dataLib.isValidAuctionItem);
    if (items.length >= count) return { region: region.key, items: items.slice(0, count) };
  }
  throw new Error("산출물에서 픽스처를 고르지 못했다");
}

const FIXTURE = pickFixture(3);

// ---- 브라우저 셧 ----
// 이력은 배열 + 커서다. 뒤로가기는 커서를 내리고 popstate를 쏘며, 커서가 0인 곳에서의 뒤로가기는
// 앱 밖으로 나간 것으로 기록한다(문서가 바뀌므로 실제 브라우저에서도 popstate가 오지 않는다).

interface Entry {
  state: unknown;
  pathname: string;
}

interface Browser {
  entries: Entry[];
  /** 앱 밖으로 나갔는가("그대로 나가기"의 결과). */
  exited: boolean;
  local: Map<string, string>;
  session: Map<string, string>;
  /** true면 localStorage 쓰기가 던진다 — 용량 초과·프라이빗 모드 모사. */
  blockLocalWrite: boolean;
  /** 이 이력에 쌓인 센티넬 칸 수. */
  sentinels(): number;
  listenerCount(type: string): number;
  back(): void;
  drainTimers(): void;
}

// 실제 브라우저의 location.pathname은 퍼센트 인코딩이고 usePathname()은 디코드된 값을 줄 수 있다 —
// 물건 id에 한글이 들어가므로 그 어긋남까지 그대로 재현한다(둘을 문자열로만 비교하면 칸 수가 어긋난다).
const pathOf = (url: string): string =>
  encodeURI(url.startsWith("http") ? new URL(url).pathname : url.split("?")[0]);

/** 화면이 보는 경로 = 디코드된 pathname. */
const screenPath = (): string => decodeURIComponent(window.location.pathname);

function installBrowser(startPath: string, payloads: Record<string, unknown>): Browser {
  const state = {
    entries: [{ state: null as unknown, pathname: startPath }] as Entry[],
    index: 0,
    exited: false,
    blockLocalWrite: false,
  };
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const timers = new Map<number, () => void>();
  let nextTimer = 1;

  const storage = (map: Map<string, string>, blockable: boolean) => ({
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (blockable && state.blockLocalWrite) {
        const err = new Error("mock QuotaExceededError");
        err.name = "QuotaExceededError";
        throw err;
      }
      map.set(k, v);
    },
    removeItem: (k: string) => map.delete(k),
    clear: () => map.clear(),
  });

  const fire = (type: string) => {
    for (const fn of [...(listeners.get(type) ?? [])]) fn({});
  };

  const win = {
    localStorage: storage(local, true),
    sessionStorage: storage(session, false),
    location: {
      get pathname() {
        return state.entries[state.index].pathname;
      },
      get href() {
        return `https://cv.test${state.entries[state.index].pathname}`;
      },
    },
    history: {
      get state() {
        return state.entries[state.index].state;
      },
      get length() {
        return state.entries.length;
      },
      pushState(next: unknown, _title: string, url: string) {
        state.entries.splice(state.index + 1);
        state.entries.push({ state: next, pathname: pathOf(url) });
        state.index += 1;
      },
      replaceState(next: unknown, _title: string, url: string) {
        state.entries[state.index] = { state: next, pathname: pathOf(url) };
      },
      back() {
        if (state.index === 0) {
          state.exited = true; // 문서가 바뀐다 = popstate 없음
          return;
        }
        state.index -= 1;
        fire("popstate");
      },
    },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      const set = listeners.get(type) ?? new Set<(e: unknown) => void>();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners.get(type)?.delete(fn);
    },
    setTimeout: (fn: () => void) => {
      const id = nextTimer++;
      timers.set(id, fn);
      return id;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    },
  };

  (globalThis as unknown as { window: unknown }).window = win;
  (globalThis as unknown as { fetch: unknown }).fetch = (url: string) => {
    const key = url.replace("/data/", "").replace(".json", "");
    const body = payloads[key];
    if (body === undefined) return Promise.resolve({ ok: false, json: () => Promise.resolve(null) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  };

  return {
    entries: state.entries,
    get exited() {
      return state.exited;
    },
    local,
    session,
    get blockLocalWrite() {
      return state.blockLocalWrite;
    },
    set blockLocalWrite(v: boolean) {
      state.blockLocalWrite = v;
    },
    sentinels: () =>
      state.entries.filter(
        (e) => (e.state as { cvExitGuard?: boolean } | null)?.cvExitGuard === true,
      ).length,
    listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
    back: () => win.history.back(),
    drainTimers: () => {
      const queued = [...timers.values()];
      timers.clear();
      for (const fn of queued) fn();
    },
  };
}

/** 마이크로태스크(산출물 조회) → 타이머(센티넬) → 마이크로태스크 순으로 밀린 일을 전부 흘린다. */
async function settle(browser: Browser): Promise<void> {
  for (let round = 0; round < 2; round += 1) {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    browser.drainTimers();
  }
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

// ---- 가드 마운트 ----

interface GuardModule {
  ExitGuard: () => unknown;
  presentRecent: (find: (id: string) => AuctionItem | undefined) => AuctionItem[];
  planSentinel: (input: { onSentinel: boolean; depth: number }) => string;
  isExitBack: (input: { armed: boolean; depth: number; from: string; to: string }) => boolean;
  hasAppNavigated: () => boolean;
  appHistoryDepth: () => number;
}

interface Guard {
  browser: Browser;
  module: GuardModule;
  /** 시트가 열려 있는가. */
  sheetOpen(): boolean;
  /** 시트에 실린 글자 전량. */
  sheetText(): string;
  /** 시트 버튼을 누른다. */
  press(label: string): void;
  /** 앱 내 화면 이동(Link 클릭 = 라우터 push). */
  go(pathname: string): Promise<void>;
  /** 브라우저 뒤로가기 1회. */
  back(): Promise<void>;
  /** router.push로 요청된 경로 목록. */
  pushes: string[];
}

interface Seed {
  /** 최근 본 물건 id(최신 순). */
  recent: string[];
  /** 산출물에 실을 물건 — 여기 없는 id는 "갱신에서 내려간" 물건이다. */
  present?: AuctionItem[];
  /** 관심함에 미리 담아 둘 물건. */
  watched?: AuctionItem[];
  startPath?: string;
}

async function mountGuard(seed: Seed): Promise<Guard> {
  const present = seed.present ?? FIXTURE.items;
  const browser = installBrowser(seed.startPath ?? "/", { [FIXTURE.region]: present });
  browser.local.set(
    WATCH_KEY,
    JSON.stringify({ items: {}, prefs: { regions: [], priceBands: [] }, onboarded: true }),
  );
  browser.local.set(RECENT_KEY, JSON.stringify({ ids: seed.recent }));
  for (const item of seed.watched ?? []) watchlist.toggleWatch(item);

  const stub = createReactStub();
  let currentPath = seed.startPath ?? "/";
  const pushes: string[] = [];
  const mod = loadModule<GuardModule>("src/components/ExitGuard.tsx", {
    react: stub.react,
    "react/jsx-runtime": jsxRuntime,
    "next/navigation": {
      usePathname: () => currentPath,
      useRouter: () => ({
        push: (url: string) => {
          pushes.push(url);
        },
      }),
    },
    "lucide-react": { X: makeStub() },
    "@/types/catalog": catalog,
    "@/lib/data": dataLib,
    "@/lib/watchlist": watchlist,
  });

  const view = stub.mount(() => mod.ExitGuard());
  let tree: unknown = view.render();
  const rerender = () => {
    tree = view.render();
  };

  const guard: Guard = {
    browser,
    module: mod,
    pushes,
    sheetOpen: () => find(tree, (el) => el.props.role === "dialog") !== null,
    sheetText: () => textOf(tree),
    press: (label: string) => {
      const button = find(tree, (el) => el.type === "button" && textOf(el).trim() === label);
      if (button === null) throw new Error(`버튼을 찾지 못했다: ${label}`);
      (button.props.onClick as () => void)();
      rerender();
    },
    go: async (pathname: string) => {
      (window as unknown as { history: History }).history.pushState({ __NA: true }, "", pathname);
      currentPath = screenPath();
      rerender();
      await settle(browser);
      rerender();
    },
    back: async () => {
      browser.back();
      currentPath = screenPath();
      rerender();
      await settle(browser);
      rerender();
    },
  };
  await settle(browser);
  rerender();
  return guard;
}

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

// ---- 판정 표(순수 함수) ----

describe("이력 칸 판정(감사 3차 97)", () => {
  const guardModule = () =>
    loadModule<GuardModule>("src/components/ExitGuard.tsx", {
      react: createReactStub().react,
      "react/jsx-runtime": jsxRuntime,
      "next/navigation": { usePathname: () => "/", useRouter: () => ({ push: () => {} }) },
      "lucide-react": { X: makeStub() },
      "@/types/catalog": catalog,
      "@/lib/data": dataLib,
      "@/lib/watchlist": watchlist,
    });

  it("센티넬은 진입 칸에서만 쌓고, 돌아갈 칸이 남아 있으면 건너뛴다", () => {
    const { planSentinel } = guardModule();
    expect(planSentinel({ onSentinel: false, depth: 0 })).toBe("push");
    expect(planSentinel({ onSentinel: false, depth: 1 })).toBe("skip"); // 홈→리스트→홈의 그 홈
    expect(planSentinel({ onSentinel: true, depth: 1 })).toBe("arm"); // 이미 센티넬 위 — 다시 쌓지 않는다
  });

  it("시트는 앱 밖으로 나가는 뒤로가기에서만 연다", () => {
    const { isExitBack } = guardModule();
    const base = { armed: true, depth: 0, from: "/", to: "/" };
    expect(isExitBack(base)).toBe(true);
    expect(isExitBack({ ...base, depth: 1 })).toBe(false); // 앱이 만든 칸이 남았다 = 앱 안으로 간다
    expect(isExitBack({ ...base, armed: false })).toBe(false);
    expect(isExitBack({ ...base, to: "/list" })).toBe(false);
    expect(isExitBack({ ...base, from: "/list" })).toBe(false);
  });

  it("구버전 세션값 \"1\"은 칸 1개로 읽힌다(상세 뒤로 버튼 계약 유지)", () => {
    const browser = installBrowser("/", {});
    const { hasAppNavigated, appHistoryDepth } = guardModule();
    expect(hasAppNavigated()).toBe(false); // 직접 진입 = 폴백(/list)
    browser.session.set(NAV_KEY, "1");
    expect(appHistoryDepth()).toBe(1);
    expect(hasAppNavigated()).toBe(true);
  });
});

// ---- 앱 안으로 돌아가는 뒤로가기(97) ----

describe("앱 안으로 돌아가는 뒤로가기는 가로채지 않는다(감사 3차 97)", () => {
  it("홈→리스트→홈에서 뒤로 누르면 시트 없이 리스트로 간다", async () => {
    const guard = await mountGuard({ recent: [FIXTURE.items[0].id] });
    expect(guard.browser.sentinels()).toBe(1); // 진입 칸 위 1개

    await guard.go("/list");
    await guard.go("/");
    expect(guard.browser.sentinels()).toBe(1); // 홈 재방문은 센티넬을 더 쌓지 않는다

    await guard.back();

    expect(guard.sheetOpen()).toBe(false);
    expect(screenPath()).toBe("/list");
  });

  it("화면 5개를 오가도 이력은 화면 수 + 센티넬 1칸이다", async () => {
    const guard = await mountGuard({ recent: [FIXTURE.items[0].id] });
    await guard.go("/list");
    await guard.go("/");
    await guard.go("/list");
    await guard.go("/");

    // 방문 화면 5개(홈·리스트·홈·리스트·홈) + 센티넬 1 = 6칸. 방문마다 쌓으면 8칸이 된다.
    expect(guard.browser.entries.length).toBe(6);
    expect(guard.browser.sentinels()).toBe(1);
  });

  it("깊이 들어갔다 되돌아오면 진입 칸에서만 시트가 열리고, 나가기는 실제로 앱을 나간다", async () => {
    const guard = await mountGuard({ recent: [FIXTURE.items[0].id] });
    await guard.go("/list");
    await guard.go(`/item/${FIXTURE.items[0].id}`);
    await guard.go("/");

    for (const expected of [`/item/${FIXTURE.items[0].id}`, "/list", "/"]) {
      await guard.back();
      expect(guard.sheetOpen()).toBe(false); // 앱 안으로 가는 뒤로가기 3회 — 전부 통과
      expect(screenPath()).toBe(expected);
    }

    await guard.back(); // 센티넬 소진 = 다음 칸이 앱 밖이다
    expect(guard.sheetOpen()).toBe(true);

    guard.press("그대로 나가기");
    expect(guard.browser.exited).toBe(true);
  });

  it("직접 진입한 홈에서 첫 뒤로가기는 시트를 연다", async () => {
    const guard = await mountGuard({ recent: [FIXTURE.items[0].id] });
    await guard.back();
    expect(guard.sheetOpen()).toBe(true);
    expect(guard.sheetText()).toContain("저장 없이 나가기");
  });
});

// ---- 갱신에서 내려간 물건(99) ----

describe("가드는 현재 산출물에 남은 최근 물건만 센다(감사 3차 99)", () => {
  const goneId = `${FIXTURE.region}-2024타경999999-9`;

  it("최근 목록이 전부 내려간 물건이면 가드하지 않는다", async () => {
    const guard = await mountGuard({ recent: [goneId] });

    expect(guard.browser.sentinels()).toBe(0);
    expect(guard.browser.listenerCount("beforeunload")).toBe(0);

    await guard.back();
    expect(guard.sheetOpen()).toBe(false);
    expect(guard.browser.exited).toBe(true); // 가로채지 않았으니 그대로 나간다
  });

  it("홈 섹션과 시트가 같은 건수를 말한다", async () => {
    const [a, b] = FIXTURE.items;
    const guard = await mountGuard({ recent: [goneId, a.id, b.id], present: [a, b] });
    await guard.back();

    expect(guard.sheetOpen()).toBe(true);
    expect(guard.sheetText()).toContain("2건"); // 원본 3건 중 산출물에 남은 2건

    // 홈 "최근 본 물건" 섹션도 같은 판정을 쓴다 — 카드 수가 시트 건수와 어긋나면 안 된다.
    const byId = new Map([a, b].map((i) => [i.id, i]));
    expect(guard.module.presentRecent((id) => byId.get(id)).map((i) => i.id)).toEqual([a.id, b.id]);
  });

  it("저장 CTA는 산출물에 남은 가장 최근 물건을 실제로 등록하고 그 상세로 보낸다", async () => {
    const [a, b] = FIXTURE.items;
    const guard = await mountGuard({ recent: [goneId, a.id, b.id], present: [a, b] });
    await guard.back();

    guard.press("가장 최근 물건 저장");

    expect(Object.keys(watchlist.getWatchState().items)).toEqual([a.id]);
    expect(guard.pushes).toEqual([`/item/${a.id}`]);
    expect(guard.sheetOpen()).toBe(false);
  });

  it("저장이 막힌 기기에서는 성공한 척하지 않는다", async () => {
    const guard = await mountGuard({ recent: [FIXTURE.items[0].id] });
    await guard.back();

    guard.browser.blockLocalWrite = true;
    guard.press("가장 최근 물건 저장");

    expect(guard.sheetText()).toContain("이 기기에 저장하지 못했다");
    expect(guard.pushes).toEqual([]);
    expect(guard.sheetOpen()).toBe(true);
  });

  it("관심함에 1건이라도 있으면 무장하지 않는다", async () => {
    const guard = await mountGuard({
      recent: [FIXTURE.items[0].id],
      watched: [FIXTURE.items[0]],
    });

    expect(guard.browser.sentinels()).toBe(0);
    expect(guard.browser.listenerCount("beforeunload")).toBe(0);
  });
});

// ---- 홈 섹션이 같은 판정을 쓴다 ----

describe("RecentViewed는 가드와 같은 판정을 공유한다(감사 3차 99)", () => {
  it("산출물에 없는 id는 카드로 그리지 않는다", async () => {
    const [a, b] = FIXTURE.items;
    const guard = await mountGuard({ recent: [`${FIXTURE.region}-없는물건-1`, a.id, b.id] });

    const stub = createReactStub();
    const ItemCard = makeStub();
    const { RecentViewed } = loadModule<{
      RecentViewed: (p: { items: AuctionItem[] }) => unknown;
    }>("src/components/RecentViewed.tsx", {
      react: stub.react,
      "react/jsx-runtime": jsxRuntime,
      "@/components/ExitGuard": guard.module,
      "@/components/ItemCard": { ItemCard },
    });

    const view = stub.mount(() => RecentViewed({ items: [a, b] }));
    view.render();
    const tree = view.render();

    const cards: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node !== "object" || node === null || !("props" in node)) return;
      const el = node as { type: unknown; props: { children?: unknown; item?: AuctionItem } };
      if (el.type === ItemCard && el.props.item) cards.push(el.props.item.id);
      walk(el.props.children);
    };
    walk(tree);

    expect(cards).toEqual([a.id, b.id]);
  });
});
