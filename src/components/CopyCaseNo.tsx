"use client";

import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { copyableCaseNo } from "@/lib/court-origin";

// 번호 복사 — 법원 원문 도달 3종(AGENTS §2-2 조문 6)의 ②. 법원 사이트는 사건 단위 딥링크가
// 없어(docs/CRAWLER.md §4.1) 방문자가 원문 화면에서 사건번호를 직접 입력해야 한다(감사 45).
// 복사 대상은 **번호 단독**이다 — 목적지 입력칸이 `maxlength="7"`에 한글을 지우므로 `2023타경104819`를
// 붙여넣으면 `20231`만 남아 검색이 실패한다(2026-08-20 실측 · `lib/court-origin.ts`). 법원·연도는
// 그 화면에서 목록으로 고르는 값이라 함께 붙이면 입력칸을 오염시킨다.
// 실패 처리: 취소(AbortError)만 무시 · 실패 라벨은 복구될 때까지 유지 · 텍스트 폴백을 role="alert"로 통지.
type CopyState = "idle" | "copied" | "failed";

const LABELS: Record<CopyState, string> = {
  idle: "번호 복사",
  copied: "복사됨",
  failed: "복사 실패",
};

export function CopyCaseNo({ caseNo }: { caseNo: string }) {
  const value = copyableCaseNo(caseNo);
  const [state, setState] = useState<CopyState>("idle");
  const [fallback, setFallback] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  function flash(next: CopyState) {
    setState(next);
    clearTimeout(timerRef.current);
    // 실패는 자동 복귀시키지 않는다 — 라벨만 idle("번호 복사")로 돌아가면 폴백 문단은 남아
    // 한 화면이 "복사하면 된다"와 "복사가 실패했다" 두 상태를 동시에 말한다(감사 3차 J4).
    if (next === "failed") return;
    timerRef.current = setTimeout(() => setState("idle"), 2000);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setFallback(null);
      flash("copied");
    } catch (e) {
      // 사용자가 권한 대화를 닫은 취소(AbortError)만 정상 흐름으로 무시한다.
      if (e instanceof Error && e.name === "AbortError") return;
      setFallback(value);
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
        // role="alert" — 실패 라벨(버튼 안 aria-live)은 실패 사실만 읽어준다. 실제 복구 수단은 이 문단이라
        // 삽입 자체가 통지되지 않으면 화면을 못 보는 방문자에게는 복구 경로가 없는 것과 같다(감사 3차 J4).
        // 실패 사실은 위 버튼 라벨이 계속 말하므로 여기서는 복구 동작만 적는다(중복 표기 금지).
        <p
          role="alert"
          className="rounded-lg border border-line bg-paper p-3 text-[13px] leading-snug"
        >
          아래 번호를 선택해 직접 복사한다.
          <span className="mt-1 block select-all tabular-nums text-ink/70">{fallback}</span>
        </p>
      )}
    </>
  );
}
