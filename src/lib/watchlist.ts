import type { AuctionItem } from "@/types/auction";

// 관심함·최근 본 물건·온보딩 선호 — localStorage `crazyvalue.*` (무가입 원칙, §5.5).
// 모든 localStorage 접근은 이 파일의 try-parse 단일 유틸을 경유한다(§13 규칙 5).

const WATCH_KEY = "crazyvalue.watchlist.v1";
const RECENT_KEY = "crazyvalue.recent.v1";
const DIFF_CACHE_KEY = "crazyvalue.watchdiff.session.v1";
/** 홈 필터 세션 미러 키 — 관심조건 저장 시 무효화 대상(감사 2차 32). page.tsx와 공유한다. */
export const HOME_FILTERS_KEY = "crazyvalue.home-filters.v1";
/** 미러 기록 시각 키 — 미러와 관심조건 중 어느 쪽이 최신인지 재는 눈금(감사 3차 32). 미러와 함께 쓰고 함께 버린다. */
const HOME_FILTERS_AT_KEY = "crazyvalue.home-filters-at.v1";

export interface WatchSnapshot {
  minPrice: number;
  saleDate: string;
  failCount: number;
  /** 등록 시점 식별 정보(선택) — 매각 종료 카드 표기용. v1 데이터에 없어도 유효하다(하위호환). */
  address?: string;
  category?: string;
}
export interface WatchEntry {
  addedAt: string;
  snapshot: WatchSnapshot;
}
export interface Prefs {
  regions: string[];
  priceBands: string[];
  /**
   * 마지막 저장 시각(epoch ms) — 홈 복원이 미러와 나이를 겨루는 값이다(감사 3차 32).
   * 구버전 저장값에는 없다. 없으면 "가장 오래됨"으로 취급해 종전 복원 순서를 그대로 쓴다(하위호환).
   */
  savedAt?: number;
}
export interface WatchState {
  items: Record<string, WatchEntry>;
  prefs: Prefs;
  onboarded?: boolean;
}
interface RecentState {
  ids: string[];
}

// 기본값은 호출마다 새 객체를 만든다 — 공유 상수를 반환하면 호출부 변이가 상수를 오염시킨다.
const emptyWatch = (): WatchState => ({ items: {}, prefs: { regions: [], priceBands: [] } });

// ---- 형태 가드 ----
// JSON.parse가 성공해도 구조가 다르면(items:null·snapshot:null·ids:null 등) 화면이 크래시하고,
// 저장값이 남는 한 재방문마다 반복된다. 불일치 부분은 기본값·유효 항목으로 치환해 즉시 저장한다.

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isOptionalString = (v: unknown): boolean => v === undefined || typeof v === "string";

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 스냅샷 기일은 YYYY-MM-DD 실재 날짜만 유효하다(감사 2차 35).
 * typeof string만 보면 `"undefined"`·`"2026-02-30"` 같은 손상값이 그대로 렌더돼 화면에 `(undefined)`가 새어나간다.
 * 표시·계산은 format.ts 단일 경유(§13 규칙 12)이며 여기서는 저장값의 형태만 판정한다.
 */
function isDateOnly(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); // 말일 초과(2026-02-30)는 폐기
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function isWatchEntry(v: unknown): v is WatchEntry {
  if (!isPlainObject(v) || typeof v.addedAt !== "string") return false;
  const snap = v.snapshot;
  return (
    isPlainObject(snap) &&
    isFiniteNumber(snap.minPrice) &&
    isDateOnly(snap.saleDate) &&
    isFiniteNumber(snap.failCount) &&
    isOptionalString(snap.address) &&
    isOptionalString(snap.category)
  );
}

