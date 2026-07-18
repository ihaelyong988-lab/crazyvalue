"use client";

import { useEffect } from "react";
import { pushRecent } from "@/lib/watchlist";

// 최근 본 물건 기록(§4.4-18) — 렌더 없음, 열람 사실만 저장.
export function RecentTracker({ id }: { id: string }) {
  useEffect(() => {
    pushRecent(id);
  }, [id]);
  return null;
}
