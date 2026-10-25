import { afterEach, describe, expect, it, vi } from "vitest";
import * as format from "@/lib/format";
import { createReactStub, loadModule, propsOf, textOf } from "./react-harness";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  const hooks = createReactStub();
  const listeners = new Map<string, () => void>();
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: (key: string, fn: () => void) => listeners.set(key, fn), removeEventListener: (key: string) => listeners.delete(key) });
  const Timeline = () => null;
  const mod = loadModule<{
    ItemSchedule: (props: Record<string, unknown>) => unknown;
    ItemHistory: (props: Record<string, unknown>) => unknown;
  }>("src/components/ItemDates.tsx", {
    react: hooks.react,
    "react/jsx-runtime": { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) },
    "@/lib/format": format,
    "@/components/HistoryTimeline": { HistoryTimeline: Timeline },
  });
  return { ...mod, hooks, listeners, Timeline };
}

describe("상세 기일은 빌드 날짜 뒤에도 KST 현재 날짜를 따른다", () => {
  it("오래된 SSR 날짜를 마운트 후 회복하고 열린 화면의 자정도 반영한다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T14:59:30Z"));
    const { ItemSchedule, hooks } = setup();
    const mounted = hooks.mount(() => ItemSchedule({ saleDate: "2026-10-25", saleTime: "10:00", courtRoom: "경매법정", initialToday: "2026-10-24" }));
    expect(textOf(mounted.render())).toContain("D-1");
    expect(textOf(mounted.render())).toContain("D-day");
    vi.advanceTimersByTime(60_000);
    expect(textOf(mounted.render())).toContain("기일 경과");
    mounted.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("화면 복귀 시 기일 경과를 회복하고 이력 출처도 전달한다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T03:00:00Z"));
    const { ItemHistory, hooks, listeners, Timeline } = setup();
    const history = [{ date: "2026-09-01", minPrice: 10, result: "유찰" }];
    const mounted = hooks.mount(() => ItemHistory({ history, saleDate: "2026-10-25", minPrice: 7, historySource: "estimated", initialToday: "2026-10-25" }));
    expect(propsOf(mounted.render(), Timeline)).toMatchObject({ days: 0, historySource: "estimated", history });
    vi.setSystemTime(new Date("2026-10-26T03:00:00Z"));
    listeners.get("visibilitychange")?.();
    expect(propsOf(mounted.render(), Timeline).days).toBe(-1);
    mounted.unmount();
    expect(listeners.size).toBe(0);
  });
});
