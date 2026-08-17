"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

/** 제거 되돌리기 창(ms). 창이 닫히는 순간 저장소에 확정한다. */
const UNDO_WINDOW_MS = 8000;

/** id("{지역key}-{사건번호}-{물건번호}") → "서울 · 2025타경36267(2)" — 종료 카드·제거 버튼·되돌리기 식별 표기 */
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
  const [removed, setRemoved] = useState<{ row: Row; index: number } | null>(null);
  // 되돌리기 창이 열린 동안에는 저장소를 건드리지 않는다 — 되돌리기가 곧 "쓰기 취소"다(감사 60).
  const pendingId = useRef<string | null>(null);
  const undoTimer = useRef<number | null>(null);

  /** 되돌리기 창을 닫고 제거를 저장소에 확정한다(시간 경과·다음 제거·화면 이탈 공통 경로). */
  const commitRemoval = useCallback(() => {
    if (undoTimer.current !== null) {
      window.clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    const id = pendingId.current;
    pendingId.current = null;
    if (id !== null) removeWatch(id);
  }, []);

  useEffect(() => {
    // 화면을 떠나면(탭 이동·뒤로가기·앱 종료) 즉시 확정한다 — 되돌릴 수단이 사라진 뒤 항목이 되살아나지 않게.
    window.addEventListener("pagehide", commitRemoval);
    return () => {
      window.removeEventListener("pagehide", commitRemoval);
      commitRemoval();
    };
  }, [commitRemoval]);

  useEffect(() => {
    if (status !== "ready") return;
    const byId = new Map(items.map((i) => [i.id, i]));
    const state = getWatchState();
    // 스냅샷은 판정 직후 갱신되므로, 같은 방문 동안 배지·상단 고정을 재현할 근거는 세션 캐시에 둔다.
    const cache = readDiffCache();
    let cacheDirty = false;
    const refreshTargets: { id: string; item: AuctionItem }[] = [];
    const built: Row[] = Object.entries(state.items)
      // 되돌리기 대기 중인 항목은 저장소에 남아 있어도 화면에서는 제거된 상태다.
      .filter(([id]) => id !== pendingId.current)
      .map(([id, entry]) => {
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
    // 정렬: 기일 경과 후순위 → 변화 있는 물건 상단 고정 → D-day 오름차순.
    // 경과 후순위는 리스트 정렬(data.ts sortItems date 분기, 감사 12)과 같은 규칙이다 — 입찰 불가 물건이
    // 관심함 최상단을 차지하지 않게 하고, 구간 내부 순서는 그대로 둔다(감사 59).
    built.sort((a, b) => {
      const dA = dday((a.item ?? a.snapshot).saleDate);
      const dB = dday((b.item ?? b.snapshot).saleDate);
      const pastA = dA < 0 ? 1 : 0;
      const pastB = dB < 0 ? 1 : 0;
      if (pastA !== pastB) return pastA - pastB;
      const chA = a.diff ? 0 : 1;
      const chB = b.diff ? 0 : 1;
      if (chA !== chB) return chA - chB;
      return dA - dB;
    });
    setRows(built);
    if (cacheDirty) writeDiffCache(cache);
    // 배지 표시 후 스냅샷 갱신(§5.5) — 다음 방문의 비교 기준. 이번 방문 표시는 세션 캐시가 담당한다.
    for (const t of refreshTargets) refreshSnapshot(t.id, t.item);
  }, [status, items]);

  const handleRemove = useCallback(
    (id: string) => {
      commitRemoval(); // 직전 제거를 확정 — 되돌릴 수 있는 건 항상 마지막 1건이다
      if (!rows) return;
      const index = rows.findIndex((x) => x.id === id);
      if (index < 0) return;
      setRemoved({ row: rows[index], index });
      setRows(rows.filter((x) => x.id !== id));
      pendingId.current = id;
      undoTimer.current = window.setTimeout(() => {
        commitRemoval();
        setRemoved(null);
      }, UNDO_WINDOW_MS);
    },
    [rows, commitRemoval],
  );

  const handleUndo = useCallback(() => {
    if (!removed) return;
    if (undoTimer.current !== null) {
      window.clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    pendingId.current = null; // 저장소에 쓴 적이 없다 — 화면 상태만 되돌리면 복구 완료다
    setRows((current) => {
      const next = current ? [...current] : [];
      next.splice(Math.min(removed.index, next.length), 0, removed.row);
      return next;
    });
    setRemoved(null);
  }, [removed]);

  if (status === "loading" || (status === "ready" && rows === null)) return <ListSkeleton />;
  if (status === "error")
    return (
      <ErrorState
        message="물건 데이터를 불러오지 못했다."
        action="네트워크 상태를 확인한 뒤 다시 시도하라."
        onRetry={retry}
      />
    );
  // 빈 화면 여백은 EmptyState의 m-4 한 겹만 쓴다 — 래퍼 p-4를 겹치면 타 화면보다 32px 좁아진다(감사 61).
  if (!rows || (rows.length === 0 && removed === null))
    return (
      <div>
        <EmptyState
          title="관심 물건이 아직 없다"
          description="상세 화면에서 관심등록을 누르면 여기에서 기일과 재유찰을 추적한다."
        />
        <Link
          href="/"
          className="mx-4 flex min-h-12 cursor-pointer items-center justify-center rounded-xl bg-accent font-semibold text-white transition-colors duration-200 hover:bg-accent/90"
        >
          물건 찾으러 가기
        </Link>
      </div>
    );

  const cards = rows.map((r) => (
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
            이번 갱신 목록에서 빠진 물건이다(매각·취하 등). 마지막 확인:
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
  ));
  // 되돌리기는 제거한 자리에 그대로 둔다 — 목록 하단에서 지운 뒤 화면 밖 상단을 찾게 만들지 않는다.
  if (removed !== null) {
    const label = watchIdLabel(removed.row.id);
    cards.splice(
      Math.min(removed.index, cards.length),
      0,
      <li key="undo">
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-line bg-white pl-3"
        >
          <p className="min-w-0 flex-1 truncate text-[13px] leading-snug">
            관심함에서 제거: {label}
          </p>
          <button
            type="button"
            onClick={handleUndo}
            aria-label={`${label} 제거 되돌리기`}
            className="min-h-11 shrink-0 cursor-pointer rounded-xl px-3 text-[13px] font-semibold text-accent transition-colors duration-200 hover:bg-line/50"
          >
            되돌리기
          </button>
        </div>
      </li>,
    );
  }

  return (
    <div className="space-y-3 p-4">
      <p className="text-[12px] leading-snug text-ink/70">
        관심함은 이 기기에만 저장, 기기 변경 시 이전되지 않음.
      </p>
      <ul className="space-y-4">{cards}</ul>
    </div>
  );
}
