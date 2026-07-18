"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AuctionItem } from "@/types/auction";
import { dday, formatDateKr, formatKrw } from "@/lib/format";
import {
  diffWatch,
  getWatchState,
  refreshSnapshot,
  removeWatch,
  type WatchDiff,
  type WatchSnapshot,
} from "@/lib/watchlist";
import { useAuctionData } from "@/lib/use-auction-data";
import { WatchCard } from "@/components/WatchCard";
import { ListSkeleton } from "@/components/Skeleton";
import { ErrorState } from "@/components/ErrorState";
import { EmptyState } from "@/components/EmptyState";

interface Row {
  id: string;
  item: AuctionItem | null; // null = 목록 소멸
  snapshot: WatchSnapshot;
  diff: WatchDiff;
}

// ④ 관심함 — D-day 오름차순, 변화 물건 상단 고정, 상태 배지(§4.3-④).
export default function WatchPage() {
  const { status, items, retry } = useAuctionData();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (status !== "ready") return;
    const byId = new Map(items.map((i) => [i.id, i]));
    const state = getWatchState();
    const built: Row[] = Object.entries(state.items).map(([id, entry]) => {
      const current = byId.get(id);
      return {
        id,
        item: current ?? null,
        snapshot: entry.snapshot,
        diff: diffWatch(entry.snapshot, current),
      };
    });
    // 정렬: 변화 있는 물건 상단 고정 → D-day 오름차순
    built.sort((a, b) => {
      const chA = a.diff ? 0 : 1;
      const chB = b.diff ? 0 : 1;
      if (chA !== chB) return chA - chB;
      const dA = dday((a.item ?? a.snapshot).saleDate);
      const dB = dday((b.item ?? b.snapshot).saleDate);
      return dA - dB;
    });
    setRows(built);
    // 배지 표시 후 스냅샷 갱신(§5.5) — 다음 방문의 비교 기준
    for (const r of built) if (r.item && r.diff) refreshSnapshot(r.id, r.item);
  }, [status, items]);

  if (status === "loading" || (status === "ready" && rows === null)) return <ListSkeleton />;
  if (status === "error")
    return (
      <ErrorState
        message="물건 데이터를 불러오지 못했다."
        action="네트워크 상태를 확인한 뒤 다시 시도하라."
        onRetry={retry}
      />
    );
  if (!rows || rows.length === 0)
    return (
      <div className="p-4">
        <EmptyState
          title="관심 물건이 아직 없습니다"
          description="상세 화면에서 관심등록을 누르면 여기에서 기일과 재유찰을 추적합니다."
        />
        <Link
          href="/"
          className="mx-4 flex min-h-12 cursor-pointer items-center justify-center rounded-xl bg-accent font-semibold text-white transition-colors duration-200 hover:bg-accent/90"
        >
          물건 찾으러 가기
        </Link>
      </div>
    );

  return (
    <div className="space-y-3 p-4">
      <p className="text-[12px] text-ink/60">
        관심함은 이 기기에만 저장됩니다. 기기를 바꾸면 이전되지 않습니다.
      </p>
      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.id}>
            {r.item ? (
              <WatchCard item={r.item} diff={r.diff} />
            ) : (
              <div className="rounded-xl border border-line bg-white p-4">
                <span className="rounded bg-ink/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                  매각 종료
                </span>
                <p className="mt-2 text-[13px] text-ink/70">
                  이번 갱신 목록에서 빠진 물건입니다(매각·취하 등). 마지막 확인:
                  최저가 <span className="tabular-nums">{formatKrw(r.snapshot.minPrice)}</span> ·
                  기일 <span className="tabular-nums">{formatDateKr(r.snapshot.saleDate)}</span>
                </p>
                <button
                  type="button"
                  onClick={() => {
                    removeWatch(r.id);
                    setRows((prev) => (prev ? prev.filter((x) => x.id !== r.id) : prev));
                  }}
                  className="mt-3 min-h-11 w-full cursor-pointer rounded-lg border border-line bg-paper text-[13px] font-medium transition-colors duration-200 hover:bg-line/50"
                >
                  관심함에서 제거
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
