import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTERS,
  applyFilters,
  districtKey,
  isNewThisWeek,
  isPick,
  parseDistrictKey,
  sortItems,
} from "@/lib/data";
import { buildListQuery, parseListQuery } from "@/lib/query";
import type { AuctionItem } from "@/types/auction";

function mk(over: Partial<AuctionItem>): AuctionItem {
  return {
    id: "t-2025타경10000-1",
    court: "수원지방법원",
    caseNo: "2025타경10000",
    itemNo: "1",
    category: "아파트",
    address: "경기 수원시 영통구 중앙로 1",
    region: "경기",
    district: "수원시 영통구",
    appraisalPrice: 100_000_000,
    minPrice: 49_000_000,
    priceRatio: 0.49,
    failCount: 2,
    saleDate: "2026-08-01",
    saleTime: "10:00",
    courtRoom: "경매법정 제1호",
    deposit: 4_900_000,
    areaBuilding: 84.9,
    areaLand: null,
    photoUrl: null,
    detailUrl: "https://www.courtauction.go.kr/",
    history: [
      { date: "2026-05-01", minPrice: 100_000_000, result: "신건" },
      { date: "2026-06-05", minPrice: 100_000_000, result: "유찰" },
      { date: "2026-07-10", minPrice: 70_000_000, result: "유찰" },
    ],
    specialNote: null,
    ...over,
  };
}

describe("isPick — 공개 기준: priceRatio ≤ 0.5", () => {
  it("경계 0.5 정확값은 픽", () => {
    expect(isPick({ priceRatio: 0.5 })).toBe(true);
  });
  it("0.5 초과는 픽 아님", () => {
    expect(isPick({ priceRatio: 0.5001 })).toBe(false);
    expect(isPick({ priceRatio: 0.64 })).toBe(false);
  });
  it("0.49는 픽", () => {
    expect(isPick({ priceRatio: 0.49 })).toBe(true);
  });
});

describe("applyFilters — 3축 조합·금액 경계", () => {
  const items = [
    mk({ id: "a", region: "서울", district: "강남구", minPrice: 50_000_000, priceRatio: 0.5, category: "아파트" }),
    mk({ id: "b", region: "서울", district: "노원구", minPrice: 50_001_000, priceRatio: 0.5, category: "상가" }),
    mk({ id: "c", region: "경기", district: "부천시", minPrice: 300_000_000, priceRatio: 0.6, category: "토지" }),
    mk({ id: "d", region: "경기", district: "평택시", minPrice: 1_000_001_000, priceRatio: 0.49, category: "공장창고" }),
  ];
  it("빈 필터 = 전체", () => {
    expect(applyFilters(items, EMPTY_FILTERS)).toHaveLength(4);
  });
  it("금액 경계: 정확히 5천만은 b1(~5천만)만, 초과분은 b2", () => {
    expect(applyFilters(items, { ...EMPTY_FILTERS, priceBands: ["b1"] }).map((i) => i.id)).toEqual(["a"]);
    expect(applyFilters(items, { ...EMPTY_FILTERS, priceBands: ["b2"] }).map((i) => i.id)).toEqual(["b"]);
  });
  it("금액 경계: 정확히 3억은 b3(1~3억) 상한 포함, 10억 초과는 b5", () => {
    expect(applyFilters(items, { ...EMPTY_FILTERS, priceBands: ["b3"] }).map((i) => i.id)).toEqual(["c"]);
    expect(applyFilters(items, { ...EMPTY_FILTERS, priceBands: ["b5"] }).map((i) => i.id)).toEqual(["d"]);
  });
  it("지역+용도+금액 3축 동시", () => {
    const got = applyFilters(items, {
      regions: ["서울"],
      districts: [districtKey("서울", "강남구")],
      priceBands: ["b1"],
      categories: ["아파트"],
    });
    expect(got.map((i) => i.id)).toEqual(["a"]);
  });
  it("복수 선택은 합집합", () => {
    const got = applyFilters(items, { ...EMPTY_FILTERS, priceBands: ["b1", "b5"] });
    expect(got.map((i) => i.id)).toEqual(["a", "d"]);
  });
  it("픽 전용 필터", () => {
    const got = applyFilters(items, { ...EMPTY_FILTERS, pickOnly: true });
    expect(got.map((i) => i.id)).toEqual(["a", "b", "d"]);
  });
});

