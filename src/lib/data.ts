import type { AuctionItem, Category } from "@/types/auction";
import { CATEGORIES } from "@/types/catalog";
import { dday, isValidDateOnly, seoulDateTime, shiftDays, todaySeoul } from "@/lib/format";

// 필터·정렬·픽·손상 판정 — 전부 순수 함수. 화면 코드는 이 모듈만 사용한다.
// CATEGORIES는 catalog에서 가져온다 — types/auction 경유는 zod를 클라이언트 번들에 끌어온다(§13 규칙 4).

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

// ---------------------------------------------------------------------------
// 손상 데이터 가드(감사 36) — 원천 JSON이 깨져도 화면이 거짓 금액·픽 배지를 단정 표기하지 않게 막는다.
// types/auction.ts의 zod 스키마와 같은 불변식을 검사하되 zod를 클라이언트 번들에 싣지 않는다
// (과거 First Load JS 199→130kB 절감 이력 — §13 규칙 4 성능 예산).
// ---------------------------------------------------------------------------

const CATEGORY_SET: ReadonlySet<string> = new Set<string>(CATEGORIES);
const RESULT_SET: ReadonlySet<string> = new Set(["유찰", "변경", "신건"]);

const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isPosInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;
const isHttps = (v: unknown): v is string =>
  typeof v === "string" && v.startsWith("https://");
const isNumberOrNull = (v: unknown): v is number | null =>
  v === null || (typeof v === "number" && Number.isFinite(v));

/** 표시 가능한 물건인지 — 하나라도 어긋나면 그 항목만 폐기한다(전체 화면을 죽이지 않는다). */
export function isValidAuctionItem(value: unknown): value is AuctionItem {
  if (typeof value !== "object" || value === null) return false;
  const it = value as Record<string, unknown>;
  if (
    !isText(it.id) ||
    !isText(it.court) ||
    !isText(it.caseNo) ||
    !isText(it.itemNo) ||
    !isText(it.address) ||
    !isText(it.region) ||
    !isText(it.district)
  ) {
    return false;
  }
  if (typeof it.saleTime !== "string" || typeof it.courtRoom !== "string") return false;
  if (it.specialNote !== null && typeof it.specialNote !== "string") return false;
  if (!CATEGORY_SET.has(it.category as string)) return false;
  if (!isValidDateOnly(it.saleDate)) return false; // 존재하지 않는 기일 폐기(감사 37)
  if (!isNumberOrNull(it.areaBuilding) || !isNumberOrNull(it.areaLand)) return false;
  if (!isHttps(it.detailUrl)) return false; // 외부 데이터 불신 — https만 href에 쓴다(§13 규칙 1)
  if (it.photoUrl !== null && !isHttps(it.photoUrl)) return false;
  if (typeof it.deposit !== "number" || !Number.isInteger(it.deposit) || it.deposit < 0) {
    return false;
  }
  const { appraisalPrice, minPrice, priceRatio, failCount } = it;
  if (!isPosInt(appraisalPrice) || !isPosInt(minPrice)) return false;
  if (typeof priceRatio !== "number" || !(priceRatio > 0) || priceRatio > 1) return false;
  // 할인율·픽 배지의 근거값 — 저장 비율과 계산 비율이 어긋나면 표기 자체가 거짓이 된다(§2 부호 반전 주의).
  if (Math.abs(minPrice / appraisalPrice - priceRatio) > 0.005) return false;
  if (!Array.isArray(it.history) || it.history.length === 0) return false;
  let fails = 0;
  for (const entry of it.history) {
    if (typeof entry !== "object" || entry === null) return false;
    const h = entry as Record<string, unknown>;
    if (!isValidDateOnly(h.date) || !isPosInt(h.minPrice)) return false;
    if (!RESULT_SET.has(h.result as string)) return false;
    if (h.result === "유찰") fails++;
  }
  // 유찰 2회 이상만 수집하는 제품 정체성 + history 정합(스키마 superRefine과 동일 판정).
  if (!isPosInt(failCount) || failCount < 2) return false;
  return failCount === fails;
}

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

/**
 * 이번 주 신규: 유찰 2회째 도달이 **오늘 기준** 7일 창 안인 물건.
 * 판정창을 crawledAt에 걸면 갱신이 밀린 주에 13~16일 전 물건이 "이번 주"로 단정된다(감사 40) —
 * 하한은 오늘−7일, 상한은 crawledAt(수집 시점 이후 사실은 아직 없다). 지연 주에는 결과가 비고 섹션이 사라진다.
 */
export function isNewThisWeek(
  item: AuctionItem,
  crawledAt: string,
  today: string = todaySeoul(),
): boolean {
  const fails = item.history.filter((h) => h.result === "유찰").map((h) => h.date).sort();
  if (fails.length < 2) return false;
  const crawlDate = seoulDateTime(crawledAt)?.date;
  const from = shiftDays(today, -7);
  if (!crawlDate || from === null) return false;
  const secondFail = fails[1];
  return secondFail >= from && secondFail <= crawlDate;
}

export function newThisWeek(
  items: AuctionItem[],
  crawledAt: string,
  today: string = todaySeoul(),
): AuctionItem[] {
  return items.filter((i) => isNewThisWeek(i, crawledAt, today));
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
