import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 2026-08-16 기능 검진 재현·회귀 — 지역 데이터가 StaleWhileRevalidate면 재방문 첫 화면이
// 어제 목록으로 그려지고, 매일 물갈이에서 빠진 물건을 탭하면 상세가 404다(실브라우저 재현:
// RSC 프리페치 404 7건 + 상세 HTTP 404. 상세는 dynamicParams=false 정적 생성이라 이번
// 산출물에 없는 id는 페이지가 없다). 처방 = NetworkFirst + networkTimeoutSeconds(오프라인·
// 저속망은 직전 데이터 폴백 — §1 오프라인 열람 계약 유지). 이 테스트는 그 전략을 고정한다.

const sw = readFileSync(join(process.cwd(), "src", "app", "sw.ts"), "utf8");

describe("서비스워커 데이터 캐시 전략 — 목록·상세 데이터 정합", () => {
  it("StaleWhileRevalidate를 실사용하지 않는다 — 생성자·임포트 0건 (주석의 이력 서술은 허용)", () => {
    expect(sw.includes("new StaleWhileRevalidate(")).toBe(false);
    const importLine = sw.split("\n").find((l) => l.startsWith("import {")) ?? "";
    expect(importLine.includes("StaleWhileRevalidate")).toBe(false);
  });

  it("지역 데이터(/data/*.json) 규칙이 NetworkFirst다", () => {
    const rule = sw.slice(sw.indexOf('pathname.startsWith("/data/")'));
    const handler = rule.slice(0, rule.indexOf("plugins:"));
    expect(handler).toContain("new NetworkFirst(");
  });

  it("오프라인·저속망 폴백(networkTimeoutSeconds)을 가진다 — §1 직전 데이터 열람 계약", () => {
    const rule = sw.slice(sw.indexOf('pathname.startsWith("/data/")'));
    const handler = rule.slice(0, rule.indexOf("plugins:"));
    expect(handler).toMatch(/networkTimeoutSeconds:\s*\d+/);
  });

  it("meta.json 규칙이 지역 데이터 일반 규칙보다 먼저 등록돼 있다 (등록 순서 = 매칭 우선순위)", () => {
    const metaIdx = sw.indexOf('pathname === "/data/meta.json"');
    const regionIdx = sw.indexOf('pathname.startsWith("/data/")');
    expect(metaIdx).toBeGreaterThan(-1);
    expect(regionIdx).toBeGreaterThan(-1);
    expect(metaIdx).toBeLessThan(regionIdx);
  });
});