function sanitizeWatch(
  parsed: unknown,
  fallback: WatchState,
): { value: WatchState; repaired: boolean } {
  if (!isPlainObject(parsed)) return { value: fallback, repaired: true };
  const value = fallback;
  let repaired = false;
  if (isPlainObject(parsed.items)) {
    for (const [id, entry] of Object.entries(parsed.items)) {
      if (isWatchEntry(entry)) value.items[id] = entry;
      else repaired = true;
    }
  } else {
    repaired = true;
  }
  const prefs = parsed.prefs;
  if (isPlainObject(prefs) && isStringArray(prefs.regions) && isStringArray(prefs.priceBands)) {
    value.prefs = { regions: prefs.regions, priceBands: prefs.priceBands };
    // savedAt은 복원 우선순위를 가르는 값이라 손상값(문자열·NaN·음수)을 통과시키면 조건이 영구 미반영된다.
    // 유효하지 않으면 필드를 두지 않는다 = 구버전 저장값과 같은 취급(가장 오래됨).
    if (isFiniteNumber(prefs.savedAt) && prefs.savedAt > 0) value.prefs.savedAt = prefs.savedAt;
    else if (prefs.savedAt !== undefined) repaired = true;
  } else {
    repaired = true;
  }
  if (typeof parsed.onboarded === "boolean") value.onboarded = parsed.onboarded;
  else if (parsed.onboarded !== undefined) repaired = true;
  return { value, repaired };
}

function sanitizeRecent(
  parsed: unknown,
  fallback: RecentState,
): { value: RecentState; repaired: boolean } {
  if (!isPlainObject(parsed) || !Array.isArray(parsed.ids)) return { value: fallback, repaired: true };
  const ids = parsed.ids.filter((x): x is string => typeof x === "string");
  return { value: { ids }, repaired: ids.length !== parsed.ids.length };
}

/** 실패 분기 필수(§13 규칙 5): 파싱 실패·형태 불일치·저장 불가 시 조용히 기본값으로 동작한다. */
function safeRead<T>(
  key: string,
  makeFallback: () => T,
  sanitize: (parsed: unknown, fallback: T) => { value: T; repaired: boolean },
): T {
  const fallback = makeFallback();
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const { value, repaired } = sanitize(JSON.parse(raw), fallback);
    if (repaired) safeWrite(key, value); // 복구본으로 치환 저장 — 손상 상태의 영구 반복을 끊는다
    return value;
  } catch {
    return fallback;
  }
}

/**
 * 저장 성공 여부를 반환한다(감사 2차 31) — 무가입 앱에서 localStorage는 유일한 사용자 상태이므로,
 * 실패(용량 초과·프라이빗 모드)를 삼키면 화면만 성공으로 바뀌고 실제 저장은 0이 된다.
 * 호출부는 반환값으로 실패를 사용자에게 알린다.
 */
function safeWrite(key: string, value: unknown): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * 홈 필터 세션 미러 무효화(감사 2차 32).
 * 복원 순서가 URL → 세션 미러 → prefs라, 미러가 남으면 이후 저장한 관심조건이 그 탭에 영구 미반영된다.
 * 관심조건 저장은 "이 조건으로 본다"는 명시적 의사이므로 미러를 버려 다음 복원이 prefs를 쓰게 한다.
 */
export function clearHomeFilterMirror(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(HOME_FILTERS_KEY);
    window.sessionStorage.removeItem(HOME_FILTERS_AT_KEY); // 값과 기록 시각은 같은 사실의 두 조각이다
  } catch {
    // 세션 접근 불가(프라이빗 모드)면 미러 자체가 없다 — 복원은 prefs 경로로 간다.
  }
}

/** 홈이 미러를 쓴 시각을 함께 남긴다 — 이 눈금이 없으면 관심조건과 미러의 나이를 겨룰 수 없다(감사 3차 32). */
export function stampHomeFilterMirror(at: number = Date.now()): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(HOME_FILTERS_AT_KEY, String(at));
  } catch {
    // 기록 실패 = 시각 미상. readHomeFilterMirrorAt이 null을 돌려 미러를 최신으로 본다(종전 동작).
  }
}

