import Link from "next/link";
import type { AuctionItem } from "@/types/auction";
import { isPick } from "@/lib/data";
import { dday, discountPct, formatDday, formatKrw } from "@/lib/format";
import { PickBadge } from "@/components/PickBadge";
import { CategoryThumb } from "@/components/CategoryThumb";

// 카드 간단정보 7요소(§4.3-②): 사진 · 용도 배지 · 소재지 · 가격 구조 한 줄 · 픽 배지 · 유찰 N회 · D-day
export function ItemCard({ item, compact = false }: { item: AuctionItem; compact?: boolean }) {
  const days = dday(item.saleDate);
  const pct = discountPct(item.priceRatio);
  return (
    <Link
      href={`/item/${item.id}`}
      className={`block ${compact ? "w-56 shrink-0" : ""} cursor-pointer rounded-xl border border-line bg-white p-4 transition-colors duration-200 hover:bg-paper`}
    >
      <div className="flex gap-3">
        <CategoryThumb category={item.category} photoUrl={item.photoUrl} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-ink/8 px-1.5 py-0.5 text-[11px] font-medium text-ink/80">
              {item.category}
            </span>
            {isPick(item) && <PickBadge />}
          </div>
          <p className="mt-1 truncate text-[13px] text-ink/80">
            {item.region} {item.district}
          </p>
          <p className="mt-1 truncate tabular-nums">
            {/* 감정가 취소선 — ink/70: 흰 카드 위 대비 4.5:1 확보(감사 8) */}
            <span className="text-[12px] text-ink/70 line-through">
              {formatKrw(item.appraisalPrice)}
            </span>{" "}
            <span className="font-bold text-accent">{formatKrw(item.minPrice)}</span>{" "}
            <span className="text-[12px] font-semibold text-accent">-{pct}%</span>
          </p>
          <p className="mt-1 flex items-center gap-2 text-[12px] tabular-nums text-ink/70">
            <span>유찰 {item.failCount}회</span>
            <span aria-hidden>·</span>
            <span className={days <= 7 && days >= 0 ? "font-semibold text-accent" : ""}>
              {formatDday(days)}
            </span>
          </p>
        </div>
      </div>
    </Link>
  );
}
