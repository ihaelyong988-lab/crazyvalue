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
  relaxActions,
}: {
  items: AuctionItem[];
  shown: number;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  onMore: () => void;
  /** 빈 결과 완화 제안 — 실제 적용 중인 조건의 해제 동작만 담는다(감사 25·26: 무동작 버튼 금지). */
  relaxActions: { label: string; onClick: () => void }[];
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="조건에 맞는 물건이 없습니다"
        description={
          relaxActions.length > 0
            ? "아래 버튼으로 조건을 해제하면 결과 범위가 넓어집니다."
            : "데이터는 매주 일요일 갱신됩니다."
        }
        actions={relaxActions}
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
          {/* 글꼴 16px(감사 7) — iOS는 포커스된 폼 컨트롤이 16px 미만이면 화면을 강제 확대한다. */}
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value as SortKey)}
            className="min-h-11 cursor-pointer rounded-lg border border-line bg-white px-2 text-[16px] text-ink"
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
