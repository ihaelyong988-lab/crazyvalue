"use client";

import type { AuctionItem } from "@/types/auction";
import { SORT_OPTIONS, type SortKey } from "@/lib/data";
import { ItemCard } from "@/components/ItemCard";
import { EmptyState } from "@/components/EmptyState";

// 리스트(§4.3-②): 10건 단위 + 명시적 더보기(무한 스크롤 금지), 정렬 4종, 빈 상태 완화 제안.
export function ItemList({
  items,
  shown,
  sort,
  onSortChange,
  onMore,
  onRelaxPrice,
  onRelaxRegion,
}: {
  items: AuctionItem[];
  shown: number;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  onMore: () => void;
  onRelaxPrice: () => void;
  onRelaxRegion: () => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="조건에 맞는 물건이 없습니다"
        description="조건을 넓히면 인접한 물건을 볼 수 있습니다."
        actions={[
          { label: "금액 범위 넓히기", onClick: onRelaxPrice },
          { label: "인근 지역 포함", onClick: onRelaxRegion },
        ]}
      />
    );
  }
  const visible = items.slice(0, shown);
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] tabular-nums text-ink/70">
          총 {items.length.toLocaleString("ko-KR")}건
        </p>
        <label className="flex items-center gap-1.5 text-[13px] text-ink/70">
          정렬
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value as SortKey)}
            className="min-h-11 cursor-pointer rounded-lg border border-line bg-white px-2 text-ink"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className="space-y-3">
        {visible.map((i) => (
          <li key={i.id}>
            <ItemCard item={i} />
          </li>
        ))}
      </ul>
      {shown < items.length && (
        <button
          type="button"
          onClick={onMore}
          className="mt-4 min-h-12 w-full cursor-pointer rounded-xl border border-line bg-white font-semibold text-ink transition-colors duration-200 hover:bg-paper"
        >
          더보기 <span className="tabular-nums text-ink/60">({shown}/{items.length})</span>
        </button>
      )}
    </div>
  );
}
