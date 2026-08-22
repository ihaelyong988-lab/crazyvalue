import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExternalLink, MapPin } from "lucide-react";
import { findItem, loadAllItems } from "@/lib/data-server";
import { COURT_ORIGIN_URL, siteCourtLabel, splitCaseNo } from "@/lib/court-origin";
import { discountPct, formatArea, formatDateKr, formatDday, dday, formatKrw } from "@/lib/format";
import { PriceStructure } from "@/components/PriceStructure";
import { HistoryTimeline } from "@/components/HistoryTimeline";
import { WatchToggle } from "@/components/WatchToggle";
import { ShareButton } from "@/components/ShareButton";
import { CopyCaseNo } from "@/components/CopyCaseNo";
import { LegalNotice } from "@/components/LegalNotice";
import { CategoryThumb } from "@/components/CategoryThumb";
import { BackButton, RecentTracker } from "./RecentTracker";

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
    // 루트 레이아웃의 canonical("/")을 물려받으면 물건 1,000건이 전부 "홈이 원본"이 된다.
    alternates: { canonical: `/item/${encodeURIComponent(item.id)}` },
  };
}

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await findItem(decodeURIComponent(id));
  if (!item) notFound();

  const days = dday(item.saleDate);
  const mapQuery = encodeURIComponent(item.address);
  const caseParts = splitCaseNo(item.caseNo);

  return (
    <div className="space-y-4 p-4">
      <RecentTracker id={item.id} />

      <BackButton />

      <header className="flex gap-3">
        <CategoryThumb category={item.category} photoUrl={item.photoUrl} />
        <div className="min-w-0">
          <p className="text-[13px] text-ink/70">
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
            <dt className="shrink-0 text-ink/70">용도</dt>
            <dd className="text-right">{item.category}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-ink/70">건물면적</dt>
            <dd className="text-right tabular-nums">{formatArea(item.areaBuilding)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-ink/70">토지면적</dt>
            <dd className="text-right tabular-nums">{formatArea(item.areaLand)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-ink/70">소재지</dt>
            <dd className="text-right">{item.address}</dd>
          </div>
        </dl>
        <div className="mt-3 flex gap-2 border-t border-line pt-3">
          {/* 외부 링크는 새 창 고지를 접근 이름에만 병기한다 — 시각 텍스트를 늘리지 않아
              세로폭을 먹지 않으면서 예고 없는 창 전환을 없앤다(감사 82). */}
          <a
            href={`https://map.naver.com/p/search/${mapQuery}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg border border-line bg-paper text-[13px] font-medium transition-colors duration-200 hover:bg-line/50"
          >
            <MapPin size={15} aria-hidden /> 네이버지도{" "}
            <span className="sr-only">새 창 열림</span>
          </a>
          <a
            href={`https://map.kakao.com/link/search/${mapQuery}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg border border-line bg-paper text-[13px] font-medium transition-colors duration-200 hover:bg-line/50"
          >
            <MapPin size={15} aria-hidden /> 카카오맵{" "}
            <span className="sr-only">새 창 열림</span>
          </a>
        </div>
      </section>

      {item.specialNote && (
        <section aria-label="특이사항" className="rounded-xl border border-line bg-white p-4">
          <h2 className="text-[13px] font-semibold text-ink/70">특이사항(공고 비고)</h2>
          <p className="mt-1 text-[14px] leading-snug">{item.specialNote}</p>
        </section>
      )}

      <HistoryTimeline
        history={item.history}
        saleDate={item.saleDate}
        minPrice={item.minPrice}
        days={days}
      />

      {/* 법원 원문 도달 3종(AGENTS §2-2 조문 6) — ①원문 화면 링크 ②번호 복사 ③찾는 방법 1줄.
          사건 단위 딥링크가 구조적으로 불가하므로(docs/CRAWLER.md §4.1) 세 수단을 한 블록에 묶어
          링크→복사→입력 동선이 끊기지 않게 한다(감사 45).
          세 수단은 **목적지 폼과 1:1로** 맞춘다 — 목적지는 법원(선택)·연도(선택)·번호(입력) 3칸을 받는다.
          그래서 링크는 최상단 화면(`court-origin.ts` 주석), 복사값은 번호 단독, 안내는 그 3칸의 순서다.
          법원 표기는 **선택 목록에 실제로 있는 이름**을 쓴다 — 우리 표기(`대전지방법원 천안지원`)를 그대로
          지목하면 목록에 없는 항목을 찾게 만든다(2026-08-20 실측 190/1,000건). 안내가 지목하는 값을
          이 블록 안에 두는 규약은 유지한다 — 헤더에만 있으면 복사 시점에 화면 밖이다(감사 3차 J4). */}
      <section aria-label="법원 원문 확인" className="space-y-2">
        <a
          href={COURT_ORIGIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-accent bg-white font-semibold text-accent transition-colors duration-200 hover:bg-paper"
        >
          <ExternalLink size={17} aria-hidden /> 법원경매정보에서 사건 조회{" "}
          <span className="sr-only">새 창 열림</span>
        </a>
        <CopyCaseNo caseNo={item.caseNo} />
        <p className="text-[13px] leading-snug text-ink/70">
          원문 화면에서 {siteCourtLabel(item.court)}
          {caseParts && <> · {caseParts.year}</>} 선택 후 번호를 붙여넣는다.
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        <WatchToggle item={item} />
        <ShareButton title={`${item.region} ${item.district} ${item.category} — 미친가치`} />
      </div>

      <LegalNotice />
    </div>
  );
}