/**
 * 미러 기록 시각. null = 시각 미상 — 리스트 화면이 쓴 미러이거나 기록에 실패한 경우다.
 * 미상이면 호출부는 미러를 최신으로 본다: 리스트에서 방금 바꾼 조건을 옛 관심조건으로 덮지 않기 위함이다.
 */
export function readHomeFilterMirrorAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(HOME_FILTERS_AT_KEY);
    if (raw === null) return null;
    const at = Number(raw);
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

/** 홈 필터 복원 원천 — 주소창(방문 의도) · 세션 미러(보던 조건) · 관심조건(저장한 조건). */
export type HomeRestoreSource = "url" | "mirror" | "prefs";

export interface HomeRestoreInput {
  /** 같은 문서에서의 재마운트(뒤로가기·하단탭 이동)인가. 새 문서면 URL이 곧 방문 의도다. */
  remounted: boolean;
  /** 주소창에 필터 4축(r·d·b·c) 중 하나라도 있는가. */
  hasUrlFilters: boolean;
  /** 세션 미러 존재 여부. */
  hasMirror: boolean;
  /** 미러 기록 시각. null = 시각 미상 = 최신으로 본다. */
  mirrorAt: number | null;
  /** 관심조건 저장 시각. 0 = 저장 이력 없음(구버전 저장값 포함). */
  prefsSavedAt: number;
}

/**
 * 홈 복원 우선순위: URL → 관심조건(미러보다 최신이면) → 미러 → 관심조건(감사 3차 32).
 *
 * 가운데 티어가 없으면 /me에서 바꾼 조건이 홈에 영영 도달하지 못한다 — 재마운트 홈의 URL은 떠날 때의
 * 스냅샷이라 그 뒤 저장한 조건을 모르는데, 그 스냅샷이 미러로 되쓰이면 이후 모든 진입이 옛 조건으로 열린다.
 * 새 문서의 URL(공유 링크·직접 진입)만 관심조건보다 앞선다.
 */
export function chooseHomeRestore(input: HomeRestoreInput): HomeRestoreSource {
  if (input.hasUrlFilters && !input.remounted) return "url";
  const mirrorAt = !input.hasMirror ? 0 : (input.mirrorAt ?? Number.MAX_SAFE_INTEGER);
  if (input.prefsSavedAt > mirrorAt) return "prefs";
  if (input.hasMirror) return "mirror";
  if (input.hasUrlFilters) return "url"; // 미러도 새 조건도 없다 = 히스토리 스냅샷이 최선이다
  return "prefs";
}

/**
 * 타 탭의 관심함·관심조건 변경 구독(감사 2차 33). 반환값은 구독 해제 함수다.
 * storage 이벤트는 저장한 탭이 아닌 다른 탭에서만 발생하므로, 이 통지가 곧 "내 화면이 옛 상태"라는 신호다.
 */
