"use client";

import { ErrorState } from "@/components/ErrorState";

// 전역 오류 경계(감사 #2) — 빈 화면 금지(§13 규칙 5). 루트 레이아웃의 앱 셸(헤더·기준일
// 바·하단 탭)은 유지한 채 화면 영역만 한국어 안내로 대체하고, 다시 시도·홈 동선을 제공한다.
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div>
      <ErrorState
        message="화면을 표시하지 못했다."
        action="다시 시도를 누르고, 반복되면 홈으로 이동하라."
        onRetry={reset}
      />
      {/* 클라이언트 런타임이 예외 상태일 수 있어 Link(소프트 내비게이션) 대신
          전체 문서 로드로 확실히 복구한다 — 오류 화면 한정 의도적 예외. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        className="mx-4 flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-line bg-white font-medium text-ink transition-colors duration-200 hover:bg-paper"
      >
        홈으로 이동
      </a>
      {error.digest && (
        <p className="mt-3 text-center text-[12px] tabular-nums text-ink/70">
          오류 코드: {error.digest}
        </p>
      )}
    </div>
  );
}
