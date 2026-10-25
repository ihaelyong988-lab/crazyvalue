import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as jsxRuntime from "react/jsx-runtime";
import * as refresh from "@/lib/refresh";
import {
  createReactStub, find, loadModule, makeStub, propsOf, textOf, type Mounted,
} from "./react-harness";

const NOW = new Date("2026-10-25T00:00:00Z");
const OLD_SNAPSHOT = "2026-10-24T06:00:00+09:00";
const NEW_SNAPSHOT = "2026-10-25T06:15:43+09:00";
const base = {
  state: "idle", lastRunAt: null, cooldownUntil: null, runUrl: null,
  lastConclusion: null, publishedAt: OLD_SNAPSHOT,
};

let mounted: Mounted<unknown> | undefined;
let reply: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;
let reload: ReturnType<typeof vi.fn>;
let ErrorState: ReturnType<typeof makeStub>;

async function renderReady() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  return mounted!.render();
}

function mountPage() {
  const hooks = createReactStub();
  const consumeCallbackCell = hooks.react.useCallback as <T>(fn: T) => T;
  let stableCallback: unknown;
  ErrorState = makeStub();
  const page = loadModule<{ default: () => unknown }>("src/app/refresh/page.tsx", {
    react: {
      ...hooks.react,
      useCallback<T>(fn: T) {
        consumeCallbackCell(fn);
        stableCallback ??= fn;
        return stableCallback as T;
      },
    },
    "react/jsx-runtime": jsxRuntime,
    "@/lib/refresh": refresh,
    "@/components/ErrorState": { ErrorState },
  });
  mounted = hooks.mount(page.default);
  mounted.render();
}

function startButton(tree: unknown) {
  return find(tree, (el) => el.type === "button");
}

describe("refresh page — time, publication and recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    reply = { ...base };
    fetchMock = vi.fn(async () => Response.json(reply));
    reload = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { location: { reload } });
    vi.stubGlobal("caches", { delete: vi.fn().mockResolvedValue(true) });
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("updates the countdown and rechecks the server at cooldown expiry without remounting", async () => {
    reply = { ...base, state: "cooldown", cooldownUntil: "2026-10-25T00:02:01Z" };
    mountPage();
    expect(textOf(await renderReady())).toContain("3분 후");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(textOf(await renderReady())).toContain("2분 후");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    reply = { ...base };
    await vi.advanceTimersByTimeAsync(61_000);
    const tree = await renderReady();
    expect(startButton(tree)?.props.disabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cooldown expiry respects a server response that execution is unconfigured", async () => {
    reply = { ...base, state: "cooldown", cooldownUntil: "2026-10-25T00:00:01Z" };
    mountPage();
    await renderReady();
    reply = { ...base, state: "unconfigured" };
    await vi.advanceTimersByTimeAsync(1_000);
    const tree = await renderReady();
    expect(textOf(tree)).toContain("실행 권한");
    expect(startButton(tree)?.props.disabled).toBe(true);
  });

  it("a delayed status response uses the current clock for its first cooldown display", async () => {
    fetchMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      return Response.json({ ...base, state: "cooldown", cooldownUntil: "2026-10-25T00:01:01Z" });
    });
    mountPage();
    await vi.advanceTimersByTimeAsync(60_000);
    const tree = await renderReady();
    expect(textOf(tree)).toContain("1분 후");
    expect(textOf(tree)).not.toContain("2분 후");
  });

  it("unmount cancels the cooldown expiry request", async () => {
    reply = { ...base, state: "cooldown", cooldownUntil: "2026-10-25T00:00:01Z" };
    mountPage();
    await renderReady();
    mounted!.unmount();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a published snapshot reloads after running even when the workflow aggregate failed", async () => {
    reply = { ...base, state: "running" };
    mountPage();
    await renderReady();
    reply = { ...base, lastConclusion: "failure", publishedAt: NEW_SNAPSHOT };
    await vi.advanceTimersByTimeAsync(20_000);
    const tree = await renderReady();
    await renderReady();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(textOf(tree)).not.toContain("데이터는 직전 수집분 그대로다");
  });

  it.each(["failure", "success"])("keeps checking a delayed deployment after aggregate %s", async (lastConclusion) => {
    reply = { ...base, state: "running" };
    mountPage();
    await renderReady();
    reply = { ...base, lastConclusion };
    await vi.advanceTimersByTimeAsync(20_000);
    await renderReady();
    expect(reload).not.toHaveBeenCalled();

    reply = { ...base, lastConclusion, publishedAt: NEW_SNAPSHOT };
    await vi.advanceTimersByTimeAsync(20_000);
    await renderReady();
    await renderReady();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);

    const requestsAtPublication = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(180_000);
    await renderReady();
    expect(fetchMock).toHaveBeenCalledTimes(requestsAtPublication);
  });

  it("bounds post-completion publication checks when deployment never appears", async () => {
    reply = { ...base, state: "running" };
    mountPage();
    await renderReady();
    reply = { ...base, lastConclusion: "failure" };
    await vi.advanceTimersByTimeAsync(20_000);
    await renderReady();
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(20_000);
      await renderReady();
    }
    // Initial status + observed completion + at most six followup reads.
    expect(fetchMock.mock.calls.length).toBeGreaterThan(2);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(8);
    expect(fetchMock.mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    const requestsAfterBudget = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(600_000);
    await renderReady();
    expect(fetchMock).toHaveBeenCalledTimes(requestsAfterBudget);
  });

  it("unmount cancels pending post-completion publication checks", async () => {
    reply = { ...base, state: "running" };
    mountPage();
    await renderReady();
    reply = { ...base, lastConclusion: "success" };
    await vi.advanceTimersByTimeAsync(20_000);
    await renderReady();
    mounted!.unmount();
    const before = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(180_000);
    expect(fetchMock).toHaveBeenCalledTimes(before);
    expect(reload).not.toHaveBeenCalled();
  });

  it("workflow success alone cannot claim or reload a new deployed snapshot", async () => {
    reply = { ...base, state: "running" };
    mountPage();
    await renderReady();
    reply = { ...base, lastConclusion: "success" };
    await vi.advanceTimersByTimeAsync(20_000);
    await renderReady();
    await renderReady();
    expect(reload).not.toHaveBeenCalled();
  });

  it("aggregate failure alone does not assert the published data stayed unchanged", async () => {
    reply = { ...base, lastConclusion: "failure", publishedAt: NEW_SNAPSHOT };
    mountPage();
    const tree = await renderReady();
    expect(textOf(tree)).toContain("직전");
    expect(textOf(tree)).not.toContain("데이터는 직전 수집분 그대로다");
  });

  it("status lookup errors offer neutral recovery guidance instead of diagnosing the visitor's network", async () => {
    fetchMock.mockResolvedValue(new Response("unavailable", { status: 502 }));
    mountPage();
    const props = propsOf(await renderReady(), ErrorState);
    expect(props.action).toEqual(expect.any(String));
    expect(props.action).not.toMatch(/네트워크/);
    expect(props.onRetry).toEqual(expect.any(Function));
  });

  it("a lost POST response rechecks status and does not claim the request was never sent", async () => {
    mountPage();
    const tree = await renderReady();
    fetchMock.mockImplementation(async (_url: string, options?: RequestInit) => {
      if (options?.method === "POST") throw new Error("response lost");
      return Response.json({ ...base, state: "running" });
    });
    (startButton(tree)?.props.onClick as () => void)();
    const after = await renderReady();
    expect(textOf(after)).not.toContain("요청을 보내지 못했다");
    expect(startButton(after)?.props.disabled).toBe(true);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });
});
