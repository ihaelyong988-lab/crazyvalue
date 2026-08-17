"use client";

import { useEffect, useState } from "react";
import type { AuctionItem } from "@/types/auction";
import { presentRecent } from "@/components/ExitGuard";
import { ItemCard } from "@/components/ItemCard";

// 최근 본 물건(§4.3-① 8): 최근 열람 5건 가로 스크롤. 없으면 미노출.
// 무엇을 세는지는 presentRecent 하나가 정한다(감사 3차 99) — 이 섹션과 이탈 시트가 기준을 따로 두면
// 갱신에서 내려간 물건 때문에 한쪽은 0건, 다른 쪽은 1건이라고 말한다.
export function RecentViewed({ items }: { items: AuctionItem[] }) {
  const [recent, setRecent] = useState<AuctionItem[]>([]);
  useEffect(() => {
    const byId = new Map(items.map((i) => [i.id, i]));
    setRecent(presentRecent((id) => byId.get(id)));
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