describe("sortItems — 4종 정렬", () => {
  const items = [
    mk({ id: "a", saleDate: "2026-08-10", priceRatio: 0.6, minPrice: 300_000_000 }),
    mk({ id: "b", saleDate: "2026-07-20", priceRatio: 0.4, minPrice: 100_000_000 }),
    mk({ id: "c", saleDate: "2026-09-01", priceRatio: 0.5, minPrice: 50_000_000 }),
  ];
  it("기일 임박순(기본)", () => {
    expect(sortItems(items, "date", "2026-07-01").map((i) => i.id)).toEqual(["b", "a", "c"]);
  });
  it("기일 임박순 — 기일 경과(dday<0)는 후순위, 각 구간 내부는 오름차순 유지", () => {
    const mixed = [
      mk({ id: "p1", saleDate: "2026-07-17" }), // 경과
      mk({ id: "f1", saleDate: "2026-08-10" }),
      mk({ id: "p2", saleDate: "2026-07-09" }), // 경과
      mk({ id: "f2", saleDate: "2026-07-20" }),
      mk({ id: "t0", saleDate: "2026-07-18" }), // D-day(오늘)는 경과 아님
    ];
    expect(sortItems(mixed, "date", "2026-07-18").map((i) => i.id)).toEqual([
      "t0",
      "f2",
      "f1",
      "p2",
      "p1",
    ]);
  });
  it("할인율 높은순 = priceRatio 낮은순", () => {
    expect(sortItems(items, "discount").map((i) => i.id)).toEqual(["b", "c", "a"]);
  });
  it("최저가 낮은순", () => {
    expect(sortItems(items, "price").map((i) => i.id)).toEqual(["c", "b", "a"]);
  });
  it("원본 배열 불변", () => {
    sortItems(items, "price");
    expect(items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
});

describe("isNewThisWeek — 이번 갱신에서 유찰 2회 도달", () => {
  it("2회째 유찰이 기준일 7일 이내면 신규", () => {
    const item = mk({
      history: [
        { date: "2026-05-01", minPrice: 100_000_000, result: "신건" },
        { date: "2026-06-05", minPrice: 100_000_000, result: "유찰" },
        { date: "2026-07-10", minPrice: 70_000_000, result: "유찰" },
      ],
    });
    expect(isNewThisWeek(item, "2026-07-12T03:00:00+09:00")).toBe(true);
  });
  it("2회째 유찰이 오래됐으면 신규 아님", () => {
    const item = mk({
      history: [
        { date: "2026-03-01", minPrice: 100_000_000, result: "신건" },
        { date: "2026-04-05", minPrice: 100_000_000, result: "유찰" },
        { date: "2026-05-10", minPrice: 70_000_000, result: "유찰" },
      ],
    });
    expect(isNewThisWeek(item, "2026-07-12T03:00:00+09:00")).toBe(false);
  });
});

describe("시군구 결합 키 — 동명 시군구 구분(감사 14)", () => {
  const items = [
    mk({ id: "dg", region: "대구", district: "북구" }),
    mk({ id: "gj", region: "광주", district: "북구" }),
    mk({ id: "gn", region: "서울", district: "강남구" }),
  ];
  it("districtKey/parseDistrictKey 왕복", () => {
    expect(districtKey("대구", "북구")).toBe("대구:북구");
    expect(parseDistrictKey("대구:북구")).toEqual({ region: "대구", district: "북구" });
    expect(parseDistrictKey("북구")).toEqual({ region: null, district: "북구" });
  });
  it("결합 키는 해당 시도의 동명 시군구만 선택한다", () => {
    const got = applyFilters(items, {
      ...EMPTY_FILTERS,
      regions: ["대구", "광주"],
      districts: [districtKey("대구", "북구")],
    });
    expect(got.map((i) => i.id)).toEqual(["dg"]);
  });
  it("구형 값(시도 없음)은 이름 일치 전체와 매칭한다(구 URL 하위호환)", () => {
    const got = applyFilters(items, { ...EMPTY_FILTERS, districts: ["북구"] });
    expect(got.map((i) => i.id)).toEqual(["dg", "gj"]);
  });
});

describe("URL d 파라미터 — 결합 키 인코딩 왕복·하위호환(§13 규칙 11)", () => {
  it("결합 키가 buildListQuery→parseListQuery로 손실 없이 왕복한다", () => {
    const districts = [districtKey("대구", "북구"), districtKey("서울", "강남구")];
    const query = buildListQuery({ districts });
    const parsed = parseListQuery(new URLSearchParams(query));
    expect(parsed.districts).toEqual(districts);
  });
  it("구형 시군구 단독 값은 그대로 통과한다", () => {
    const parsed = parseListQuery(new URLSearchParams("d=북구,수원시 영통구"));
    expect(parsed.districts).toEqual(["북구", "수원시 영통구"]);
  });
  it("시도 부분이 유효하지 않은 결합 키는 버린다(§13 규칙 1)", () => {
    const parsed = parseListQuery(new URLSearchParams("d=몰라:북구,대구:북구,서울:"));
    expect(parsed.districts).toEqual(["대구:북구"]);
  });
});
