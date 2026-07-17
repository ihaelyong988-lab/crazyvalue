import type { AuctionItem, Category } from "@/types/auction";

// 필터·정렬·픽 판정 — 전부 순수 함수. 화면 코드는 이 모듈만 사용한다.

export const PRICE_BANDS = [
  { key: "b1", label: "~5천만", min: 0, max: 50_000_000 },
  { key: "b2", label: "5천만~1억", min: 50_000_000, max: 100_000_000 },
  { key: "b3", label: "1~3억", min: 100_000_000, max: 300_000_000 },
  { key: "b4", label: "3~10억", min: 300_000_000, max: 1_000_000_000 },
  { key: "b5", label: "10억~", min: 1_000_000_000, max: Infinity },
] as const;
export type PriceBandKey = (typeof PRICE_BANDS)[number]["key"];

export type SortKey = "date" | "discount" | "price" | "new";
export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "date", label: "기일 임박순" },
  { key: "discount", label: "할인율 높은순" },
  { key: "price", label: "최저가 낮은순" },
  { key: "new", label: "신규순" },
];

export interface Filters {
  regions: string[]; // 시·도 한글명, 빈 배열 = 전체
  districts: string[]; // 시·군·구, 빈 배열 = 전체
  priceBands: PriceBandKey[];
  categories: Category[];
  pickOnly?: boolean;
}

export const EMPTY_FILTERS: Filters = {
  regions: [],
  districts: [],
  priceBands: [],
  categories: [],
};

/** 미친가치 픽 = 최저가 ≤ 감정가의 50% (공개 기준, 파생 계산 — 저장 필드 아님) */
export function isPick(item: Pick<AuctionItem, "priceRatio">): boolean {
  return item.priceRatio <= 0.5;
}

function inBand(minPrice: number, key: PriceBandKey): boolean {
  const band = PRICE_BANDS.find((b) => b.key === key);
  if (!band) return false;
  // 경계 규약: 하한 초과~상한 이하. 첫 구간만 0 포함.
  return band.key === "b1"
    ? minPrice <= band.max
    : minPrice > band.min && minPrice <= band.max;
}

export function matchesFilters(item: AuctionItem, f: Filters): boolean {
  if (f.regions.length > 0 && !f.regions.includes(item.region)) return false;
  if (f.districts.length > 0 && !f.districts.includes(item.district)) return false;
  if (f.priceBands.length > 0 && !f.priceBands.some((b) => inBand(item.minPrice, b))) return false;
  if (f.categories.length > 0 && !f.categories.includes(item.category)) return false;
  if (f.pickOnly && !isPick(item)) return false;
  return true;
}

export function applyFilters(items: AuctionItem[], f: Filters): AuctionItem[] {
  return items.filter((i) => matchesFilters(i, f));
}

/** 마지막(=2회 도달 이후 최근) 유찰 일자 — 신규순 정렬 근거 */
function latestFailDate(item: AuctionItem): string {
  const fails = item.history.filter((h) => h.result === "유찰").map((h) => h.date);
  return fails.length ? fails.sort().at(-1)! : "0000-00-00";
}

/** 이번 주 신규: 직전 갱신 주기(7일) 안에 유찰 2회째에 도달한 물건 */
export function isNewThisWeek(item: AuctionItem, crawledAt: string): boolean {
  const fails = item.history.filter((h) => h.result === "유찰").map((h) => h.date).sort();
  if (fails.length < 2) return false;
  const secondFail = fails[1];
  const crawlDate = crawledAt.slice(0, 10);
  const weekAgo = new Date(Date.parse(crawlDate + "T00:00:00Z") - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return secondFail >= weekAgo && secondFail <= crawlDate;
}

export function newThisWeek(items: AuctionItem[], crawledAt: string): AuctionItem[] {
  return items.filter((i) => isNewThisWeek(i, crawledAt));
}

export function sortItems(items: AuctionItem[], sort: SortKey): AuctionItem[] {
  const arr = [...items];
  switch (sort) {
    case "date":
      return arr.sort((a, b) => a.saleDate.localeCompare(b.saleDate));
    case "discount":
      return arr.sort((a, b) => a.priceRatio - b.priceRatio);
    case "price":
      return arr.sort((a, b) => a.minPrice - b.minPrice);
    case "new":
      return arr.sort((a, b) => latestFailDate(b).localeCompare(latestFailDate(a)));
  }
}
