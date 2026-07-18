"use client";

// 빈 상태 — 검색 실패를 다음 행동으로 전환(§4.4-11).
export function EmptyState({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: { label: string; onClick: () => void }[];
}) {
  return (
    <div className="m-4 rounded-xl border border-line bg-white p-6 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 text-[13px] text-ink/70">{description}</p>}
      {actions && actions.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              className="min-h-11 cursor-pointer rounded-lg border border-line bg-paper px-4 font-medium text-ink transition-colors duration-200 hover:bg-line/50"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
