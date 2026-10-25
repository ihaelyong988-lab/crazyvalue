import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as refresh from "@/lib/refresh";
import { loadModule } from "./react-harness";

// The real handlers execute; only the framework JSON response adapter and deployed build fixture are replaced.
const { GET, POST } = loadModule<{
  GET: () => Promise<Response>;
  POST: () => Promise<Response>;
}>("src/app/api/refresh/route.ts", {
  "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
  "@/lib/refresh": refresh,
  "@/lib/build-meta": { buildMeta: { crawledAt: "2026-10-25T06:15:43+09:00" } },
});

const TOKEN = "refresh-test-token";
const NOW = new Date("2026-10-25T00:00:00Z");
const workflowRun = (status = "completed", conclusion: string | null = "failure") => ({
  status,
  conclusion,
  created_at: "2026-10-24T23:30:00Z",
  html_url: "https://github.com/ihaelyong988-lab/crazyvalue/actions/runs/40127695397",
});

describe("refresh handlers — external requests are mocked", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv("GH_DISPATCH_TOKEN", TOKEN);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("GET separates the deployed snapshot from aggregate workflow failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      workflow_runs: [workflowRun()],
    })));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      state: "idle",
      lastConclusion: "failure",
      publishedAt: "2026-10-25T06:15:43+09:00",
    });
  });

  it.each([401, 403, 429, 500])("GET upstream %s remains a recoverable status error", async (code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream", { status: code })));
    const res = await GET();
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toHaveProperty("error");
    expect(text).not.toContain(TOKEN);
  });

  it("GET rejects a malformed run list instead of reporting idle", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "unexpected response" })));
    const res = await GET();
    expect(res.status).toBe(502);
  });

  it("missing execution configuration returns 503 without outbound requests", async () => {
    vi.stubEnv("GH_DISPATCH_TOKEN", "  ");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ state: "unconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["in_progress", null, 409, "running"],
    ["completed", "success", 429, "cooldown"],
  ] as const)("POST refuses %s/%s before dispatch", async (status, conclusion, code, state) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      workflow_runs: [workflowRun(status, conclusion)],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST();
    expect(res.status).toBe(code);
    expect(await res.json()).toMatchObject({ state });
    expect(fetchMock.mock.calls.every(([, options]) => options?.method !== "POST")).toBe(true);
  });

  it("POST sends only the existing quick dispatch and returns a safe pending status", async () => {
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) =>
      options?.method === "POST"
        ? new Response(null, { status: 204 })
        : Response.json({ workflow_runs: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST();
    expect(res.status).toBe(202);
    const body = await res.text();
    expect(JSON.parse(body)).toMatchObject({
      state: "running", publishedAt: "2026-10-25T06:15:43+09:00", lastConclusion: null,
    });
    expect(body).not.toContain(TOKEN);
    const dispatched = fetchMock.mock.calls.find(([, options]) => options?.method === "POST");
    expect(dispatched?.[0]).toBe("https://api.github.com/repos/ihaelyong988-lab/crazyvalue/actions/workflows/crawl.yml/dispatches");
    expect(JSON.parse(String(dispatched?.[1]?.body))).toEqual({ ref: "main", inputs: { mode: "quick" } });
  });

  it("POST upstream lookup failure does not dispatch", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("lookup unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST();
    expect(res.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("POST dispatch rejection returns a JSON error", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) =>
      options?.method === "POST"
        ? new Response("denied", { status: 403 })
        : Response.json({ workflow_runs: [] }),
    ));
    const res = await POST();
    expect(res.status).toBe(502);
    expect(await res.json()).toHaveProperty("error");
  });

  it("a lost dispatch response returns JSON with an uncertain outcome and never retries POST", async () => {
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === "POST") throw new Error(`connection closed ${TOKEN}`);
      return Response.json({ workflow_runs: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST();
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ outcome: "unknown" });
    expect(text).not.toContain(TOKEN);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });
});
