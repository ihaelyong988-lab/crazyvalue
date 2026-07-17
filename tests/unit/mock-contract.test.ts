import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MetaSchema, REGIONS, RegionFileSchema } from "@/types/auction";

// 데이터 계약 증거: 저장소의 public/data 전 파일이 스키마를 통과해야 한다(§13 규칙 6).
const dataDir = join(process.cwd(), "public", "data");

describe("public/data — 단일 스키마 계약 전건 통과", () => {
  it("시·도 17개 파일 전건 zod 통과, id 전역 중복 0", () => {
    const ids = new Set<string>();
    let total = 0;
    for (const r of REGIONS) {
      const raw = JSON.parse(readFileSync(join(dataDir, `${r.key}.json`), "utf8"));
      const parsed = RegionFileSchema.safeParse(raw);
      expect(parsed.success, `${r.key}.json 스키마 위반: ${JSON.stringify(parsed.success ? "" : parsed.error.issues[0])}`).toBe(true);
      if (!parsed.success) continue;
      for (const item of parsed.data) {
        expect(ids.has(item.id), `중복 id ${item.id}`).toBe(false);
        ids.add(item.id);
        expect(item.region).toBe(r.name);
        expect(item.failCount).toBeGreaterThanOrEqual(2);
      }
      total += parsed.data.length;
    }
    expect(total).toBeGreaterThan(0);
  });
  it("meta.json 계약·건수 합 일치", () => {
    const meta = MetaSchema.parse(JSON.parse(readFileSync(join(dataDir, "meta.json"), "utf8")));
    const sum = Object.values(meta.countsByRegion).reduce((a, b) => a + b, 0);
    expect(meta.totalCount).toBe(sum);
  });
});