export function subscribeWatchState(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: StorageEvent) => {
    if (e.key !== null && e.key !== WATCH_KEY) return; // key === null = 타 탭의 storage.clear()
    onChange();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

const sameList = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((x) => b.includes(x));

const samePrefs = (a: Prefs, b: Prefs): boolean =>
  sameList(a.regions, b.regions) && sameList(a.priceBands, b.priceBands);

/**
 * 타 탭의 **관심조건** 변경만 구독한다(감사 2차 33).
 * current()는 이 화면이 지금 들고 있는 조건이다 — 관심함 항목만 바뀐 통지나 이미 같은 값인 통지를
 * 걸러야 화면이 근거 없이 되돌아가거나 거짓 안내를 띄우지 않는다.
 */
export function subscribePrefs(
  current: () => Prefs,
  onChange: (prefs: Prefs) => void,
): () => void {
  return subscribeWatchState(() => {
    const next = getWatchState().prefs;
    if (samePrefs(current(), next)) return;
    onChange(next);
  });
}

export function getWatchState(): WatchState {
  return safeRead<WatchState>(WATCH_KEY, emptyWatch, sanitizeWatch);
}

export function isWatched(id: string): boolean {
  return id in getWatchState().items;
}

export interface WatchWriteResult {
  /** 저장 반영 후의 관심 등록 상태 — 저장 실패 시에는 직전 상태 그대로다. */
  watched: boolean;
  /** 저장 성공 여부. false면 이번 변경이 이 기기에 남지 않는다. */
  saved: boolean;
}

export function toggleWatch(item: AuctionItem, now: Date = new Date()): WatchWriteResult {
  const state = getWatchState();
  const removing = item.id in state.items;
  if (removing) {
    delete state.items[item.id];
  } else {
    state.items[item.id] = {
      addedAt: now.toISOString(),
      snapshot: {
        minPrice: item.minPrice,
        saleDate: item.saleDate,
        failCount: item.failCount,
        address: item.address,
        category: item.category,
      },
    };
  }
  // 저장 실패면 저장소는 직전 상태 그대로다 — 화면도 직전 상태를 유지해야 사실과 일치한다(감사 2차 31).
  if (!safeWrite(WATCH_KEY, state)) return { watched: removing, saved: false };
  if (removing) dropDiffCache(item.id);
  return { watched: !removing, saved: true };
}

export function removeWatch(id: string): boolean {
  const state = getWatchState();
  if (!(id in state.items)) return true; // 이미 없음 = 저장할 변경 없음
  delete state.items[id];
  const saved = safeWrite(WATCH_KEY, state);
  if (saved) dropDiffCache(id);
  return saved;
}

/**
 * 관심조건 저장. 온보딩 완료 플래그는 세우지 않는다(감사 2차 34 — 기록은 온보딩 시트만).
 * 저장 시각을 함께 남긴다(감사 3차 32): 미러 무효화가 실패하거나 옛 URL이 미러로 되살아나도,
 * 홈은 이 시각으로 "관심조건이 더 최신"임을 알아 새 조건을 연다.
 */
export function setPrefs(prefs: Prefs, now: number = Date.now()): boolean {
  const state = getWatchState();
  state.prefs = { regions: [...prefs.regions], priceBands: [...prefs.priceBands], savedAt: now };
  const saved = safeWrite(WATCH_KEY, state);
  if (saved) clearHomeFilterMirror();
  return saved;
}

export function isOnboarded(): boolean {
  return getWatchState().onboarded === true;
}

export function markOnboarded(): boolean {
  const state = getWatchState();
  state.onboarded = true;
  return safeWrite(WATCH_KEY, state);
}

// ---- 상태 변화 판정(원안 "추적기능", §5.5) ----
export type WatchDiff = "재유찰" | "기일 변경" | "매각 종료" | null;

/** 갱신된 산출물과 스냅샷 비교. current 부재 = 목록 소멸(매각 종료 등). */
export function diffWatch(snapshot: WatchSnapshot, current: AuctionItem | undefined): WatchDiff {
  if (!current) return "매각 종료";
  if (current.minPrice < snapshot.minPrice) return "재유찰";
  if (current.saleDate !== snapshot.saleDate) return "기일 변경";
  return null;
}

/** 변화 배지 표시 후 스냅샷을 현재 데이터로 갱신한다(다음 갱신분 비교 기준). 식별 정보도 최신화한다. */
export function refreshSnapshot(id: string, current: AuctionItem): boolean {
  const state = getWatchState();
  const entry = state.items[id];
  if (!entry) return false;
  entry.snapshot = {
    ...entry.snapshot,
    minPrice: current.minPrice,
    saleDate: current.saleDate,
    failCount: current.failCount,
    address: current.address,
    category: current.category,
  };
  return safeWrite(WATCH_KEY, state);
}

// ---- 변화 배지 세션 캐시(§4.3-④ 보완) ----
// 스냅샷은 판정 직후 갱신되므로(다음 갱신분 비교 기준) 판정 결과·이전 값을 sessionStorage에 보존해
// 같은 방문(뒤로가기·재진입) 동안 배지·상단 고정·이전→현재 표기를 재현한다. 탭 종료 시 소멸.

export interface CachedDiff {
  diff: Exclude<WatchDiff, null>;
  prevMinPrice: number;
  prevSaleDate: string;
}

const DIFF_VALUES: readonly string[] = ["재유찰", "기일 변경", "매각 종료"];

function isCachedDiff(v: unknown): v is CachedDiff {
  return (
    isPlainObject(v) &&
    typeof v.diff === "string" &&
    DIFF_VALUES.includes(v.diff) &&
    typeof v.prevMinPrice === "number" &&
    typeof v.prevSaleDate === "string"
  );
}

export function readDiffCache(): Record<string, CachedDiff> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(DIFF_CACHE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return {};
    const out: Record<string, CachedDiff> = {};
    for (const [id, v] of Object.entries(parsed)) if (isCachedDiff(v)) out[id] = v;
    return out;
  } catch {
    return {};
  }
}

