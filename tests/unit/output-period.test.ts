import { describe, expect, it } from "vitest";
import type { Meta } from "@/types/auction";
import { emptyResultTitle, outputPeriodLabel, resolveOutputPeriod } from "@/lib/output-period";

const legacy: Meta = {
  crawledAt: "2026-10-04T20:57:28Z",
  nextUpdateAt: "2026-10-05T18:00:00Z",
  totalCount: 1,
  countsByRegion: { seoul: 1 },
};
const current: Meta = {
  ...legacy,
  outputWindow: { start: "2026-10-05", end: "2026-10-12", endInclusive: false },
  outputSaleDateRange: { first: "2026-10-05", last: "2026-10-08" },
};

describe("제공 기간 — 끝 제외 경계와 옛 메타 호환", () => {
  it("10/12는 제외 경계이므로 화면은 10/5~11 양 끝날 포함으로 말한다", () => {
    const period = resolveOutputPeriod(current)!;
    expect(period.window).toEqual({ start: "2026-10-05", last: "2026-10-11" });
    expect(outputPeriodLabel(period)).toBe("제공 기간 2026-10-05~2026-10-11 · 매각기일 기준, 양 끝날 포함.");
    expect(outputPeriodLabel(period)).not.toContain("2026-10-12");
    expect(emptyResultTitle(period)).toBe("현재 제공 기간에 조건에 맞는 물건이 없다");
  });

  it("마지막 게시 물건이 10/8이어도 제공 기간을 그날로 줄이지 않는다", () => {
    expect(resolveOutputPeriod(current)?.window?.last).toBe("2026-10-11");
    expect(resolveOutputPeriod(current)?.posted?.last).toBe("2026-10-08");
  });

  it("옛 메타는 수집 시각의 KST 날짜에서 7일을 계산한다", () => {
    expect(resolveOutputPeriod(legacy)?.window).toEqual({ start: "2026-10-05", last: "2026-10-11" });
    expect(resolveOutputPeriod({ ...legacy, crawledAt: "2026-10-05T15:00:00Z" })?.window)
      .toEqual({ start: "2026-10-06", last: "2026-10-12" });
  });

  it.each([
    ["2026-12-28T15:00:00Z", "2026-12-29", "2027-01-04"],
    ["2028-02-24T15:00:00Z", "2028-02-25", "2028-03-02"],
    ["2027-02-24T15:00:00Z", "2027-02-25", "2027-03-03"],
  ])("연말·윤일 날짜 경계를 넘긴다: %s", (crawledAt, start, last) => {
    const period = resolveOutputPeriod({ ...legacy, crawledAt })!;
    expect(period.window).toEqual({ start, last });
    expect(outputPeriodLabel(period)).toContain(`${start}~${last}`);
  });

  it.each([
    { start: "2026-10-05", end: "2026-10-12", endInclusive: true },
    { start: "2026-10-05", end: "2026-10-05", endInclusive: false },
    { start: "2026-10-12", end: "2026-10-05", endInclusive: false },
    { start: "2026-02-30", end: "2026-03-07", endInclusive: false },
    { start: 123, end: null, endInclusive: false },
  ])("손상된 새 기간 필드는 기존 수집 시각으로 복구한다: %j", (outputWindow) => {
    const meta = { ...legacy, outputWindow } as unknown as Meta;
    expect(resolveOutputPeriod(meta)?.window).toEqual({ start: "2026-10-05", last: "2026-10-11" });
  });

  it("수집 시각이 무효여도 유효한 명시적 경계는 쓴다", () => {
    expect(resolveOutputPeriod({ ...current, crawledAt: "invalid" })?.window?.last).toBe("2026-10-11");
  });
});

describe("실제 게시 기일 — full 보충·손상 자료", () => {
  it("기간 뒤 보충분을 7일 안으로 안내하지 않고 실제 분포를 별도로 알린다", () => {
    const period = resolveOutputPeriod(current, [{ saleDate: "2026-10-05" }, { saleDate: "2026-10-12" }])!;
    expect(period.outsideWindow).toBe(true);
    expect(outputPeriodLabel(period)).toBe("우선 제공 기간 2026-10-05~2026-10-11 · 게시 물건 기일 2026-10-05~2026-10-12 · 양 끝날 포함.");
    expect(emptyResultTitle(period)).toBe("현재 게시 물건에 조건에 맞는 물건이 없다");
  });

  it("부분 갱신으로 앞선 기일이 남아도 실제 게시 분포를 숨기지 않는다", () => {
    const period = resolveOutputPeriod(current, [{ saleDate: "2026-10-04" }])!;
    expect(period.outsideWindow).toBe(true);
    expect(outputPeriodLabel(period)).toContain("게시 물건 기일 2026-10-04");
  });

  it("로드한 물건이 메타와 다르면 실제 물건 기일을 우선한다", () => {
    const period = resolveOutputPeriod(current, [{ saleDate: "2026-10-11" }])!;
    expect(period.posted).toEqual({ first: "2026-10-11", last: "2026-10-11" });
    expect(period.outsideWindow).toBe(false);
  });

  it("명시적인 빈 자료는 메타의 이전 기일을 부활시키지 않는다", () => {
    const period = resolveOutputPeriod(current, [])!;
    expect(period.posted).toBeNull();
    expect(period.window?.last).toBe("2026-10-11");
  });

  it("존재하지 않는 날짜·뒤집힌 메타 분포를 버린다", () => {
    const meta: Meta = { ...current, outputSaleDateRange: { first: "2026-10-12", last: "2026-10-05" } };
    expect(resolveOutputPeriod(meta)?.posted).toBeNull();
    expect(resolveOutputPeriod(current, [{ saleDate: "2026-02-30" }])?.posted).toBeNull();
  });

  it("기간을 복구할 근거가 없으면 실제 게시 기일만 말한다", () => {
    const period = resolveOutputPeriod({ ...legacy, crawledAt: "invalid" }, [{ saleDate: "2026-10-08" }])!;
    expect(period.window).toBeNull();
    expect(outputPeriodLabel(period)).toBe("게시 물건 기일 2026-10-08 · 매각기일 기준, 양 끝날 포함.");
    expect(emptyResultTitle(period)).toBe("현재 게시 물건에 조건에 맞는 물건이 없다");
  });

  it("날짜 근거가 전혀 없으면 기간을 만들어내지 않는다", () => {
    expect(resolveOutputPeriod(null, [])).toBeNull();
    expect(resolveOutputPeriod({ ...legacy, crawledAt: "invalid" }, [])).toBeNull();
    expect(emptyResultTitle(null)).toBe("현재 게시 물건에 조건에 맞는 물건이 없다");
  });
});
