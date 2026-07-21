import Link from "next/link";
import type { AuctionItem } from "@/types/auction";
import type { WatchDiff } from "@/lib/watchlist";
import { dday, formatDateKr, formatDday, formatKrw } from "@/lib/format";
import { ItemCard } from "@/components/ItemCard";

// 관심함 카드(§4.3-④): 상태 변화 배지(재유찰·기일 변경)에 이전→현재 값을 병기한다.
// 변화 카드는 접근 링크를 오버레이 1개로 통합한다 — 상태·요약이 링크 접근 이름에 포함되고,
// 내부 ItemCard 링크는 inert 처리로 초점·보조기술 탐색에서 제외된다(이름 누락·이중 탭 정지 방지).
// "기일 경과"는 ItemCard의 D-day 슬롯 1곳에만 표기한다(중복 제거).
// 제거 버튼은 전 카드에 대칭 노출한다(감사 58) — 기일이 남은 카드만 상세 왕복을 강요하지 않는다.
// 배지 날짜는 formatDateKr 단일 경유(감사 62) — 카드·상세와 같은 요일 병기 표기를 쓴다.

export interface WatchPrev {
  minPrice: number;
  saleDate: string;
}

export function WatchCard({
  item,
  diff,
  prev,
  onRemove,
}: {
  item: AuctionItem;
  diff: WatchDiff;
  prev: WatchPrev | null;
  onRemove: (id: string) => void;
}) {
  const days = dday(item.saleDate);
  const changed = diff === "재유찰" || diff === "기일 변경";
  const summary =
    diff === "재유찰" && prev
      ? `${formatKrw(prev.minPrice)}→${formatKrw(item.minPrice)}`
      : diff === "기일 변경" && prev
        ? `${formatDateKr(prev.saleDate)}→${formatDateKr(item.saleDate)}`
        : null;
  const statusLabel = diff === null ? "" : summary ? `${diff} · ${summary}` : diff;
  return (
    <div>
      {changed && (
        <div className="mb-1 flex flex-wrap gap-1.5" aria-hidden="true">
          <span className="rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white">
            {statusLabel}
          </span>
        </div>
      )}
      <div className="relative">
        {changed && (
          <Link
            href={`/item/${item.id}`}
            className="absolute inset-0 z-10 cursor-pointer rounded-xl"
          >
            <span className="sr-only">
              {[
                statusLabel,
                item.category,
                `${item.region} ${item.district}`,
                `최저가 ${formatKrw(item.minPrice)}`,
                `유찰 ${item.failCount}회`,
                formatDday(days),
              ].join(" · ")}
            </span>
          </Link>
        )}
        <div inert={changed}>
          <ItemCard item={item} />
        </div>
      </div>
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        aria-label={`관심함에서 제거: ${item.region} · ${item.caseNo}(${item.itemNo})`}
        className="mt-2 min-h-11 w-full cursor-pointer rounded-lg border border-line bg-white text-[13px] font-medium transition-colors duration-200 hover:bg-line/50"
      >
        관심함에서 제거
      </button>
    </div>
  );
}
