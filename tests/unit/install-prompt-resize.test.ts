import { describe, expect, it } from "vitest";
import * as jsxRuntime from "react/jsx-runtime";
import { createReactStub, loadModule, type Element as TreeElement } from "./react-harness";

// 감사 103 회귀 — 설치 배너가 resize마다 main 전수를 훑어 메인 스레드를 30~107ms 멈추던 결함.
// 실측(/list?n=500): resize 10회 동기 비용 774~806ms(회당 66.8~107.3ms) · 배너를 지우면 10회 전부 0.0ms.
//
// node에는 레이아웃이 없어 밀리초를 잴 수 없다. 그래서 **비용의 원천을 센다** —
// ① main 전수 스캔 횟수 ② getBoundingClientRect 호출 수(강제 레이아웃 유발 횟수)
// ③ resize 버스트가 rAF 1회로 묶이는지. 셋 중 하나라도 풀리면 774ms가 그대로 돌아온다.
//
// 같은 테스트가 원래 계약(감사 93)도 지킨다: 배너 bottom과 고정 CTA top이 정확히 접해야 한다.

/** 배너 기본 오프셋 = 하단 탭 높이. 제품 코드 상수와 같은 값이어야 접합 계산이 성립한다. */
const TABS_PX = 56;

interface Box {
  top: number;
  bottom: number;
  height: number;
}

interface Metrics {
  /** main 전수 스캔 횟수 — 감사 103의 비용원. */
  scans: number;
  /** getBoundingClientRect 총 호출 수 — 강제 레이아웃을 유발하는 지점. */
  rects: number;
  /** --cv-banner-h 기록 횟수 = 측정 반영이 실제로 돈 횟수. */
  applies: number;
  /** requestAnimationFrame 예약 횟수 — 버스트가 몇 프레임으로 묶였는가. */
  frames: number;
}

interface FakeElement {
  position: string;
  box: Box;
  isConnected: boolean;
  getBoundingClientRect(): Box;
}

function makeElement(position: string, box: Box, m: Metrics): FakeElement {
  return {
    position,
    box,
    isConnected: true,
    getBoundingClientRect() {
      m.rects++;
      return this.box;
    },
  };
}

interface Dom {
  metrics: Metrics;
  /** 화면 높이·CTA 위치를 바꾸고 resize를 n번 던진다(rAF는 아직 안 돈다). */
  resize(times: number, vh: number, cta?: Box): void;
  /** 다음 프레임 — 예약된 rAF 콜백을 전부 실행한다. */
  nextFrame(): void;
  setPath(next: string): void;
  path(): string;
  bannerHeight(): string | undefined;
  /** 고정 CTA를 떼었다 새로 붙인다 — 홈의 에러→재시도(ResultButton 재마운트)를 모사한다. */
  remountCta(box: Box): void;
}

/**
 * 실화면과 같은 규모의 문서를 세운다 — main 안 `fillers`개 + (있으면) 하단 고정 CTA 1개.
 * 감사 실측이 13,047개였으므로 스캔이 되살아나면 호출 수로 곧장 드러난다.
 */
