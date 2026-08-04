"use client";

import { useEffect, useState } from "react";
import type { AuctionItem } from "@/types/auction";
import { SORT_OPTIONS, type SortKey } from "@/lib/data";
import { ItemCard } from "@/components/ItemCard";
import { EmptyState } from "@/components/EmptyState";

// 리스트(§4.3-②): 10건 단위 + 명시적 더보기(무한 스크롤 금지), 정렬 4종, 빈 상태 완화 제안.

// 더보기 직후 삽입분을 포인터 히트테스트에서 제외하는 시간(감사 2차 54). 새 카드가 버튼 위에 삽입되면
// 버튼이 그만큼 아래로 밀려, 빠른 두 번째 탭이 그 자리에 새로 온 카드에 적중해 엉뚱한 상세로 이탈한다.
// 삽입분만 잠깐 무반응으로 두면 셸로우 URL 갱신 구조(감사 29)·레이아웃·스크롤 위치를 그대로 두고
// 오적중만 사라진다. 포인터 전용이라 포커스·키보드 조작에는 영향이 없다.
const INSERT_GUARD_MS = 400;

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
  // 이번 더보기로 삽입된 카드의 시작 인덱스(= 더보기 직전 표시 건수). null이면 차단 없음.
  const [guardFrom, setGuardFrom] = useState<number | null>(null);
  // 차단 창은 삽입이 실제로 렌더된 시점부터 잰다 — shown이 아직 늘지 않았으면 시작하지 않는다.
  useEffect(() => {
    if (guardFrom === null || shown <= guardFrom) return;
    const timer = setTimeout(() => setGuardFrom(null), INSERT_GUARD_MS);
    return () => clearTimeout(timer);
  }, [guardFrom, shown]);

  if (items.length === 0) {
    return (
      <EmptyState
        title="조건에 맞는 물건이 없습니다"
        description={
          relaxActions.length > 0
            ? "아래 버튼으로 조건을 해제하면 결과 범위가 넓어집니다."
            : "데이터는 매일 03:00 갱신됩니다."
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
        {visible.map((i, idx) => (
          <li
            key={i.id}
            className={
              guardFrom !== null && idx >= guardFrom ? "pointer-events-none" : undefined
            }
          >
            <ItemCard item={i} />
          </li>
        ))}
      </ul>
      {shown < items.length && (
        <button
          type="button"
          onClick={() => {
            setGuardFrom(shown);
            onMore();
          }}
          className="mt-4 min-h-12 w-full cursor-pointer rounded-xl border border-line bg-white font-semibold text-ink transition-colors duration-200 hover:bg-paper"
        >
          {/* 카운트 ink/70 — 흰 버튼 위 대비 4.5:1 확보(감사 2차 83) */}
          더보기 <span className="tabular-nums text-ink/70">({shown}/{items.length})</span>
        </button>
      )}
    </div>
  );
}
