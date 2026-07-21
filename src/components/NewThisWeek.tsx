import type { AuctionItem } from "@/types/auction";
import { ItemCard } from "@/components/ItemCard";

// 이번 주 신규(§4.3-① 7): 이번 갱신에서 새로 유찰 2회가 된 물건 수 + 대표 3건 가로 스크롤.
export function NewThisWeek({ items }: { items: AuctionItem[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label="이번 주 신규">
      <h2 className="text-[13px] font-semibold text-ink/70">
        이번 주 신규 <span className="tabular-nums text-accent">{items.length}건</span>
        <span className="font-normal text-ink/70"> — 새로 유찰 2회가 된 물건</span>
      </h2>
      <div className="-mx-4 mt-2 flex gap-3 overflow-x-auto px-4 pb-1">
        {items.slice(0, 3).map((i) => (
          <ItemCard key={i.id} item={i} compact />
        ))}
      </div>
    </section>
  );
}
