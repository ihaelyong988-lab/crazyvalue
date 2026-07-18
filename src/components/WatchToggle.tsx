"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import type { AuctionItem } from "@/types/auction";
import { isWatched, toggleWatch } from "@/lib/watchlist";

// 관심등록 토글 — 상태는 색+텍스트 라벨로 병행 전달, 터치 ≥44px(§4.3-③ 액션).
export function WatchToggle({ item }: { item: AuctionItem }) {
  const [watched, setWatched] = useState(false);
  useEffect(() => {
    setWatched(isWatched(item.id));
  }, [item.id]);
  return (
    <button
      type="button"
      aria-pressed={watched}
      onClick={() => setWatched(toggleWatch(item))}
      className={`flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border font-semibold transition-colors duration-200 ${
        watched
          ? "border-accent bg-accent text-white"
          : "border-line bg-white text-ink hover:bg-paper"
      }`}
    >
      <Star size={18} aria-hidden fill={watched ? "currentColor" : "none"} />
      {watched ? "관심등록됨" : "관심등록"}
    </button>
  );
}