function installDom(fillers: number, cta: Box | null): Dom {
  const m: Metrics = { scans: 0, rects: 0, applies: 0, frames: 0 };
  const all: FakeElement[] = [];
  for (let i = 0; i < fillers; i++) {
    all.push(makeElement("static", { top: 100, bottom: 200, height: 100 }, m));
  }
  let ctaEl = cta === null ? null : makeElement("fixed", { ...cta }, m);
  if (ctaEl !== null) all.push(ctaEl);

  const vars = new Map<string, string>();
  const onResize = new Set<() => void>();
  let pending: (() => void)[] = [];
  let vh = 800;
  let pathname = "/list";

  const main = {
    querySelectorAll: () => {
      m.scans++;
      return all;
    },
  };

  const doc = {
    querySelector: (sel: string) => (sel === "main" ? main : null),
    querySelectorAll: () => [], // 모달 조회 — 열린 시트 없음
    documentElement: {
      style: {
        setProperty: (key: string, value: string) => {
          if (key === "--cv-banner-h") m.applies++;
          vars.set(key, value);
        },
        removeProperty: (key: string) => vars.delete(key),
      },
    },
    body: {},
  };

  const win = {
    get innerHeight() {
      return vh;
    },
    matchMedia: () => ({ matches: false }), // 설치된 상태 아님
    navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    getComputedStyle: (el: FakeElement) => ({ position: el.position }),
    requestAnimationFrame: (cb: () => void) => {
      m.frames++;
      pending.push(cb);
      return pending.length; // 0은 "예약 없음"의 뜻이라 절대 돌려주지 않는다
    },
    cancelAnimationFrame: () => {},
    addEventListener: (type: string, fn: () => void) => {
      if (type === "resize") onResize.add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => {
      if (type === "resize") onResize.delete(fn);
    },
  };

  class Observer {
    observe() {}
    disconnect() {}
  }

  const g = globalThis as unknown as {
    window: unknown;
    document: unknown;
    MutationObserver: unknown;
  };
  g.window = win;
  g.document = doc;
  g.MutationObserver = Observer;

  return {
    metrics: m,
    resize(times, next, box) {
      vh = next;
      if (box !== undefined && ctaEl !== null) ctaEl.box = box;
      for (let i = 0; i < times; i++) for (const fn of [...onResize]) fn();
    },
    nextFrame() {
      const jobs = pending;
      pending = [];
      for (const job of jobs) job();
    },
    setPath: (next) => {
      pathname = next;
    },
    path: () => pathname,
    bannerHeight: () => vars.get("--cv-banner-h"),
    remountCta(box) {
      if (ctaEl === null) throw new Error("CTA 없는 문서에서는 재마운트를 모사할 수 없다");
      ctaEl.isConnected = false; // 떨어져 나간 옛 노드 — 배너가 담아 둔 것이 이것이다
      all.splice(all.indexOf(ctaEl), 1);
      ctaEl = makeElement("fixed", box, m);
      all.push(ctaEl); // 재시도로 새로 붙은 노드
    },
  };
}

interface PromptModule {
  InstallPrompt: () => unknown;
}

interface Mount {
  /** 다시 그려 지금 상태의 트리를 읽는다(이펙트가 부른 setState 반영). */
  render(): TreeElement;
}

/** iOS 안내 배너를 띄운 채 마운트한다 — 첫 렌더(노출 결정) → 재렌더(측정 이펙트 구독). */
function mountPrompt(dom: Dom): Mount {
  const stub = createReactStub();
  const mod = loadModule<PromptModule>("src/components/InstallPrompt.tsx", {
    react: stub.react,
    "react/jsx-runtime": jsxRuntime,
    "next/navigation": { usePathname: () => dom.path() },
  });
  const mounted = stub.mount(() => mod.InstallPrompt());
  mounted.render(); // mode=null — 노출 결정 이펙트가 여기서 돈다
  const tree = mounted.render() as TreeElement; // mode=ios — 측정 이펙트가 resize를 구독한다

  // 배너 자신의 높이도 측정 대상이다(--cv-banner-h). 실 DOM이 없으니 ref에 셧을 직접 물린다.
  const ref = tree.props.ref as { current: unknown } | undefined;
  if (ref === null || ref === undefined || typeof ref !== "object") {
    throw new Error("배너 ref를 트리에서 찾지 못했다 — 측정 대상이 빠진다");
  }
  ref.current = {
    getBoundingClientRect() {
      dom.metrics.rects++;
      return { height: 70 };
    },
  };

  return { render: () => mounted.render() as TreeElement };
}

/** 배너에 실린 bottom 오프셋 문자열. lift가 0이면 style 자체가 없다. */
function bottomOf(tree: TreeElement): string | undefined {
  const style = tree.props.style as { bottom?: string } | undefined;
  return style?.bottom;
}

describe("설치 배너 · 화면 크기 변화 비용", () => {
  it("resize 10회에도 main 전수 스캔은 마운트 때 1회 그대로다", () => {
    const dom = installDom(500, { top: 700, bottom: 800, height: 100 });
    mountPrompt(dom);

    expect(dom.metrics.scans).toBe(1); // 노출 결정 때 1회 — 측정 이펙트는 그 결과를 재사용한다
    const before = dom.metrics.rects;

    dom.resize(10, 800);
    dom.nextFrame();

    expect(dom.metrics.scans).toBe(1);
    // 후보 1개 + 배너 자신 1개 = 2회. 전수 스캔이 되살아나면 501회가 더 붙는다.
    expect(dom.metrics.rects - before).toBe(2);
  });

  it("resize 버스트는 rAF 1회로 묶여 측정이 1회만 돈다", () => {
    const dom = installDom(500, { top: 700, bottom: 800, height: 100 });
    mountPrompt(dom);

    const before = dom.metrics.applies;
    dom.resize(10, 800);

    expect(dom.metrics.frames).toBe(1); // 10번 던져도 예약은 1개
    expect(dom.metrics.applies - before).toBe(0); // 프레임 전에는 아무것도 재지 않는다

    dom.nextFrame();
    expect(dom.metrics.applies - before).toBe(1);
    expect(dom.bannerHeight()).toBe("70px");
  });

  it("고정 CTA가 없는 화면에서도 resize가 전수 스캔을 부르지 않는다", () => {
    // 감사 실측 화면(/list?n=500)에는 하단 고정 CTA가 없다 — 빈 결과도 담아 두어야 한다.
    const dom = installDom(500, null);
    mountPrompt(dom);

    const before = dom.metrics.rects;
    dom.resize(10, 800);
    dom.nextFrame();

    expect(dom.metrics.scans).toBe(1);
    expect(dom.metrics.rects - before).toBe(1); // 배너 자신 1회뿐
  });
});

describe("설치 배너 · 고정 CTA 접합(감사 93 계약)", () => {
  it("배너 bottom이 고정 CTA top과 정확히 접한다", () => {
    const dom = installDom(500, { top: 700, bottom: 800, height: 100 });
    const view = mountPrompt(dom);

    // 배너 bottom = 탭(56) + lift → 화면 아래에서 100px = y 700 = CTA top. 겹치지도, 뜨지도 않는다.
    expect(bottomOf(view.render())).toBe(
      `calc(3.5rem + env(safe-area-inset-bottom) + ${800 - 700 - TABS_PX}px)`,
    );
  });

  it("화면이 줄어도 담아 둔 후보를 다시 재 접합을 지킨다", () => {
    const dom = installDom(500, { top: 700, bottom: 800, height: 100 });
    const view = mountPrompt(dom);

    dom.resize(3, 500, { top: 380, bottom: 500, height: 120 }); // 키보드가 뜬 화면
    dom.nextFrame();

    expect(bottomOf(view.render())).toBe(
      `calc(3.5rem + env(safe-area-inset-bottom) + ${500 - 380 - TABS_PX}px)`,
    );
  });

  it("고정 CTA가 없으면 배너는 기본 위치에 그대로 둔다", () => {
    const dom = installDom(500, null);
    const view = mountPrompt(dom);

    expect(bottomOf(view.render())).toBeUndefined();
  });
});

describe("설치 배너 · 전수 스캔 시점", () => {
  it("고정 CTA가 떨어졌다 새로 붙으면 다시 스캔해 접합을 되찾는다", () => {
    // 홈의 에러→재시도 경로: ResultButton이 언마운트됐다 새 노드로 돌아온다.
    // 담아 둔 옛 노드만 계속 재면 배너가 CTA 위에 겹쳐 앉는다.
    const dom = installDom(500, { top: 700, bottom: 800, height: 100 });
    const view = mountPrompt(dom);
    expect(dom.metrics.scans).toBe(1);

    dom.remountCta({ top: 660, bottom: 800, height: 140 });
    dom.resize(1, 800);
    dom.nextFrame();

    expect(dom.metrics.scans).toBe(2); // 붙어 있는 동안은 안 돌고, 떨어졌을 때만 돈다
    expect(bottomOf(view.render())).toBe(
      `calc(3.5rem + env(safe-area-inset-bottom) + ${800 - 660 - TABS_PX}px)`,
    );
  });

  it("경로가 바뀌면 새 DOM을 다시 스캔한다", () => {
    const dom = installDom(500, { top: 700, bottom: 800, height: 100 });
    const view = mountPrompt(dom);
    expect(dom.metrics.scans).toBe(1);

    dom.setPath("/"); // 하단 고정 CTA가 있는 화면으로 이동
    view.render();

    expect(dom.metrics.scans).toBe(2); // 후보가 바뀔 수 있는 유일한 시점이다
  });
});
