"use client";

import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";

// 사건번호 복사 — 법원 원문 도달 3종(AGENTS §2-2 조문 6)의 ②. 법원 사이트는 사건 단위 딥링크가
// 없어(docs/CRAWLER.md §4.1) 방문자가 원문 화면에서 사건번호를 직접 입력해야 한다(감사 45).
// 복사 대상은 사건번호 단독 — 법원은 원문 화면에서 목록으로 고르는 값이라 함께 붙이면 입력칸을 오염시킨다.
// 실패 처리는 ShareButton과 같은 규격: 취소(AbortError)만 무시 · 실패 라벨 aria-live · 텍스트 폴백.
type CopyState = "idle" | "copied" | "failed";

const LABELS: Record<CopyState, string> = {
  idle: "사건번호 복사",
  copied: "복사됨",
  failed: "복사 실패",
};

export function CopyCaseNo({ caseNo }: { caseNo: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const [fallback, setFallback] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  function flash(next: CopyState) {
    setState(next);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState("idle"), 2000);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(caseNo);
      setFallback(null);
      flash("copied");
    } catch (e) {
      // 사용자가 권한 대화를 닫은 취소(AbortError)만 정상 흐름으로 무시한다.
      if (e instanceof Error && e.name === "AbortError") return;
      setFallback(caseNo);
      flash("failed");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-line bg-white font-semibold text-ink transition-colors duration-200 hover:bg-paper"
      >
        <Copy size={17} aria-hidden />
        <span aria-live="polite">{LABELS[state]}</span>
      </button>
      {fallback && (
        <p className="rounded-lg border border-line bg-paper p-3 text-[13px] leading-snug">
          자동 복사 실패 — 아래 사건번호를 선택해 직접 복사한다.
          <span className="mt-1 block select-all tabular-nums text-ink/70">{fallback}</span>
        </p>
      )}
    </>
  );
}
