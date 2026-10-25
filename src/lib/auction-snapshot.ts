import type { AuctionItem, Meta } from "@/types/auction";
import { REGIONS } from "@/types/catalog";
import { isValidAuctionItem } from "@/lib/data";

/** 서버 상세와 클라이언트 목록은 같은 행을 보존한다. 파일 자체 손상은 호출자가 처리한다. */
export function parseRegionItems(raw: unknown, key: string): {
  items: AuctionItem[];
  dropped: number;
  rawCount: number;
} {
  if (!Array.isArray(raw)) throw new Error(`/data/${key}.json 형식 오류`);
  const items = raw.filter(isValidAuctionItem);
  return { items, dropped: raw.length - items.length, rawCount: raw.length };
}

export class SnapshotMismatchError extends Error {
  constructor() {
    super("물건 파일과 기준 정보가 일치하지 않음");
    this.name = "SnapshotMismatchError";
  }
}

/** 손상 행 제외 전 원본 수를 비교한다 — 정상적인 행 단위 제외를 버전 오류로 오인하지 않는다. */
export function assertRegionCounts(meta: Meta, counts: readonly number[]): void {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (
    counts.length !== REGIONS.length ||
    total !== meta.totalCount ||
    Object.values(meta.countsByRegion).reduce((sum, count) => sum + count, 0) !== meta.totalCount ||
    // 구형 meta는 0건 지역 키를 생략할 수 있다 — 실제 파일도 0건일 때만 같은 값이다.
    REGIONS.some((region, i) => (meta.countsByRegion[region.key] ?? 0) !== counts[i])
  ) throw new SnapshotMismatchError();
}

/** 동일 시각의 ISO 오프셋 표현 차이는 허용하되 알려진 건수 차이는 버전 변경으로 취급한다. */
export function sameSnapshot(before: Meta, after: Meta): boolean {
  const keys = new Set([...Object.keys(before.countsByRegion), ...Object.keys(after.countsByRegion)]);
  return Date.parse(before.crawledAt) === Date.parse(after.crawledAt) &&
    before.totalCount === after.totalCount &&
    [...keys].every((key) => (before.countsByRegion[key] ?? 0) === (after.countsByRegion[key] ?? 0));
}
