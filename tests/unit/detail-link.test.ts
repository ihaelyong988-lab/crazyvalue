import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REGIONS, RegionFileSchema } from "@/types/auction";
import { DETAIL_URL } from "../../scripts/crawl-config";

// 감사 90 재현·회귀(§13 규칙 7) — 목데이터 detailUrl이 크롤러 규격(DETAIL_URL)과 어긋나면
// 방문자가 사건상세 화면이 아닌 법원 사이트 첫 화면에 떨어진다(핵심목표 미달).
// 같은 그룹의 45·46·82·85는 렌더 결과 결함이라 이 하네스에서 단위 재현이 불가하다(보고 notes 참조).

const dataDir = join(process.cwd(), "public", "data");

describe("감사 90 — 목데이터 detailUrl이 크롤러 DETAIL_URL 규격", () => {
  it("DETAIL_URL은 루트가 아니라 사건상세 화면 경로다", () => {
    expect(DETAIL_URL.startsWith("https://")).toBe(true);
    const url = new URL(DETAIL_URL);
    expect(url.hostname).toBe("www.courtauction.go.kr");
    expect(url.pathname).not.toBe("/");
    expect(url.searchParams.get("w2xPath")).toMatch(/PGJ15AF01\.xml$/);
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