export function writeDiffCache(cache: Record<string, CachedDiff>): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(DIFF_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // 저장 실패는 배지 지속성 저하로만 흡수한다.
  }
}

/** 관심 해제 시 세션 캐시 잔존 배지를 함께 제거한다(재등록 시 과거 변화 재표시 방지). */
function dropDiffCache(id: string): void {
  const cache = readDiffCache();
  if (!(id in cache)) return;
  delete cache[id];
  writeDiffCache(cache);
}

// ---- 최근 본 물건(최대 5건, §4.3-① 8) ----
export function getRecentIds(): string[] {
  return safeRead<RecentState>(RECENT_KEY, () => ({ ids: [] }), sanitizeRecent).ids.slice(0, 5);
}

export function pushRecent(id: string): boolean {
  const ids = getRecentIds().filter((x) => x !== id);
  ids.unshift(id);
  return safeWrite(RECENT_KEY, { ids: ids.slice(0, 5) });
}

// ---- 내 데이터 초기화(감사 2차 53) ----
// 무가입 앱에서 로그아웃에 대응하는 유일한 수단 — 이 기기에 남은 상태를 전부 지운다.
// 키를 열거해 지운다: 개별 키를 나열하면 이후 추가된 `crazyvalue.*` 키가 조용히 살아남는다.

const CV_PREFIX = "crazyvalue.";

/**
 * 접두 전량 삭제에서 빼는 키(감사 3차) — 확인 문구가 예고한 것만 지운다는 계약이다.
 * install: 설치 배너 "다시 보지 않겠다"는 의사는 관심함·최근 본 물건·관심조건 어디에도 속하지 않는다.
 * 지우면 한 번 닫은 배너가 예고 없이 되살아난다.
 */
const KEEP_KEYS = new Set(["crazyvalue.install.v1"]);

function clearNamespace(storage: Storage): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key !== null && key.startsWith(CV_PREFIX) && !KEEP_KEYS.has(key)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

/**
 * 관심함·최근 본 물건·관심조건·온보딩 기록을 이 기기에서 제거한다(감사 2차 53).
 * 되돌릴 수 없으므로 호출부는 확인을 경유한다. 반환값 false = localStorage 값이 그대로 남았다.
 */
export function resetAll(): boolean {
  if (typeof window === "undefined") return false;
  let cleared = true;
  try {
    clearNamespace(window.localStorage);
  } catch {
    cleared = false;
  }
  try {
    clearNamespace(window.sessionStorage); // 홈 필터 미러·변화 배지 캐시·앱 내 이동 플래그
  } catch {
    // 세션 저장소는 탭 수명뿐 — 접근 실패해도 영구 저장값은 이미 지워졌다.
  }
  // 페인트 전 온보딩 은닉 플래그(public/onboarding-flag.js)도 같은 사실의 미러다.
  // 남겨 두면 초기화 뒤 온보딩 시트가 CSS로 숨은 채 배경만 비활성화된다.
  if (typeof document !== "undefined")
    document.documentElement.removeAttribute("data-cv-onboarded");
  return cleared;
}
