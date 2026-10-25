import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REGIONS } from "@/types/catalog";
import type { AuctionItem, Meta } from "@/types/auction";
import { isValidAuctionItem } from "@/lib/data";
import { createReactStub } from "./react-harness";

const item = (JSON.parse(readFileSync(join(process.cwd(), "public/data/seoul.json"), "utf8")) as AuctionItem[])[0];
const at = "2026-08-20T09:00:00+09:00";
const later = "2026-08-21T09:00:00+09:00";

function meta(count = 1, crawledAt = at): Meta {
  return {
    crawledAt,
    nextUpdateAt: "2026-08-21T03:00:00+09:00",
    totalCount: count,
    countsByRegion: Object.fromEntries(REGIONS.map((r) => [r.key, r.key === "seoul" ? count : 0])),
  };
}

function serve(readMeta: () => unknown, entries: unknown[] = [item]) {
  vi.stubGlobal("fetch", vi.fn(async (path: string) => ({
    ok: true,
    json: async () => path.endsWith("meta.json") ? readMeta() : path.endsWith("/seoul.json") ? entries : [],
  })));
}

async function mountLoader() {
  const stub = createReactStub();
  // This loader's mount effect depends on useCallback identity. The shared UI harness
  // deliberately recalculates callbacks, so retain React's actual memoization here.
  const refCell = stub.react.useRef as <T>(initial: T) => { current: T };
  stub.react.useCallback = <T>(callback: T, deps: unknown[]) => {
    const ref = refCell({ callback, deps });
    if (deps.length !== ref.current.deps.length || deps.some((dep, i) => !Object.is(dep, ref.current.deps[i]))) {
      ref.current = { callback, deps };
    }
    return ref.current.callback;
  };
  vi.doMock("react", () => stub.react);
  const loader = await import("@/lib/use-auction-data");
  const store = await import("@/lib/use-meta");
  const data = stub.mount(loader.useAuctionData);
  const notice = stub.mount(store.useMeta);
  data.render();
  notice.render();
  return { data, notice, store };
}

async function settle() {
  // Settle JSON promises and the loader's final state update without a fake clock.
  await new Promise<void>((resolve) => setImmediate(resolve));
}

beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.doUnmock("react");
  vi.doUnmock("node:fs/promises");
  vi.unstubAllGlobals();
});

describe("shared row validation", () => {
  it("accepts legacy provenance and validates optional provenance when present", () => {
    expect(isValidAuctionItem(item)).toBe(true);
    expect(isValidAuctionItem({ ...item, historySource: "observed", courtCode: "B000210" })).toBe(true);
    expect(isValidAuctionItem({ ...item, historySource: "unknown" })).toBe(true);
    expect(isValidAuctionItem({ ...item, historySource: "estimated" })).toBe(true);
    expect(isValidAuctionItem({ ...item, depositRate: 20, depositSource: "observed" })).toBe(true);
  });

  it.each([
    { historySource: "real" }, { historySource: null }, { courtCode: 210 }, { courtCode: "" },
    { depositRate: 0 }, { depositRate: 101 }, { depositRate: null }, { depositSource: "real" },
    { detailUrl: "https://" },
  ])("rejects malformed optional fields or URL %j", (fields) => {
    expect(isValidAuctionItem({ ...item, ...fields })).toBe(false);
  });

  it("preserves a server detail item when a neighboring row is corrupt", async () => {
    vi.doMock("node:fs/promises", () => ({
      readFile: async () => JSON.stringify([item, { ...item, minPrice: -1 }]),
    }));
    const { findItem } = await import("@/lib/data-server");
    expect((await findItem(item.id))?.id).toBe(item.id);
  });
});

describe("dataset snapshot consistency", () => {
  it("preserves valid rows and reports losses without mistaking drops for a different snapshot", async () => {
    serve(() => meta(2), [item, { ...item, minPrice: -1 }]);
    const { data, notice } = await mountLoader();
    await settle();
    expect(data.render().status).toBe("ready");
    expect(data.render().items.map((entry) => entry.id)).toEqual([item.id]);
    expect(notice.render().dropped).toBe(1);
    expect(notice.render()).toMatchObject({ snapshotMismatch: false });
  });

  it("blocks regional raw counts that disagree with metadata", async () => {
    serve(() => meta(2));
    const { data, notice } = await mountLoader();
    await settle();
    expect(data.render().status).toBe("error");
    expect(data.render().items).toEqual([]);
    expect(notice.render()).toMatchObject({ snapshotMismatch: true });
  });

  it("blocks internally inconsistent total and region metadata counts", async () => {
    serve(() => ({ ...meta(), totalCount: 2 }));
    const { data } = await mountLoader();
    await settle();
    expect(data.render().status).toBe("error");
  });

  it("blocks metadata changed while region files were loading", async () => {
    let reads = 0;
    serve(() => meta(1, reads++ === 0 ? at : later));
    const { data, notice } = await mountLoader();
    await settle();
    expect(data.render().status).toBe("error");
    expect(notice.render()).toMatchObject({ snapshotMismatch: true });
  });

  it("recovers on explicit retry after metadata and file snapshots become consistent", async () => {
    let current = meta(2);
    serve(() => current);
    const { data, notice } = await mountLoader();
    await settle();
    expect(data.render().status).toBe("error");
    current = meta(1, later);
    data.render().retry();
    await settle();
    expect(data.render().status).toBe("ready");
    expect(data.render().meta?.crawledAt).toBe(later);
    expect(notice.render()).toMatchObject({ snapshotMismatch: false });
  });

  it("retries region files without reusing the incompatible cached response", async () => {
    vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => ({
      ok: true,
      json: async () => path.endsWith("meta.json")
        ? meta()
        : path.endsWith("/seoul.json") && init?.cache === "no-store" ? [item] : [],
    })));
    const { data } = await mountLoader();
    await settle();
    expect(data.render().status).toBe("error");
    data.render().retry();
    await settle();
    expect(data.render().status).toBe("ready");
    expect(data.render().items.map((entry) => entry.id)).toEqual([item.id]);
  });

  it.each([at, "2026-08-22T09:00:00+09:00"])("announces a fetched snapshot different from baked %s", async (baked) => {
    serve(() => meta(1, later));
    const { data, notice, store } = await mountLoader();
    await settle();
    const reporter = store as typeof store & { reportBuildSnapshot?: (value: string) => void };
    reporter.reportBuildSnapshot?.(baked);
    expect(data.render().status).toBe("ready");
    expect(notice.render()).toMatchObject({ snapshotMismatch: true });
  });

  it.each([null, [], { seoul: -1 }, { seoul: 0.5 }, { seoul: "1" }])("rejects invalid region count metadata %j", async (countsByRegion) => {
    serve(() => ({ ...meta(), countsByRegion }));
    const { readMeta } = await import("@/lib/use-meta");
    await expect(readMeta()).rejects.toThrow("meta.json");
  });
});
