"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import type { AuctionItem } from "@/types/auction";
import { isWatched, subscribeWatchState, toggleWatch } from "@/lib/watchlist";

// 관심등록 토글 — 상태는 색+텍스트 라벨로 병행 전달, 터치 ≥44px(§4.3-③ 액션).
// 저장 실패 표면화(감사 2차 31): localStorage 쓰기가 실패하면 버튼 상태는 직전 값을 유지하고
// role="alert"로 실패를 알린다(성공한 척 금지, §13 규칙 5).
// 타 탭 반영(감사 2차 33): 다른 탭에서 등록·해제하면 이 화면의 버튼 상태도 따라간다.
export function WatchToggle({ item }: { item: AuctionItem }) {
  const [watched, setWatched] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const sync = () => setWatched(isWatched(item.id));
    sync();
    return subscribeWatchState(sync);
  }, [item.id]);

  const toggle = () => {
    const { watched: next, saved } = toggleWatch(item);
    setWatched(next);
    setFailed(!saved);
  };

  return (
    <>
      <button
        type="button"
        aria-pressed={watched}
        onClick={toggle}
        className={`flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border font-semibold transition-colors duration-200 ${
          watched
            ? "border-accent bg-accent text-white"
            : "border-line bg-white text-ink hover:bg-paper"
        }`}
      >
        <Star size={18} aria-hidden fill={watched ? "currentColor" : "none"} />
        {watched ? "관심등록됨" : "관심등록"}
      </button>
      {failed && (
        <p
          role="alert"
          className="basis-full rounded-lg border border-line bg-paper px-3 py-2 text-[13px] leading-snug"
        >
          이 기기에 저장하지 못했다 — 저장 공간을 확보한 뒤 다시 누르라.
        </p>
      )}
    </>
  );
}
