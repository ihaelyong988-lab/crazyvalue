"use client";

import { useEffect, useState } from "react";
import type { AuctionItem } from "@/types/auction";
import { dday, formatDateKr, formatDday, todaySeoul } from "@/lib/format";
import { HistoryTimeline } from "@/components/HistoryTimeline";

// 정적 HTML과 첫 렌더는 같은 날짜를 쓰고, 마운트·복귀·자정 이후 현재 KST 날짜로 회복한다.
function useCurrentDate(initialToday: string): string {
  const [today, setToday] = useState(initialToday);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === "visible") setToday(todaySeoul());
    };
    update();
    const timer = setInterval(update, 60_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return today;
}

export function ItemSchedule({ saleDate, saleTime, courtRoom, initialToday }: {
  saleDate: string;
  saleTime: string;
  courtRoom: string;
  initialToday: string;
}) {
  const days = dday(saleDate, useCurrentDate(initialToday));
  return (
    <section aria-label="기일 정보" className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] text-ink/70">매각기일</span>
        <span className="tabular-nums font-semibold">{formatDateKr(saleDate)} {saleTime}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <span className="text-[13px] text-ink/70">남은 기간</span>
        <span className={`tabular-nums font-bold ${days >= 0 && days <= 7 ? "text-accent" : ""}`}>
          {formatDday(days)}
        </span>
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <span className="text-[13px] text-ink/70">장소</span>
        <span>{courtRoom}</span>
      </div>
    </section>
  );
}

export function ItemHistory({ initialToday, ...props }: Pick<AuctionItem, "history" | "saleDate" | "minPrice" | "historySource"> & { initialToday: string }) {
  const days = dday(props.saleDate, useCurrentDate(initialToday));
  return <HistoryTimeline {...props} days={days} />;
}
