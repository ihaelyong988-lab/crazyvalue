import { CATEGORIES, REGIONS, type Category } from "@/types/catalog";
import {
  PRICE_BANDS,
  SORT_OPTIONS,
  parseDistrictKey,
  type Filters,
  type PriceBandKey,
  type SortKey,
} from "@/lib/data";
import { HOME_FILTERS_KEY } from "@/lib/watchlist";

// /list 상태의 원천은 URL 쿼리다(§13 규칙 11) — 새로고침·뒤로가기·공유 링크에서 동일 화면 복원.
// 키: r=지역, d=시군구("시도:시군구" 결합 키, 구형 시군구 단독 값 하위호환 — 감사 14), b=금액구간,
//     c=용도, sort=정렬, n=표시건수, pick=1
export interface ListQuery extends Filters {
  sort: SortKey;
  count: number;
}

const BAND_KEYS = new Set(PRICE_BANDS.map((b) => b.key));
const SORT_KEYS = new Set(SORT_OPTIONS.map((s) => s.key));
const CATEGORY_SET = new Set<string>(CATEGORIES);

const REGION_NAMES = new Set(REGIONS.map((r) => r.name));

/** 다중값 파라미터 분해 — 빈 값과 중복 값을 버린다(첫 등장만 유지, 감사 2차 44). 4축이 이 함수를 공유한다. */
const splitParam = (v: string | null): string[] =>
  v ? [...new Set(v.split(",").filter(Boolean))] : [];

/** d 값 정제 — 결합 키는 시도·시군구 부분이 유효한 것만, 구형 단독 값은 그대로 통과. */
const cleanDistricts = (values: string[]): string[] =>
  values.filter((v) => {
    const { region, district } = parseDistrictKey(v);
    return region === null || (REGION_NAMES.has(region) && district.length > 0);
  });

/**
 * URL 쿼리 → 필터. 알 수 없는 값은 버린다(외부 입력 불신 — §13 규칙 1).
 * 화면은 이 결과를 "적용 중인 필터" 칩으로 그대로 단정 표기하므로, 유령 값·중복 값이 통과하면
 * 걸리지 않은 조건이 걸린 것처럼 보인다 — r·d·b·c 4축 전부 값 검증과 중복 제거를 거친다(감사 2차 44).
 */
export function parseListQuery(params: URLSearchParams): ListQuery {
  const rawN = Number(params.get("n"));
  return {
    regions: splitParam(params.get("r")).filter((r) => REGION_NAMES.has(r)),
    districts: cleanDistricts(splitParam(params.get("d"))),
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

/**
 * 홈 필터 세션 미러 읽기 — 값 형식은 URL 쿼리 문자열 그대로다(홈이 parseListQuery로 되읽는다).
 * 키 상수와 무효화(관심조건 저장 시 clearHomeFilterMirror)는 watchlist.ts가 소유한다(감사 2차 32).
 */
export function readHomeFilterMirror(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(HOME_FILTERS_KEY);
  } catch {
    return null; // 세션 접근 불가(프라이빗 모드) — 복원은 URL·prefs 경로로 간다.
  }
}

/**
 * 홈 필터 세션 미러 저장 — 홈·리스트가 공유하는 "지금 보고 있는 조건" 1곳이다(감사 2차 55).
 * 리스트에서 조건을 해제해도 홈의 히스토리 URL은 떠날 때의 스냅샷이라 그 변경을 모른다 —
 * 두 화면이 같은 미러를 갱신해야 홈·리스트가 서로 다른 건수를 주장하지 않는다.
 * 픽·정렬·표시건수는 홈에 없는 상태이므로 필터 4축만 기록한다.
 */
export function writeHomeFilterMirror(filters: Filters): void {
  if (typeof window === "undefined") return;
  const { regions, districts, priceBands, categories } = filters;
  try {
    window.sessionStorage.setItem(
      HOME_FILTERS_KEY,
      buildListQuery({ regions, districts, priceBands, categories }),
    );
  } catch {
    // 저장 불가(용량·프라이빗 모드)는 기능 저하로만 흡수한다(§13 규칙 5).
  }
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
