"use client";

import { useEffect, useRef, useState } from "react";
import { Share2 } from "lucide-react";

// 공유 — Web Share API 우선, 미지원 시 URL 복사(§4.4-15). 결과는 텍스트로 안내.
// 실패 처리(감사 #27): 공유 시트 취소(AbortError)만 조용히 무시하고, 클립보드 차단 등
// 실제 실패는 라벨 2초 표시 + URL을 선택 가능한 텍스트로 폴백 노출한다.
type ShareState = "idle" | "copied" | "failed";

const LABELS: Record<ShareState, string> = {
  idle: "공유",
  copied: "링크 복사됨",
  failed: "복사 실패",
};

export function ShareButton({ title }: { title: string }) {
  const [state, setState] = useState<ShareState>("idle");
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  function flash(next: ShareState) {
    setState(next);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState("idle"), 2000);
  }

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setFallbackUrl(null);
      flash("copied");
    } catch (e) {
      // 사용자가 공유 시트를 닫은 취소(AbortError)만 정상 흐름으로 무시한다.
      if (e instanceof Error && e.name === "AbortError") return;
      setFallbackUrl(url);
      flash("failed");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={share}
        className="flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line bg-white font-semibold text-ink transition-colors duration-200 hover:bg-paper"
      >
        <Share2 size={18} aria-hidden />
        <span aria-live="polite">{LABELS[state]}</span>
      </button>
      {fallbackUrl && (
        <p className="basis-full rounded-lg border border-line bg-paper p-3 text-[13px]">
          자동 복사 실패, 아래 주소를 선택해 직접 복사하라.
          <span className="mt-1 block select-all break-all text-ink/70">{fallbackUrl}</span>
        </p>
      )}
    </>
  );
}
