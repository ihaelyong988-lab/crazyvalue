import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REGIONS } from "@/types/catalog";
import {
  EMPTY_FILTERS,
  applyFilters,
  districtKey,
  isPick,
  isValidAuctionItem,
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

// isNewThisWeek(이력 기반 "이번 주 신규") 테스트는 함수와 함께 삭제됐다 — 매일 갱신에서는 주 단위
// 판정창이 성립하지 않고, 신규 여부는 이력 역산이 아니라 직전 산출물과의 id 대조로 센다
// (scripts/crawl-lib.ts countNewOnSharedDates · tests/unit/crawl-lib.test.ts).

describe("isValidAuctionItem — 손상 항목 폐기(감사 36)", () => {
  it("계약을 지킨 항목은 통과", () => {
    expect(isValidAuctionItem(mk({}))).toBe(true);
  });
  it("priceRatio가 금액과 어긋나면 폐기 — 거짓 할인율·픽 배지 차단", () => {
    expect(isValidAuctionItem(mk({ priceRatio: 0.2 }))).toBe(false);
    expect(isValidAuctionItem(mk({ minPrice: 49_400_000 }))).toBe(true); // 오차 0.005 이내는 통과
    expect(isValidAuctionItem(mk({ priceRatio: 0 }))).toBe(false);
    expect(isValidAuctionItem(mk({ priceRatio: 1.4 }))).toBe(false);
  });
  it("존재하지 않는 기일·형식 오류 날짜는 폐기", () => {
    expect(isValidAuctionItem(mk({ saleDate: "2026-02-30" }))).toBe(false);
    expect(isValidAuctionItem(mk({ saleDate: "2026/08/01" }))).toBe(false);
  });
  it("failCount와 history 유찰 수가 어긋나면 폐기", () => {
    expect(isValidAuctionItem(mk({ failCount: 5 }))).toBe(false);
    expect(isValidAuctionItem(mk({ failCount: 1 }))).toBe(false);
  });
  it("https 아닌 링크·알 수 없는 용도는 폐기", () => {
    expect(isValidAuctionItem(mk({ detailUrl: "http://www.courtauction.go.kr/" }))).toBe(false);
    expect(isValidAuctionItem(mk({ photoUrl: "javascript:alert(1)" }))).toBe(false);
    expect(isValidAuctionItem({ ...mk({}), category: "빌라" })).toBe(false);
  });
  it("금액·필수 문자열 손상, 이력 손상은 폐기", () => {
    expect(isValidAuctionItem({ ...mk({}), minPrice: "49000000" })).toBe(false);
    expect(isValidAuctionItem({ ...mk({}), appraisalPrice: 0 })).toBe(false);
    expect(isValidAuctionItem({ ...mk({}), address: "" })).toBe(false);
    expect(isValidAuctionItem({ ...mk({}), history: [] })).toBe(false);
    expect(isValidAuctionItem({ ...mk({}), history: [{ date: "2026-02-30", minPrice: 1, result: "유찰" }] })).toBe(
      false,
    );
    expect(isValidAuctionItem({ ...mk({}), history: "없음" })).toBe(false);
  });
  it("객체가 아닌 값은 폐기", () => {
    expect(isValidAuctionItem(null)).toBe(false);
    expect(isValidAuctionItem("item")).toBe(false);
    expect(isValidAuctionItem([])).toBe(false);
  });
  it("배포 중인 public/data 전건은 통과 — 가드가 계약보다 엄격하면 안 된다", () => {
    // 거짓 "형식 오류 N건 제외" 고지를 막는 안전망. zod 계약 통과분(mock-contract.test.ts)과 판정이 일치해야 한다.
    const dataDir = join(process.cwd(), "public", "data");
    let total = 0;
    for (const r of REGIONS) {
      const raw = JSON.parse(readFileSync(join(dataDir, `${r.key}.json`), "utf8")) as unknown[];
      for (const item of raw) {
        expect(isValidAuctionItem(item), `${r.key}.json 항목 폐기됨: ${JSON.stringify(item).slice(0, 120)}`).toBe(
          true,
        );
        total++;
      }
    }
    expect(total).toBeGreaterThan(0);
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
