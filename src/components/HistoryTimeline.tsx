import type { HistoryEntry } from "@/types/auction";
import { formatDateKr, formatKrw } from "@/lib/format";

// 유찰 이력 타임라인 — "왜 이 가격인가"의 근거. 본 앱의 시그니처 블록(§4.3-③).
// 말미에 saleDate·minPrice로 파생한 "이번 회차(예정)" 행을 붙여 현재 최저가와 연결한다(감사 #20).
// days는 상세 페이지가 계산한 값을 그대로 받는다 — 같은 화면의 "남은 기간"과 단일 출처를 공유해야
// 기일 경과 물건이 "기일 경과"와 "이번 회차(예정)"를 동시에 말하지 않는다(감사 46).
// 기일이 지났거나 무효(NaN)면 예정 회차를 단정할 근거가 없어 행을 표기하지 않는다.
export function HistoryTimeline({
  history,
  saleDate,
  minPrice,
  days,
}: {
  history: HistoryEntry[];
  saleDate: string;
  minPrice: number;
  days: number;
}) {
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = days >= 0;
  return (
    <section aria-label="기일 이력" className="rounded-xl border border-line bg-white p-4">
      <h2 className="text-[13px] font-semibold text-ink/70">
        유찰 이력 — 회차별 최저가 흐름
      </h2>
      <ol className="mt-3 space-y-0">
        {sorted.map((h, i) => {
          // 다음 행(다음 회차 또는 예정 행)이 있을 때만 연결선·아래 여백을 둔다 — 예정 행을
          // 생략한 기일 경과 물건에서 선이 허공으로 이어지지 않게 한다.
          const hasNext = upcoming || i < sorted.length - 1;
          return (
            <li key={`${h.date}-${i}`} className={`relative flex gap-3 ${hasNext ? "pb-4" : ""}`}>
              <span className="flex flex-col items-center">
                <span
                  aria-hidden
                  className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                    h.result === "유찰" ? "bg-accent" : "border border-ink/40 bg-white"
                  }`}
                />
                {hasNext && <span aria-hidden className="w-px flex-1 bg-line" />}
              </span>
              <div className="flex flex-1 items-baseline justify-between gap-2 text-[13px]">
                <span className="tabular-nums text-ink/70">{formatDateKr(h.date)}</span>
                <span className="tabular-nums font-medium">{formatKrw(h.minPrice)}</span>
                <span
                  className={h.result === "유찰" ? "font-semibold text-accent" : "text-ink/70"}
                >
                  {h.result}
                </span>
              </div>
            </li>
          );
        })}
        {upcoming && (
          <li className="relative flex gap-3">
            <span className="flex flex-col items-center">
              <span
                aria-hidden
                className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-accent bg-white"
              />
            </span>
            <div className="flex flex-1 items-baseline justify-between gap-2 text-[13px]">
              <span className="tabular-nums text-ink/70">{formatDateKr(saleDate)}</span>
              <span className="tabular-nums font-semibold text-accent">{formatKrw(minPrice)}</span>
              <span className="font-medium text-ink/70">이번 회차(예정)</span>
            </div>
          </li>
        )}
      </ol>
    </section>
  );
}
