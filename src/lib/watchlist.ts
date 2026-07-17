import type { AuctionItem } from "@/types/auction";

// 관심함·최근 본 물건·온보딩 선호 — localStorage `crazyvalue.*` (무가입 원칙, §5.5).
// 모든 localStorage 접근은 이 파일의 try-parse 단일 유틸을 경유한다(§13 규칙 5).

const WATCH_KEY = "crazyvalue.watchlist.v1";
const RECENT_KEY = "crazyvalue.recent.v1";

export interface WatchSnapshot {
  minPrice: number;
  saleDate: string;
  failCount: number;
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

/** 실패 분기 필수(§13 규칙 5): 파싱 실패·저장 불가 시 조용히 기본값으로 동작한다. */
function safeRead<T>(key: string, makeFallback: () => T): T {
  const fallback = makeFallback();
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as T) };
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
  return safeRead<WatchState>(WATCH_KEY, emptyWatch);
}

export function isWatched(id: string): boolean {
  return id in getWatchState().items;
}

export function toggleWatch(item: AuctionItem, now: Date = new Date()): boolean {
  const state = getWatchState();
  if (state.items[item.id]) {
    delete state.items[item.id];
    safeWrite(WATCH_KEY, state);
    return false;
  }
  state.items[item.id] = {
    addedAt: now.toISOString(),
    snapshot: {
      minPrice: item.minPrice,
      saleDate: item.saleDate,
      failCount: item.failCount,
    },
  };
  safeWrite(WATCH_KEY, state);
  return true;
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

/** 변화 배지 표시 후 스냅샷을 현재 데이터로 갱신한다(다음 주 비교 기준). */
export function refreshSnapshot(id: string, current: AuctionItem): void {
  const state = getWatchState();
  const entry = state.items[id];
  if (!entry) return;
  entry.snapshot = {
    minPrice: current.minPrice,
    saleDate: current.saleDate,
    failCount: current.failCount,
  };
  safeWrite(WATCH_KEY, state);
}

// ---- 최근 본 물건(최대 5건, §4.3-① 8) ----
export function getRecentIds(): string[] {
  return safeRead<RecentState>(RECENT_KEY, () => ({ ids: [] })).ids.slice(0, 5);
}

export function pushRecent(id: string): void {
  const ids = getRecentIds().filter((x) => x !== id);
  ids.unshift(id);
  safeWrite(RECENT_KEY, { ids: ids.slice(0, 5) });
}
