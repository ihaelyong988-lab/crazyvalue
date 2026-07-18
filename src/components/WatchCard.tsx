import type { AuctionItem } from "@/types/auction";
import type { WatchDiff } from "@/lib/watchlist";
import { dday } from "@/lib/format";
import { ItemCard } from "@/components/ItemCard";

// 관심함 카드(§4.3-④): 상태 변화 배지(재유찰·기일 변경·매각 종료) + 기일 경과 처리.
export function WatchCard({ item, diff }: { item: AuctionItem; diff: WatchDiff }) {
  const expired = dday(item.saleDate) < 0;
  return (
    <div className="relative">
      {(diff || expired) && (
        <div className="mb-1 flex gap-1.5">
          {diff && (
            <span className="rounded bg-accent px-1.5 py-0.5 text-[11px] font-semibold text-white">
              {diff}
            </span>
          )}
          {expired && (
            <span className="rounded bg-ink/70 px-1.5 py-0.5 text-[11px] font-semibold text-white">
              기일 경과
            </span>
          )}
        </div>
      )}
      <ItemCard item={item} />
    </div>
  );
}
