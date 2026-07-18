"use client";

// 공통 선택 칩 — 상태는 배경+글자색+aria-pressed로 병행 전달, 터치 ≥44px.
export function FilterChip({
  label,
  selected,
  onToggle,
  count,
}: {
  label: string;
  selected: boolean;
  onToggle: () => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={`min-h-11 cursor-pointer rounded-lg border px-3 text-[14px] transition-colors duration-200 ${
        selected
          ? "border-accent bg-accent font-semibold text-white"
          : "border-line bg-white text-ink hover:bg-paper"
      }`}
    >
      {label}
      {typeof count === "number" && (
        <span className={`ml-1 tabular-nums text-[12px] ${selected ? "text-white/80" : "text-ink/50"}`}>
          {count}
        </span>
      )}
    </button>
  );
}
