"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AuctionItem } from "@/types/auction";
import { regionNameByKey } from "@/types/catalog";
import { dday, formatDateKr, formatKrw } from "@/lib/format";
import {
  diffWatch,
  getWatchState,
  readDiffCache,
  refreshSnapshot,
  removeWatch,
  writeDiffCache,
  type WatchDiff,
  type WatchSnapshot,
} from "@/lib/watchlist";
import { useAuctionData } from "@/lib/use-auction-data";
import { WatchCard, type WatchPrev } from "@/components/WatchCard";
import { ListSkeleton } from "@/components/Skeleton";
import { ErrorState } from "@/components/ErrorState";
import { EmptyState } from "@/components/EmptyState";

interface Row {
  id: string;
  item: AuctionItem | null; // null = 목록 소멸
  snapshot: WatchSnapshot;
  diff: WatchDiff;
  prev: WatchPrev | null; // 변화 판정 당시의 이전 값(배지 요약 표기용)
}

/** id("{지역key}-{사건번호}-{물건번호}") → "서울 · 2025타경36267(2)" — 종료 카드·제거 버튼 식별 표기 */
function watchIdLabel(id: string): string {
  const first = id.indexOf("-");
  const last = id.lastIndexOf("-");
  if (first < 0 || last <= first) return id;
  const region = regionNameByKey[id.slice(0, first)] ?? id.slice(0, first);
  return `${region} · ${id.slice(first + 1, last)}(${id.slice(last + 1)})`;
}

// ④ 관심함 — D-day 오름차순, 변화 물건 상단 고정, 상태 배지(§4.3-④).
export default function WatchPage() {
  const { status, items, retry } = useAuctionData();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (status !== "ready") return;
    const byId = new Map(items.map((i) => [i.id, i]));
    const state = getWatchState();
    // 스냅샷은 판정 직후 갱신되므로, 같은 방문 동안 배지·상단 고정을 재현할 근거는 세션 캐시에 둔다.
    const cache = readDiffCache();
    let cacheDirty = false;
    const refreshTargets: { id: string; item: AuctionItem }[] = [];
    const built: Row[] = Object.entries(state.items).map(([id, entry]) => {
      const current = byId.get(id);
      const fresh = diffWatch(entry.snapshot, current);
      let diff: WatchDiff = fresh;
      let prev: WatchPrev | null =
        fresh !== null
          ? { minPrice: entry.snapshot.minPrice, saleDate: entry.snapshot.saleDate }
          : null;
      if (fresh !== null && current) {
        cache[id] = {
          diff: fresh,
          prevMinPrice: entry.snapshot.minPrice,
          prevSaleDate: entry.snapshot.saleDate,
        };
        cacheDirty = true;
        refreshTargets.push({ id, item: current });
      } else if (fresh === null) {
        const kept = cache[id];
        if (kept && kept.diff !== "매각 종료") {
          diff = kept.diff;
          prev = { minPrice: kept.prevMinPrice, saleDate: kept.prevSaleDate };
        }
      }
      return { id, item: current ?? null, snapshot: entry.snapshot, diff, prev };
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
    if (cacheDirty) writeDiffCache(cache);
    // 배지 표시 후 스냅샷 갱신(§5.5) — 다음 방문의 비교 기준. 이번 방문 표시는 세션 캐시가 담당한다.
    for (const t of refreshTargets) refreshSnapshot(t.id, t.item);
  }, [status, items]);

  const handleRemove = useCallback((id: string) => {
    removeWatch(id);
    setRows((current) => (current ? current.filter((x) => x.id !== id) : current));
  }, []);

  if (status === "loading" || (status === "ready" && rows === null)) return <ListSkeleton />;
  if (status === "error")
    return (
      <ErrorState
        message="물건 데이터를 불러오지 못했습니다."
        action="네트워크 상태를 확인한 뒤 다시 시도하세요."
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
      <p className="text-[12px] text-ink/70">
        관심함은 이 기기에만 저장, 기기 변경 시 이전되지 않음.
      </p>
      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.id}>
            {r.item ? (
              <WatchCard item={r.item} diff={r.diff} prev={r.prev} onRemove={handleRemove} />
            ) : (
              <div className="rounded-xl border border-line bg-white p-4">
                <span className="rounded bg-ink/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                  매각 종료
                </span>
                <p className="mt-2 text-[13px] font-semibold tabular-nums">{watchIdLabel(r.id)}</p>
                {(r.snapshot.address || r.snapshot.category) && (
                  <p className="mt-0.5 truncate text-[12px] text-ink/70">
                    {[r.snapshot.address, r.snapshot.category].filter(Boolean).join(" · ")}
                  </p>
                )}
                <p className="mt-2 text-[13px] text-ink/70">
                  이번 갱신 목록에서 빠진 물건입니다(매각·취하 등). 마지막 확인:
                  최저가 <span className="tabular-nums">{formatKrw(r.snapshot.minPrice)}</span> ·
                  기일 <span className="tabular-nums">{formatDateKr(r.snapshot.saleDate)}</span>
                </p>
                <button
                  type="button"
                  onClick={() => handleRemove(r.id)}
                  aria-label={`관심함에서 제거: ${watchIdLabel(r.id)}`}
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
