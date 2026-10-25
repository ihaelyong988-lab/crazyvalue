import type { AuctionItem } from "@/types/auction";
import { isPick } from "@/lib/data";
import { discountPct, formatKrw, formatWon } from "@/lib/format";
import { PickBadge } from "@/components/PickBadge";

// 상세 가격 구조(§4.3-③): 감정가 → 최저가 바 + 할인율 + 픽 + 보증금.
export function PriceStructure({ item }: { item: AuctionItem }) {
  const pct = discountPct(item.priceRatio);
  const width = Math.max(6, Math.round(item.priceRatio * 100));
  // 재매각 여부나 금액의 역산 비율로 확정하지 않는다: 명시된 보증금 비율만 같은 금액과 대조한다.
  const noteRates = [...(item.specialNote ?? "").matchAll(
    /(?:매수(?:신청)?보증금|입찰보증금|매각보증금)[^.!?\n]{0,60}?(?:최저(?:매각)?가격|최저가)(?:의|에 대한)?\s*(\d+(?:\.\d+)?)\s*%/g,
  )].map((match) => Number(match[1]));
  const detailRates = item.depositSource === "observed" && item.depositRate !== undefined ? [item.depositRate] : [];
  const rates = [...new Set([...detailRates, ...noteRates])];
  const rate = rates.length === 1 && rates[0] > 0 && rates[0] <= 100 ? rates[0] : null;
  const confirmed = rate !== null && item.deposit === Math.ceil((item.minPrice * rate) / 10_000) * 100;
  const conflict = rates.length > 0 && !confirmed;
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
      <p className="mt-3 border-t border-line pt-3 text-[13px] leading-snug tabular-nums text-ink/80">
        입찰보증금 {formatKrw(item.deposit)}{!confirmed && <strong className="ml-1 text-accent">확인 필요</strong>}
        <span className="text-ink/70">
          {" "}
          {confirmed
            ? `— 최저가의 ${rate}%, ${noteRates.length > 0 ? "공고 비고" : "상세 수집 비율"} 기준 계산값이다.`
            : conflict
              ? "— 저장 금액과 명시 비율(비고·상세)이 달라 법원 공고 확인이 필요하다."
              : "— 출처 미확인 참고값으로 금액·비율은 법원 공고에서 확인한다."}
        </span>
      </p>
    </section>
  );
}
