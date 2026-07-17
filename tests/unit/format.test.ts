import { describe, expect, it } from "vitest";
import {
  dday,
  discountPct,
  formatArea,
  formatDateKr,
  formatDday,
  formatKrw,
  todaySeoul,
} from "@/lib/format";

describe("formatKrw — 한국식 축약(만 단위 미만 내림)", () => {
  it("1억 미만", () => {
    expect(formatKrw(45_000_000)).toBe("4,500만");
    expect(formatKrw(9_990_000)).toBe("999만");
    expect(formatKrw(99_990_000)).toBe("9,999만");
  });
  it("1억 경계", () => {
    expect(formatKrw(100_000_000)).toBe("1억");
    expect(formatKrw(100_010_000)).toBe("1억 1만");
  });
  it("억+만 병기", () => {
    expect(formatKrw(320_000_000)).toBe("3억 2,000만");
    expect(formatKrw(1_234_560_000)).toBe("12억 3,456만");
  });
  it("만 미만은 원 단위 그대로", () => {
    expect(formatKrw(9_500)).toBe("9,500원");
  });
});

describe("dday — Asia/Seoul date-only 자정 경계", () => {
  it("같은 날 = 0(D-day)", () => {
    expect(dday("2026-07-18", "2026-07-18")).toBe(0);
    expect(formatDday(0)).toBe("D-day");
  });
  it("다음 날 = 1, 전날 = -1(기일 경과)", () => {
    expect(dday("2026-07-19", "2026-07-18")).toBe(1);
    expect(dday("2026-07-17", "2026-07-18")).toBe(-1);
    expect(formatDday(-1)).toBe("기일 경과");
    expect(formatDday(7)).toBe("D-7");
  });
  it("월 경계", () => {
    expect(dday("2026-08-01", "2026-07-31")).toBe(1);
  });
  it("todaySeoul은 KST 자정 직후에도 서울 날짜를 준다", () => {
    // UTC 2026-07-17 15:00 = KST 2026-07-18 00:00 — 서버 UTC에 오염되지 않는 근거
    expect(todaySeoul(new Date("2026-07-17T15:00:00Z"))).toBe("2026-07-18");
    expect(todaySeoul(new Date("2026-07-17T14:59:00Z"))).toBe("2026-07-17");
  });
});

describe("discountPct — 표시 할인율(1 − priceRatio)", () => {
  it("0.49 → 51%", () => {
    expect(discountPct(0.49)).toBe(51);
  });
  it("0.64 → 36%", () => {
    expect(discountPct(0.64)).toBe(36);
  });
});

describe("표기 유틸", () => {
  it("formatDateKr 요일", () => {
    expect(formatDateKr("2026-07-12")).toBe("2026-07-12(일)");
    expect(formatDateKr("2026-07-18")).toBe("2026-07-18(토)");
  });
  it("formatArea ㎡+평 병기, null은 -", () => {
    expect(formatArea(84.9)).toBe("84.9㎡ (25.7평)");
    expect(formatArea(null)).toBe("-");
  });
});
