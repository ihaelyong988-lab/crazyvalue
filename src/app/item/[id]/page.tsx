import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExternalLink, MapPin } from "lucide-react";
import { findItem, loadAllItems } from "@/lib/data-server";
import { discountPct, formatArea, formatDateKr, formatDday, dday, formatKrw } from "@/lib/format";
import { PriceStructure } from "@/components/PriceStructure";
import { HistoryTimeline } from "@/components/HistoryTimeline";
import { WatchToggle } from "@/components/WatchToggle";
import { ShareButton } from "@/components/ShareButton";
import { LegalNotice } from "@/components/LegalNotice";
import { CategoryThumb } from "@/components/CategoryThumb";
import { RecentTracker } from "./RecentTracker";

// ③ 상세 — 서버에서 데이터 조회해 메타(OG)+초기 렌더(§5.2). 전 물건 정적 생성.
export const dynamicParams = false;

export async function generateStaticParams() {
  const items = await loadAllItems();
  return items.map((i) => ({ id: i.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const item = await findItem(decodeURIComponent(id));
  if (!item) return { title: "물건을 찾을 수 없음 — 미친가치" };
  const pct = discountPct(item.priceRatio);
  return {
    title: `${item.region} ${item.district} ${item.category} 최저가 ${formatKrw(item.minPrice)} — 미친가치`,
    description: `감정가 대비 -${pct}% · 유찰 ${item.failCount}회 · 매각기일 ${formatDateKr(item.saleDate)}. 법원경매 공고 사실 정리, 원문 확인 필수.`,
  };
}

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await findItem(decodeURIComponent(id));
  if (!item) notFound();

  const days = dday(item.saleDate);
  const mapQuery = encodeURIComponent(item.address);

  return (
    <div className="space-y-4 p-4">
      <RecentTracker id={item.id} />

      <header className="flex gap-3">
        <CategoryThumb category={item.category} photoUrl={item.photoUrl} />
        <div className="min-w-0">
          <p className="text-[13px] text-ink/60">
            {item.court} · {item.caseNo} ({item.itemNo})
          </p>
          <h1 className="mt-0.5 text-[17px] font-bold leading-snug">{item.address}</h1>
          <p className="mt-0.5 text-[13px] text-ink/70">
            {item.category} · 유찰 <span className="tabular-nums">{item.failCount}</span>회
          </p>
        </div>
      </header>

      <PriceStructure item={item} />

      <section aria-label="기일 정보" className="rounded-xl border border-line bg-white p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-ink/70">매각기일</span>
          <span className="tabular-nums font-semibold">
            {formatDateKr(item.saleDate)} {item.saleTime}
          </span>
        </div>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="text-[13px] text-ink/70">남은 기간</span>
          <span
            className={`tabular-nums font-bold ${days >= 0 && days <= 7 ? "text-accent" : ""}`}
          >
            {formatDday(days)}
          </span>
        </div>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="text-[13px] text-ink/70">장소</span>
          <span>{item.courtRoom}</span>
        </div>
      </section>

      <section aria-label="기본 정보" className="rounded-xl border border-line bg-white p-4">
        <h2 className="text-[13px] font-semibold text-ink/70">기본 정보</h2>
        <dl className="mt-2 space-y-1.5 text-[14px]">
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-ink/60">용도</dt>
            <dd className="text-right">{item.category}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-ink/60">건물면적</dt>
            <dd className="text-right tabular-nums">{formatArea(item.areaBuilding)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-ink/60">토지면적</dt>
            <dd className="text-right tabular-nums">{formatArea(item.areaLand)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-ink/60">소재지</dt>
            <dd className="text-right">{item.address}</dd>
          </div>
        </dl>
        <div className="mt-3 flex gap-2 border-t border-line pt-3">
          <a
            href={`https://map.naver.com/p/search/${mapQuery}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg border border-line bg-paper text-[13px] font-medium transition-colors duration-200 hover:bg-line/50"
          >
            <MapPin size={15} aria-hidden /> 네이버지도
          </a>
          <a
            href={`https://map.kakao.com/link/search/${mapQuery}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg border border-line bg-paper text-[13px] font-medium transition-colors duration-200 hover:bg-line/50"
          >
            <MapPin size={15} aria-hidden /> 카카오맵
          </a>
        </div>
      </section>

      {item.specialNote && (
        <section aria-label="특이사항" className="rounded-xl border border-line bg-white p-4">
          <h2 className="text-[13px] font-semibold text-ink/70">특이사항(공고 비고)</h2>
          <p className="mt-1 text-[14px] leading-relaxed">{item.specialNote}</p>
        </section>
      )}

      <HistoryTimeline history={item.history} />

      <a
        href={item.detailUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-accent bg-white font-semibold text-accent transition-colors duration-200 hover:bg-paper"
      >
        <ExternalLink size={17} aria-hidden /> 법원경매정보에서 원문 보기
      </a>

      <div className="flex gap-2">
        <WatchToggle item={item} />
        <ShareButton title={`${item.region} ${item.district} ${item.category} — 미친가치`} />
      </div>

      <LegalNotice />
    </div>
  );
}
