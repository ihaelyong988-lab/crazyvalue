import type { AuctionItem, Meta } from "@/types/auction";
import { isValidDateOnly, seoulDateTime, shiftDays } from "@/lib/format";

/** 옛 meta에 경계가 없을 때만 쓰는 기존 7일 정책이다. 오늘 날짜로 창을 이동시키지 않는다. */
const LEGACY_OUTPUT_WINDOW_DAYS = 7;

export interface OutputPeriod {
  /** 수집 때의 우선 배분 창. 화면의 마지막 날은 포함 경계로 변환한 값이다. */
  window: { start: string; last: string } | null;
  /** 실제 게시된 물건의 기일 분포다. 원천 조회 범위나 모든 날의 자료 존재를 뜻하지 않는다. */
  posted: { first: string; last: string } | null;
  outsideWindow: boolean;
}

function readWindow(value: unknown): OutputPeriod["window"] {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    v.endInclusive !== false ||
    !isValidDateOnly(v.start) ||
    !isValidDateOnly(v.end) ||
    v.end <= v.start
  ) return null;
  const last = shiftDays(v.end, -1);
  return last ? { start: v.start, last } : null;
}

function readPosted(value: unknown): OutputPeriod["posted"] {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!isValidDateOnly(v.first) || !isValidDateOnly(v.last) || v.last < v.first) return null;
  return { first: v.first, last: v.last };
}

/**
 * 게시된 전 지역 물건을 넘기면 메타보다 실제 로드 결과를 우선한다. 필터 결과만 넘기면
 * 빈 지역 선택 때 범위까지 사라지므로 호출부는 필터 적용 전 자료를 사용한다.
 */
export function resolveOutputPeriod(
  meta: Meta | null,
  items?: readonly Pick<AuctionItem, "saleDate">[],
): OutputPeriod | null {
  let window = readWindow(meta?.outputWindow);
  if (!window && meta) {
    const start = seoulDateTime(meta.crawledAt)?.date;
    const last = start ? shiftDays(start, LEGACY_OUTPUT_WINDOW_DAYS - 1) : null;
    if (start && last) window = { start, last };
  }

  let posted = items === undefined ? readPosted(meta?.outputSaleDateRange) : null;
  if (items) {
    for (const item of items) {
      if (!isValidDateOnly(item.saleDate)) continue;
      if (!posted) posted = { first: item.saleDate, last: item.saleDate };
      else {
        if (item.saleDate < posted.first) posted.first = item.saleDate;
        if (item.saleDate > posted.last) posted.last = item.saleDate;
      }
    }
  }
  if (!window && !posted) return null;
  const outsideWindow = !!(
    window && posted && (posted.first < window.start || posted.last > window.last)
  );
  return { window, posted, outsideWindow };
}

const rangeLabel = (first: string, last: string) => first === last ? first : `${first}~${last}`;

export function outputPeriodLabel(period: OutputPeriod): string {
  const { window, posted, outsideWindow } = period;
  if (!window && posted) {
    return `게시 물건 기일 ${rangeLabel(posted.first, posted.last)} · 매각기일 기준, 양 끝날 포함.`;
  }
  if (!window) return "";
  if (outsideWindow && posted) {
    return `우선 제공 기간 ${rangeLabel(window.start, window.last)} · 게시 물건 기일 ${rangeLabel(posted.first, posted.last)} · 양 끝날 포함.`;
  }
  return `제공 기간 ${rangeLabel(window.start, window.last)} · 매각기일 기준, 양 끝날 포함.`;
}

export function emptyResultTitle(period: OutputPeriod | null): string {
  return period?.window && !period.outsideWindow
    ? "현재 제공 기간에 조건에 맞는 물건이 없다"
    : "현재 게시 물건에 조건에 맞는 물건이 없다";
}
