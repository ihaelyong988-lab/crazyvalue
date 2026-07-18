import type { AuctionItem, Category } from "@/types/auction";
import { dday, todaySeoul } from "@/lib/format";

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
  districts: string[]; // 시·군·구 결합 키("시도:시군구", 구형은 시군구 단독), 빈 배열 = 전체
  priceBands: PriceBandKey[];
  categories: Category[];
  pickOnly?: boolean;
}

// 시·군·구 결합 키(감사 14) — 동명 시군구(대구 북구·광주 북구)를 시도로 구분한다.
// 상태 배열·URL d 파라미터가 같은 인코딩을 공유한다. 시군구 이름에 구분자가 없음을 전제한다.
export const DISTRICT_KEY_SEP = ":";

/** (시도, 시군구) → 결합 키 "시도:시군구" */
export function districtKey(region: string, district: string): string {
  return `${region}${DISTRICT_KEY_SEP}${district}`;
}

/** 결합 키 분해. 구분자 없는 구형 값은 region: null로 이름만 반환한다(하위호환). */
export function parseDistrictKey(value: string): { region: string | null; district: string } {
  const idx = value.indexOf(DISTRICT_KEY_SEP);
  return idx === -1
    ? { region: null, district: value }
    : { region: value.slice(0, idx), district: value.slice(idx + 1) };
}

/** 시군구 매칭 — 결합 키 일치 또는 구형 값(시도 없음)의 이름 일치(구 URL 하위호환). */
function matchesDistricts(item: AuctionItem, districts: string[]): boolean {
  const key = districtKey(item.region, item.district);
  return districts.some((d) => d === key || d === item.district);
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
  if (f.districts.length > 0 && !matchesDistricts(item, f.districts)) return false;
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

export function sortItems(
  items: AuctionItem[],
  sort: SortKey,
  today: string = todaySeoul(),
): AuctionItem[] {
  const arr = [...items];
  switch (sort) {
    case "date":
      // 기일 경과(dday<0) 물건은 입찰 불가 — 임박순에서 후순위로 보낸다(감사 12).
      // 경과 여부 판정만 하고, 각 구간 내부는 기일 오름차순을 유지한다.
      return arr.sort((a, b) => {
        const pastA = dday(a.saleDate, today) < 0 ? 1 : 0;
        const pastB = dday(b.saleDate, today) < 0 ? 1 : 0;
        if (pastA !== pastB) return pastA - pastB;
        return a.saleDate.localeCompare(b.saleDate);
      });
    case "discount":
      return arr.sort((a, b) => a.priceRatio - b.priceRatio);
    case "price":
      return arr.sort((a, b) => a.minPrice - b.minPrice);
    case "new":
      return arr.sort((a, b) => latestFailDate(b).localeCompare(latestFailDate(a)));
  }
}
