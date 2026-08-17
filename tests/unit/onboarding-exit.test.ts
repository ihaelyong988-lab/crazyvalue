import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { transformSync } from "esbuild";
import * as React from "react";
import { createElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as watchlist from "@/lib/watchlist";
import * as catalog from "@/types/catalog";
import * as data from "@/lib/data";
import type { OnboardingExit } from "@/components/OnboardingSheet";
import type { Prefs } from "@/lib/watchlist";

// 온보딩 종료 판정 회귀(감사 3차 J1) — 저장이 막힌 기기에서 완료 기록 실패를 삼키면
// 시트만 성공한 것처럼 닫히고, 완료가 남지 않아 재방문·SPA 이동마다 온보딩이 처음부터 다시 뜬다.
//
// 시트 모듈은 esbuild로 직접 컴파일해 싣는다. tsconfig `jsx: "preserve"`(Next 전제)라 vitest의
// vite 파이프라인이 .tsx를 파싱하지 못하고, vitest.config.ts는 이 작업의 소유 파일이 아니다.
// 대신 팩토리를 매번 새로 실행해 모듈 스코프를 초기화한다 = 새 탭. 같은 실행을 재사용하면 = SPA 재마운트.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(HERE, "../../src/components/OnboardingSheet.tsx");

const compiled = transformSync(readFileSync(SOURCE, "utf8"), {
  loader: "tsx",
  format: "cjs",
  jsx: "automatic",
  target: "es2020",
}).code;

// FilterChip은 .tsx라 같은 이유로 싣지 못한다 — 렌더 결과에 쓰지 않으므로 빈 칩으로 대체한다.
const stubs: Record<string, unknown> = {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "@/lib/watchlist": watchlist,
  "@/types/catalog": catalog,
  "@/lib/data": data,
  "@/components/FilterChip": { FilterChip: () => null },
};
const factory = new Function("require", "module", "exports", compiled) as (
  req: (id: string) => unknown,
  mod: { exports: unknown },
  exp: unknown,
) => void;

interface SheetModule {
  resolveExit: (save: boolean, prefs: Prefs) => OnboardingExit;
  isSkippedUnsaved: () => boolean;
  OnboardingSheet: (props: { onDone: () => void }) => unknown;
}

/** 새 탭(모듈 초기 상태)에서 시트 모듈을 싣는다. */
function loadSheet(): SheetModule {
  const mod = { exports: {} };
  factory((id) => {
    const found = stubs[id];
    if (!found) throw new Error(`예상하지 못한 import: ${id}`);
    return found;
  }, mod, mod.exports);
  return mod.exports as SheetModule;
}

/** 마운트 1회의 첫 페인트 마크업. 빈 문자열 = 시트가 열리지 않았다. */
function mount(sheet: SheetModule): string {
  return renderToStaticMarkup(
    createElement(sheet.OnboardingSheet as never, { onDone: () => {} }),
  );
}

// node 환경 window 셧: watchlist는 localStorage·sessionStorage만 쓴다(watchlist.test.ts와 같은 계약).
//   "all"  = 용량 초과·프라이빗 모사 — watchlist 쓰기 전량 실패
//   "flag" = 용량 경계 — 완료 플래그가 담긴 쓰기(`"onboarded":true`)만 실패하고 setPrefs는 통과
const WATCH_KEY = "crazyvalue.watchlist.v1";
const store = new Map<string, string>();
const session = new Map<string, string>();
let block: "none" | "all" | "flag" = "none";

function shim(map: Map<string, string>, blockable: boolean) {
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const blocked =
        blockable &&
        k === WATCH_KEY &&
        (block === "all" || (block === "flag" && v.includes('"onboarded":true')));
      if (blocked) {
        const err = new Error("mock QuotaExceededError");
        err.name = "QuotaExceededError";
        throw err;
      }
      map.set(k, v);
    },
    removeItem: (k: string) => map.delete(k),
  };
}

beforeEach(() => {
  store.clear();
  session.clear();
  block = "none";
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: shim(store, true),
    sessionStorage: shim(session, false),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
});

