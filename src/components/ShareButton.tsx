"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";

// 공유 — Web Share API 우선, 미지원 시 URL 복사(§4.4-15). 결과는 텍스트로 안내.
export function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 사용자가 공유 시트를 닫은 경우 등 — 실패를 조용히 흡수(기능 저하 없음)
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className="flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-line bg-white font-semibold text-ink transition-colors duration-200 hover:bg-paper"
    >
      <Share2 size={18} aria-hidden />
      <span aria-live="polite">{copied ? "링크 복사됨" : "공유"}</span>
    </button>
  );
}
