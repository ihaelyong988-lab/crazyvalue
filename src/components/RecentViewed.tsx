"use client";

import { useEffect, useState } from "react";
import type { AuctionItem } from "@/types/auction";
import { getRecentIds } from "@/lib/watchlist";
import { ItemCard } from "@/components/ItemCard";

// 최근 본 물건(§4.3-① 8): 최근 열람 5건 가로 스크롤. 없으면 미노출.
export function RecentViewed({ items }: { items: AuctionItem[] }) {
  const [recent, setRecent] = useState<AuctionItem[]>([]);
  useEffect(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    setRecent(getRecentIds().map((id) => byId.get(id)).filter((x): x is AuctionItem => !!x));
  }, [items]);
  if (recent.length === 0) return null;
  return (
    <section aria-label="최근 본 물건">
      <h2 className="text-[13px] font-semibold text-ink/70">최근 본 물건</h2>
      <div className="-mx-4 mt-2 flex gap-3 overflow-x-auto px-4 pb-1">
        {recent.map((i) => (
          <ItemCard key={i.id} item={i} compact />
        ))}
      </div>
    </section>
  );
}
