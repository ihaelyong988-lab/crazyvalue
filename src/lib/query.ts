import { CATEGORIES, type Category } from "@/types/catalog";
import { PRICE_BANDS, SORT_OPTIONS, type Filters, type PriceBandKey, type SortKey } from "@/lib/data";

// /list 상태의 원천은 URL 쿼리다(§13 규칙 11) — 새로고침·뒤로가기·공유 링크에서 동일 화면 복원.
// 키: r=지역, d=시군구, b=금액구간, c=용도, sort=정렬, n=표시건수, pick=1
export interface ListQuery extends Filters {
  sort: SortKey;
  count: number;
}

const BAND_KEYS = new Set(PRICE_BANDS.map((b) => b.key));
const SORT_KEYS = new Set(SORT_OPTIONS.map((s) => s.key));
const CATEGORY_SET = new Set<string>(CATEGORIES);

const splitParam = (v: string | null): string[] =>
  v ? v.split(",").filter(Boolean) : [];

/** URL 쿼리 → 필터. 알 수 없는 값은 버린다(외부 입력 불신 — §13 규칙 1). */
export function parseListQuery(params: URLSearchParams): ListQuery {
  const rawN = Number(params.get("n"));
  return {
    regions: splitParam(params.get("r")),
    districts: splitParam(params.get("d")),
    priceBands: splitParam(params.get("b")).filter((b): b is PriceBandKey =>
      BAND_KEYS.has(b as PriceBandKey),
    ),
    categories: splitParam(params.get("c")).filter((c): c is Category =>
      CATEGORY_SET.has(c),
    ),
    pickOnly: params.get("pick") === "1",
    sort: (SORT_KEYS.has(params.get("sort") as SortKey)
      ? params.get("sort")
      : "date") as SortKey,
    count: Number.isFinite(rawN) && rawN >= 10 ? Math.min(rawN, 500) : 10,
  };
}

/** 필터 → URL 쿼리 문자열. 기본값은 생략해 URL을 짧게 유지한다. */
export function buildListQuery(q: Partial<ListQuery>): string {
  const params = new URLSearchParams();
  if (q.regions?.length) params.set("r", q.regions.join(","));
  if (q.districts?.length) params.set("d", q.districts.join(","));
  if (q.priceBands?.length) params.set("b", q.priceBands.join(","));
  if (q.categories?.length) params.set("c", q.categories.join(","));
  if (q.pickOnly) params.set("pick", "1");
  if (q.sort && q.sort !== "date") params.set("sort", q.sort);
  if (q.count && q.count !== 10) params.set("n", String(q.count));
  const s = params.toString();
  return s ? `?${s}` : "";
}
