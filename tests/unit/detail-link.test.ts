import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COURT_ORIGIN_URL } from "@/lib/court-origin";
import { REGIONS, RegionFileSchema } from "@/types/auction";
import { DETAIL_URL } from "../../scripts/crawl-config";

// 감사 90 재현·회귀(§13 규칙 7) — 목데이터 detailUrl이 크롤러 규격(DETAIL_URL)과 어긋나면
// 방문자가 원문 화면이 아닌 법원 사이트 첫 화면에 떨어진다(핵심목표 미달).
// 같은 그룹의 45·46·82·85는 렌더 결과 결함이라 이 하네스에서 단위 재현이 불가하다(보고 notes 참조).
//
// 2026-08-20 개정 — 이 게이트는 **결함을 고정하고 있었다.** 규격을 `PGJ15AF01.xml`로 박아 두었는데
// 그 화면은 부모 프레임 없이는 열리지 않는 자식 화면이라, 데이터 전건이 규격과 일치할수록
// 전건이 오류창으로 떨어졌다(§9). 판정값을 특정 화면 ID가 아니라 **단독 진입 가능 규격**으로 바꾼다.
// 화면 ID를 다시 박지 않는 이유: 법원이 화면을 개편하면 같은 사고가 반복된다 — 규격은 구조를 재고,
// 실제 도달은 라이브 게이트가 잰다.

const dataDir = join(process.cwd(), "public", "data");

describe("감사 90 — 목데이터 detailUrl이 크롤러 DETAIL_URL 규격", () => {
  it("DETAIL_URL은 루트가 아니라 단독 진입이 되는 원문 화면 경로다", () => {
    expect(DETAIL_URL.startsWith("https://")).toBe(true);
    const url = new URL(DETAIL_URL);
    expect(url.hostname).toBe("www.courtauction.go.kr");
    expect(url.pathname).not.toBe("/");
    // 최상단 컨테이너(`…F00`/`…M00`)만 부모 없이 뜬다. 자식 화면은 오류창을 띄운다.
    expect(url.searchParams.get("w2xPath")).toMatch(/PGJ\w{3}(F|M)00\.xml$/);
    // 앱이 렌더하는 상수와 같은 값이어야 한다 — 두 원천이 갈리면 데이터와 화면이 다른 곳을 가리킨다.
    expect(DETAIL_URL).toBe(COURT_ORIGIN_URL);
  });

  it("public/data 전 물건의 detailUrl이 DETAIL_URL과 일치한다", () => {
    const mismatched: string[] = [];
    let total = 0;
    for (const r of REGIONS) {
      const raw: unknown = JSON.parse(readFileSync(join(dataDir, `${r.key}.json`), "utf8"));
      for (const item of RegionFileSchema.parse(raw)) {
        total++;
        if (item.detailUrl !== DETAIL_URL) mismatched.push(item.id);
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(mismatched).toEqual([]);
  });
});
