import type { HistoryEntry } from "@/types/auction";
import { formatDateKr, formatKrw } from "@/lib/format";

// 유찰 이력 타임라인 — "왜 이 가격인가"의 근거. 본 앱의 시그니처 블록(§4.3-③).
export function HistoryTimeline({ history }: { history: HistoryEntry[] }) {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <section aria-label="기일 이력" className="rounded-xl border border-line bg-white p-4">
      <h2 className="text-[13px] font-semibold text-ink/70">
        유찰 이력 — 회차별 최저가 흐름
      </h2>
      <ol className="mt-3 space-y-0">
        {sorted.map((h, i) => {
          const last = i === sorted.length - 1;
          return (
            <li key={`${h.date}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
              <span className="flex flex-col items-center">
                <span
                  aria-hidden
                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                    h.result === "유찰" ? "bg-accent" : "border border-ink/40 bg-white"
                  }`}
                />
                {!last && <span aria-hidden className="w-px flex-1 bg-line" />}
              </span>
              <div className="flex flex-1 items-baseline justify-between gap-2 text-[13px]">
                <span className="tabular-nums text-ink/70">{formatDateKr(h.date)}</span>
                <span className="tabular-nums font-medium">{formatKrw(h.minPrice)}</span>
                <span
                  className={
                    h.result === "유찰"
                      ? "font-semibold text-accent"
                      : "text-ink/60"
                  }
                >
                  {h.result}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
