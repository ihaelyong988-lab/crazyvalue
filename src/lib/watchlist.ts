import type { AuctionItem } from "@/types/auction";

// 관심함·최근 본 물건·온보딩 선호 — localStorage `crazyvalue.*` (무가입 원칙, §5.5).
// 모든 localStorage 접근은 이 파일의 try-parse 단일 유틸을 경유한다(§13 규칙 5).

const WATCH_KEY = "crazyvalue.watchlist.v1";
const RECENT_KEY = "crazyvalue.recent.v1";
const DIFF_CACHE_KEY = "crazyvalue.watchdiff.session.v1";

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

function isWatchEntry(v: unknown): v is WatchEntry {
  if (!isPlainObject(v) || typeof v.addedAt !== "string") return false;
  const snap = v.snapshot;
  return (
    isPlainObject(snap) &&
    typeof snap.minPrice === "number" &&
    typeof snap.saleDate === "string" &&
    typeof snap.failCount === "number" &&
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

function safeWrite(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장 실패(용량·프라이빗 모드)는 기능 저하로만 흡수한다.
  }
}

export function getWatchState(): WatchState {
  return safeRead<WatchState>(WATCH_KEY, emptyWatch, sanitizeWatch);
}

export function isWatched(id: string): boolean {
  return id in getWatchState().items;
}

export function toggleWatch(item: AuctionItem, now: Date = new Date()): boolean {
  const state = getWatchState();
  if (state.items[item.id]) {
    delete state.items[item.id];
    safeWrite(WATCH_KEY, state);
    dropDiffCache(item.id);
    return false;
  }
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
  safeWrite(WATCH_KEY, state);
  return true;
}

export function removeWatch(id: string): void {
  const state = getWatchState();
  if (!(id in state.items)) return;
  delete state.items[id];
  safeWrite(WATCH_KEY, state);
  dropDiffCache(id);
}

export function setPrefs(prefs: Prefs): void {
  const state = getWatchState();
  state.prefs = prefs;
  state.onboarded = true;
  safeWrite(WATCH_KEY, state);
}

export function isOnboarded(): boolean {
  return getWatchState().onboarded === true;
}

export function markOnboarded(): void {
  const state = getWatchState();
  state.onboarded = true;
  safeWrite(WATCH_KEY, state);
}

// ---- 상태 변화 판정(원안 "추적기능", §5.5) ----
export type WatchDiff = "재유찰" | "기일 변경" | "매각 종료" | null;

/** 주간 갱신 데이터와 스냅샷 비교. current 부재 = 목록 소멸(매각 종료 등). */
export function diffWatch(snapshot: WatchSnapshot, current: AuctionItem | undefined): WatchDiff {
  if (!current) return "매각 종료";
  if (current.minPrice < snapshot.minPrice) return "재유찰";
  if (current.saleDate !== snapshot.saleDate) return "기일 변경";
  return null;
}

/** 변화 배지 표시 후 스냅샷을 현재 데이터로 갱신한다(다음 주 비교 기준). 식별 정보도 최신화한다. */
export function refreshSnapshot(id: string, current: AuctionItem): void {
  const state = getWatchState();
  const entry = state.items[id];
  if (!entry) return;
  entry.snapshot = {
    ...entry.snapshot,
    minPrice: current.minPrice,
    saleDate: current.saleDate,
    failCount: current.failCount,
    address: current.address,
    category: current.category,
  };
  safeWrite(WATCH_KEY, state);
}

// ---- 변화 배지 세션 캐시(§4.3-④ 보완) ----
// 스냅샷은 판정 직후 갱신되므로(다음 주 비교 기준) 판정 결과·이전 값을 sessionStorage에 보존해
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

export function pushRecent(id: string): void {
  const ids = getRecentIds().filter((x) => x !== id);
  ids.unshift(id);
  safeWrite(RECENT_KEY, { ids: ids.slice(0, 5) });
}
