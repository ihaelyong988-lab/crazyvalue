import { beforeEach, describe, expect, it } from "vitest";
import * as jsxRuntime from "react/jsx-runtime";
import * as catalog from "@/types/catalog";
import * as dataLib from "@/lib/data";
import * as watchlist from "@/lib/watchlist";
import { getRecentIds, getWatchState, resetAll } from "@/lib/watchlist";
import {
  click,
  createReactStub,
  find,
  installWindow,
  loadModule,
  makeStub,
  textOf,
  type TestWindow,
} from "./react-harness";

// /me 초기화 회귀(감사 3차) — ② 초기화 실패인데 화면은 "0건" ③ 예고하지 않은 것까지 지운다.
// 두 결함 모두 "화면·확인 문구가 저장소 사실을 앞질렀다"는 한 뿌리다.

const WATCH_KEY = "crazyvalue.watchlist.v1";
const RECENT_KEY = "crazyvalue.recent.v1";
const INSTALL_KEY = "crazyvalue.install.v1";

let win: TestWindow;

beforeEach(() => {
  win = installWindow();
});

/** 관심함 3건 · 최근 본 물건 4건 · 닫은 설치 배너 기록. */
function seed(): void {
  const items: Record<string, unknown> = {};
  for (const id of ["a", "b", "c"]) {
    items[id] = {
      addedAt: "2026-08-01T00:00:00.000Z",
      snapshot: { minPrice: 49_000_000, saleDate: "2026-09-01", failCount: 2 },
    };
  }
  win.local.map.set(
    WATCH_KEY,
    JSON.stringify({ items, prefs: { regions: ["서울"], priceBands: [] } }),
  );
  win.local.map.set(RECENT_KEY, JSON.stringify({ ids: ["a", "b", "c", "d"] }));
  win.local.map.set(INSTALL_KEY, JSON.stringify({ dismissedAt: "2026-08-01T00:00:00.000Z" }));
}

interface Panel {
  /** 화면 글자 전량 — 건수 표기를 눈에 보이는 그대로 읽는다. */
  text(): string;
  /** 초기화 확인 시트를 열고 예고 문구를 돌려준다. */
  openConfirm(): string;
  /** 확인 시트의 [지우기]. */
  erase(): void;
}

/** /me 본문에서 저장 현황·초기화 블록만 떼어 마운트한다. */
function mountPanel(): Panel {
  const stub = createReactStub();
  const mod = loadModule<{ MeSettings: () => unknown }>("src/components/PrefsEditor.tsx", {
    react: stub.react,
    "react/jsx-runtime": jsxRuntime,
    "@/types/catalog": catalog,
    "@/lib/data": dataLib,
    "@/lib/watchlist": watchlist,
    "@/components/FilterChip": { FilterChip: makeStub() },
  });

  const settings = stub.mount(() => mod.MeSettings()).render();
  const found = find(settings, (el) => typeof el.type === "function" && "onCleared" in el.props);
  if (found === null) throw new Error("MyDataPanel을 찾지 못했다");
  const Component = found.type as (props: { onCleared: () => void }) => unknown;

  const view = stub.mount(() => Component({ onCleared: () => {} }));
  let tree = view.render();
  const draw = () => {
    tree = view.render();
    return tree;
  };
  return {
    text: () => textOf(draw()),
    openConfirm: () => {
      click(tree, "초기화");
      const desc = find(draw(), (el) => el.props.id === "cv-reset-desc");
      if (desc === null) throw new Error("확인 문구를 찾지 못했다");
      return textOf(desc).trim();
    },
    erase: () => {
      click(tree, "지우기");
      draw();
    },
  };
}

describe("초기화 실패 시 표시 건수(감사 3차)", () => {
  it("삭제가 막히면 실제 저장 건수를 그대로 표시한다", () => {
    seed();
    win.local.blockRemove = true;
    const panel = mountPanel();
    expect(panel.text()).toContain("관심함3건");

    panel.openConfirm();
    panel.erase();

    const shown = panel.text();
    expect(shown).toContain("이 기기에서 지우지 못했다"); // 실패는 알린다
    // 실패 알림과 "0건"이 한 화면에 동시에 뜨던 자리 — 건수는 저장소 사실이어야 한다.
    expect(shown).toContain("관심함3건");
    expect(shown).toContain("최근 본 물건4건");
    expect(Object.keys(getWatchState().items)).toHaveLength(3);
  });

  it("삭제에 성공하면 0건으로 바뀐다", () => {
    seed();
    const panel = mountPanel();
    expect(panel.text()).toContain("관심함3건");

    panel.openConfirm();
    panel.erase();

    const shown = panel.text();
    expect(shown).toContain("초기화됨.");
    expect(shown).toContain("관심함0건");
    expect(shown).toContain("최근 본 물건0건");
    expect(getRecentIds()).toEqual([]);
  });
});

describe("초기화는 예고한 것만 지운다(감사 3차)", () => {
  it("확인 문구가 예고하지 않은 설치 배너 해제 기록은 남는다", () => {
    seed();
    const panel = mountPanel();

    const notice = panel.openConfirm();
    expect(notice).toBe("관심함·최근 본 물건·관심조건이 사라지고 복구할 수 없다.");
    expect(notice).not.toMatch(/설치|배너/); // 예고에 없다 = 지우지 않는다

    panel.erase();

    expect(win.local.map.get(INSTALL_KEY)).toBe('{"dismissedAt":"2026-08-01T00:00:00.000Z"}');
    expect(win.local.map.has(WATCH_KEY)).toBe(false);
    expect(win.local.map.has(RECENT_KEY)).toBe(false);
  });

  it("보존 키를 뺀 나머지 crazyvalue.* 는 전량 지운다", () => {
    seed();
    win.local.map.set("crazyvalue.some-future-key.v1", "1"); // 뒤에 추가될 키도 조용히 살아남지 않는다
    win.session.map.set("crazyvalue.home-filters.v1", "?r=%EC%84%9C%EC%9A%B8");
    win.local.map.set("other.app.v1", "keep");

    expect(resetAll()).toBe(true);
    expect([...win.local.map.keys()].sort()).toEqual([INSTALL_KEY, "other.app.v1"]);
    expect([...win.session.map.keys()]).toEqual([]);
  });
});
