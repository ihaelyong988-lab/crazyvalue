import { expect, it } from "vitest";
import { SORT_OPTIONS } from "@/lib/data";

it("등록 시각 없는 신규 정렬을 실제 이력 기준으로 이름 붙인다", () => {
  expect(SORT_OPTIONS.find((option) => option.key === "new")?.label).toBe("최근 유찰일순");
});