const stored = () => JSON.parse(store.get(WATCH_KEY) ?? "null");
const PREFS: Prefs = { regions: ["경기"], priceBands: ["b3"] };

describe("온보딩 종료 판정", () => {
  it("정상 저장은 조건과 완료 플래그를 함께 남기고 종료한다", () => {
    const sheet = loadSheet();

    expect(sheet.resolveExit(true, PREFS)).toBe("closed");
    expect(stored().prefs.regions).toEqual(["경기"]);
    expect(stored().onboarded).toBe(true);
    expect(sheet.isSkippedUnsaved()).toBe(false); // 저장에 성공했으므로 메모리 플래그는 쓰지 않는다
  });

  it("쓰기 전량 차단: 저장 경로는 시트를 유지한다", () => {
    block = "all";
    const sheet = loadSheet();

    expect(sheet.resolveExit(true, PREFS)).toBe("save-failed");
    expect(store.get(WATCH_KEY)).toBeUndefined();
    expect(sheet.isSkippedUnsaved()).toBe(false); // 시트가 살아 있으므로 세션을 완료로 표시하지 않는다
  });

  it("용량 경계(조건 저장 성공·완료 기록 실패): 저장 경로가 삼키지 않는다", () => {
    block = "flag";
    const sheet = loadSheet();

    // 회귀 지점 — markOnboarded 반환값을 버리면 "closed"가 나와 시트가 조용히 닫힌다.
    expect(sheet.resolveExit(true, PREFS)).toBe("save-failed");
    expect(stored().prefs.regions).toEqual(["경기"]); // 조건은 저장됐다
    expect(stored().onboarded).toBeUndefined(); // 완료 플래그만 유실됐다
    expect(sheet.isSkippedUnsaved()).toBe(false);
  });

  it("쓰기 전량 차단: 건너뛰기는 고지 경로로 닫는다", () => {
    block = "all";
    const sheet = loadSheet();

    expect(sheet.resolveExit(false, PREFS)).toBe("closed-unsaved");
    expect(store.get(WATCH_KEY)).toBeUndefined(); // 저장된 것이 없다 — 성공으로 위장하지 않는다
    expect(sheet.isSkippedUnsaved()).toBe(true);
  });

  it("용량 경계에서 건너뛰기해도 고지 경로로 닫는다", () => {
    block = "flag";
    const sheet = loadSheet();

    expect(sheet.resolveExit(false, PREFS)).toBe("closed-unsaved");
    expect(sheet.isSkippedUnsaved()).toBe(true);
  });
});

describe("저장 실패 후 재노출", () => {
  it("첫 마운트는 시트를 연다", () => {
    block = "all";
    expect(mount(loadSheet())).toContain('role="dialog"');
  });

  it("건너뛰기로 닫은 뒤 같은 세션에서 다시 마운트해도 열지 않는다", () => {
    block = "all";
    const sheet = loadSheet();
    sheet.resolveExit(false, PREFS);

    // SPA 이동·뒤로가기 = 같은 모듈의 재마운트. 저장소는 비었는데도 열리지 않아야 한다.
    expect(store.get(WATCH_KEY)).toBeUndefined();
    expect(mount(sheet)).toBe("");
  });

  it("저장 경로 실패 뒤에는 시트가 그대로 열려 있다", () => {
    block = "all";
    const sheet = loadSheet();
    sheet.resolveExit(true, PREFS);

    expect(mount(sheet)).toContain('role="dialog"');
  });

  it("탭을 새로 열면 다시 노출된다 — 실패를 영구 완료로 위장하지 않는다", () => {
    block = "all";
    const first = loadSheet();
    first.resolveExit(false, PREFS);
    expect(first.isSkippedUnsaved()).toBe(true);

    const fresh = loadSheet(); // 새 탭 = 모듈 초기 상태
    expect(fresh.isSkippedUnsaved()).toBe(false);
    expect(mount(fresh)).toContain('role="dialog"');
  });

  it("하이드레이션 시점 판정은 서버와 같다 — 새 모듈은 항상 열림", () => {
    expect(loadSheet().isSkippedUnsaved()).toBe(false);
  });
});
