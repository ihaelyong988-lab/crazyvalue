"use client";

import { useEffect, useRef, useState } from "react";
import { formatDateKr, seoulDateTime } from "@/lib/format";
import { useMeta } from "@/lib/use-meta";

// 기준일 바의 클라이언트 부분 — 값이 아니라 "알림"만 맡는다.
// 기준일 자체는 DataDateBar가 빌드 산출물에서 서버 렌더한다(build-meta.ts 참조).
// 여기서 하는 일은 둘뿐이다: 형식 오류 제외 건수 고지 · 새 배포가 나왔음을 알리고 새로고침 동선 제공.

/** 새 배포 확인 간격 하한 — 갱신은 새벽 1회뿐이라 화면 전환마다 다시 물을 이유가 없다. */
const CHECK_MIN_MS = 5 * 60_000;

export function DataDateNotice({ baked }: { baked: string }) {
  const { dropped } = useMeta();
  const [newer, setNewer] = useState<string | null>(null);
  const lastCheckedAt = useRef(0);

  useEffect(() => {
    const bakedMs = Date.parse(baked);
    let alive = true;

    const check = async () => {
      if (!alive || document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastCheckedAt.current < CHECK_MIN_MS) return;
      lastCheckedAt.current = now;
      try {
        const res = await fetch("/data/meta.json", { cache: "no-store" });
        if (!res.ok) return;
        const json: unknown = await res.json();
        const at = (json as { crawledAt?: unknown }).crawledAt;
        if (typeof at !== "string") return;
        const ms = Date.parse(at);
        // "다르다"가 아니라 "더 새롭다"일 때만 알린다. 서비스워커가 옛 캐시를 돌려줘도
        // 거짓 안내가 뜨지 않는다 — 2026-08-09 고착 사고의 반대편 실패를 미리 막는다.
        if (alive && Number.isFinite(ms) && Number.isFinite(bakedMs) && ms > bakedMs) setNewer(at);
      } catch {
        // 조용히 넘긴다. 화면의 기준일은 이미 HTML에 구워져 있어 이 확인이 실패해도 거짓이 되지 않는다.
      }
    };

    void check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
    };
  }, [baked]);

  const newerDate = newer ? (seoulDateTime(newer)?.date ?? null) : null;

  // 비어 있어도 유지해야 삽입 시점에 낭독된다.
  return (
    <div role="status">
      {dropped > 0 && <p className="mt-0.5">형식 오류 {dropped}건 제외</p>}
      {newerDate && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-1 flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-white/40 px-3 text-left text-white transition-colors duration-200 hover:bg-white/10"
        >
          <span>새 기준일 {formatDateKr(newerDate)} 공개</span>
          <span className="font-semibold">새로고침</span>
        </button>
      )}
    </div>
  );
}
