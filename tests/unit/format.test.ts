import { describe, expect, it } from "vitest";
import {
  dday,
  discountPct,
  formatArea,
  formatDateKr,
  formatDday,
  formatKrw,
  isValidDateOnly,
  parseDateOnly,
  isFreshUpdate,
  seoulDateTime,
  shiftDays,
  todaySeoul,
  updateDelay,
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

describe("존재하지 않는 날짜 — 조용한 이월 금지(감사 37)", () => {
  it("2026-02-30·2025-02-29·2026-04-31은 무효 판정", () => {
    // Date.UTC는 2026-02-30을 2026-03-02로 이월한다 — 되돌려 비교해 걸러낸다.
    expect(parseDateOnly("2026-02-30")).toBeNull();
    expect(parseDateOnly("2025-02-29")).toBeNull();
    expect(parseDateOnly("2026-04-31")).toBeNull();
    expect(parseDateOnly("2026-13-01")).toBeNull();
    expect(isValidDateOnly("2026-02-30")).toBe(false);
    expect(isValidDateOnly("20260722")).toBe(false);
    expect(isValidDateOnly(null)).toBe(false);
  });
  it("실재하는 날짜(윤년 포함)는 통과", () => {
    expect(parseDateOnly("2024-02-29")).toBe(Date.UTC(2024, 1, 29));
    expect(isValidDateOnly("2026-07-22")).toBe(true);
  });
  it("무효 기일은 D-day를 단정하지 않는다 — NaN → '기일 미상'", () => {
    // 수정 전: 2026-02-30이 2026-03-02로 이월돼 "D-10"으로 표기됐다.
    expect(dday("2026-02-30", "2026-02-20")).toBeNaN();
    expect(formatDday(dday("2026-02-30", "2026-02-20"))).toBe("기일 미상");
    expect(dday("2026-03-02", "2026-02-20")).toBe(10);
  });
  it("무효 날짜는 요일을 붙이지 않고 원값 그대로 표기", () => {
    expect(formatDateKr("2026-02-30")).toBe("2026-02-30");
    expect(formatDateKr("")).toBe("");
  });
  it("shiftDays — date-only 이동, 무효 입력은 null", () => {
    expect(shiftDays("2026-07-22", -7)).toBe("2026-07-15");
    expect(shiftDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDays("2026-02-30", -7)).toBeNull();
  });
});

describe("seoulDateTime — 수집 시각 실값 표기(감사 38)", () => {
  it("KST 오프셋·UTC 표기 모두 서울 기준으로 환산", () => {
    expect(seoulDateTime("2026-07-12T03:00:00+09:00")).toEqual({ date: "2026-07-12", time: "03:00" });
    expect(seoulDateTime("2026-07-11T18:00:00Z")).toEqual({ date: "2026-07-12", time: "03:00" });
  });
  it("리터럴 03:00이 아니라 실제 시각을 준다", () => {
    expect(seoulDateTime("2026-07-12T05:41:00+09:00")?.time).toBe("05:41");
    expect(seoulDateTime("2026-07-12T00:00:00+09:00")?.time).toBe("00:00");
  });
  it("파싱 불가면 null", () => {
    expect(seoulDateTime("확인 중")).toBeNull();
  });
});

describe("updateDelay — 갱신 지연 판정(감사 92)", () => {
  const due = "2026-07-19T03:00:00+09:00";
  it("예정 시각이 지났으면 지연 일수(내림)를 준다", () => {
    expect(updateDelay(due, new Date("2026-07-22T09:00:00+09:00"))).toEqual({ overdue: true, days: 3 });
    expect(updateDelay(due, new Date("2026-07-19T10:00:00+09:00"))).toEqual({ overdue: true, days: 0 });
  });
  it("예정 시각 이전이면 지연 아님", () => {
    expect(updateDelay(due, new Date("2026-07-19T02:59:00+09:00"))).toEqual({ overdue: false, days: 0 });
  });
  it("파싱 불가면 null — 지연 여부를 단정하지 않는다", () => {
    expect(updateDelay("미정", new Date("2026-07-22T09:00:00+09:00"))).toBeNull();
  });
});

describe("isFreshUpdate — 갱신 직후 판정(2026-08-02 지시: 갱신을 방문자가 인식해야 한다)", () => {
  const crawled = "2026-08-02T04:46:57+09:00";
  it("기본 3일 창 안이면 갱신 직후", () => {
    expect(isFreshUpdate(crawled, 3, new Date("2026-08-02T09:00:00+09:00"))).toBe(true);
    expect(isFreshUpdate(crawled, 3, new Date("2026-08-05T23:00:00+09:00"))).toBe(true);
  });
  it("창을 벗어나면 갱신 직후가 아니다", () => {
    expect(isFreshUpdate(crawled, 3, new Date("2026-08-06T00:10:00+09:00"))).toBe(false);
  });
  it("파싱 불가면 null — 갱신 여부를 단정하지 않는다", () => {
    expect(isFreshUpdate("미정", 3, new Date("2026-08-02T09:00:00+09:00"))).toBeNull();
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
