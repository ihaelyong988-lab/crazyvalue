"use client";

// 오류 상태 — 조용한 실패 금지(§13 규칙 5). 원인 1문장 + 다음 행동 1문장 + 복구 동작.
export function ErrorState({
  message = "데이터를 불러오지 못했다.",
  action = "네트워크 상태를 확인한 뒤 다시 시도하라.",
  onRetry,
}: {
  message?: string;
  action?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="m-4 rounded-xl border border-line bg-white p-5 text-center">
      <p className="font-semibold text-ink">{message}</p>
      <p className="mt-1 text-[13px] text-ink/70">{action}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 min-h-11 w-full cursor-pointer rounded-lg bg-accent px-4 font-semibold text-white transition-colors duration-200 hover:bg-accent/90"
        >
          다시 시도
        </button>
      )}
    </div>
  );
}
