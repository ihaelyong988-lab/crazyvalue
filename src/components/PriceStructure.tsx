import type { AuctionItem } from "@/types/auction";
import { isPick } from "@/lib/data";
import { discountPct, formatKrw, formatWon } from "@/lib/format";
import { PickBadge } from "@/components/PickBadge";

// 상세 가격 구조(§4.3-③): 감정가 → 최저가 바 + 할인율 + 픽 + 보증금.
export function PriceStructure({ item }: { item: AuctionItem }) {
  const pct = discountPct(item.priceRatio);
  const width = Math.max(6, Math.round(item.priceRatio * 100));
  const resale = item.specialNote?.startsWith("재매각") === true;
  return (
    <section aria-label="가격 구조" className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-center justify-between text-[13px] text-ink/70">
        <span>감정가</span>
        <span className="tabular-nums line-through">{formatKrw(item.appraisalPrice)}</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink/10">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${width}%` }}
          aria-hidden
        />
      </div>
      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-[13px] text-ink/70">현재 최저가</span>
        <span className="tabular-nums text-xl font-bold text-accent">
          {formatKrw(item.minPrice)}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          {isPick(item) && <PickBadge />}
          <span className="text-[13px] font-semibold text-accent tabular-nums">
            감정가 대비 -{pct}%
          </span>
        </span>
        <span className="text-[12px] tabular-nums text-ink/70">
          {formatWon(item.minPrice)}
        </span>
      </div>
      {/* 보증금 문구는 1문장·중복 0 — 재매각을 두 번 말하고 2문장으로 늘어지던 표기를 압축했다(감사 85).
          비율은 앱이 파생한 값이라 공고 기준임을 1회만 병기한다(§2 임의 단정 금지). */}
      <p className="mt-3 border-t border-line pt-3 text-[13px] leading-snug tabular-nums text-ink/80">
        입찰보증금 {formatKrw(item.deposit)}
        <span className="text-ink/70">
          {" "}
          — 최저가의 {resale ? "20%(재매각 사건)" : "10%"}, 비율은 공고 원문이 기준이다.
        </span>
      </p>
    </section>
  );
}
