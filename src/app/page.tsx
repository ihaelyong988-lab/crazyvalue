"use client";

import { useEffect, useMemo, useState } from "react";
import type { Category } from "@/types/auction";
import { applyFilters, isPick, newThisWeek, type Filters, type PriceBandKey } from "@/lib/data";
import { buildListQuery } from "@/lib/query";
import { getWatchState } from "@/lib/watchlist";
import { useAuctionData } from "@/lib/use-auction-data";
import { RegionFilter } from "@/components/RegionFilter";
import { PriceFilter } from "@/components/PriceFilter";
import { CategoryFilter } from "@/components/CategoryFilter";
import { ResultButton } from "@/components/ResultButton";
import { PickEntry } from "@/components/PickEntry";
import { NewThisWeek } from "@/components/NewThisWeek";
import { RecentViewed } from "@/components/RecentViewed";
import { OnboardingSheet } from "@/components/OnboardingSheet";
import { ListSkeleton } from "@/components/Skeleton";
import { ErrorState } from "@/components/ErrorState";

// ① 홈(검색) — 배치 순서 고정(§4.3-①): 필터 3축 → 결과 버튼(고정) → 픽 진입 → 이번 주 신규 → 최근 본 물건.
export default function HomePage() {
  const { status, items, meta, retry } = useAuctionData();
  const [filters, setFilters] = useState<Filters>({
    regions: [],
    districts: [],
    priceBands: [],
    categories: [],
  });

  // 온보딩 반영(§4.3-① 9): 설정한 지역·금액이 필터 초기값
  const applyPrefs = () => {
    const { prefs } = getWatchState();
    setFilters((f) => ({
      ...f,
      regions: prefs.regions,
      priceBands: prefs.priceBands.filter((b): b is PriceBandKey =>
        ["b1", "b2", "b3", "b4", "b5"].includes(b),
      ),
    }));
  };
  useEffect(applyPrefs, []);

  const count = useMemo(() => applyFilters(items, filters).length, [items, filters]);
  const pickCount = useMemo(() => items.filter(isPick).length, [items]);
  const fresh = useMemo(
    () => (meta ? newThisWeek(items, meta.crawledAt) : []),
    [items, meta],
  );

  // 필터 UI는 정적이므로 데이터와 무관하게 즉시 렌더한다(첫 페인트 = 필터 화면).
  // 데이터 의존 블록(픽·신규·최근·건수)만 로드 후 표시 — LCP 예산(§13 규칙 4) 준수 구조.
  return (
    <div className="space-y-5 p-4 pb-24">
      <OnboardingSheet onDone={applyPrefs} />

      {status === "error" && (
        <ErrorState
          message="물건 데이터를 불러오지 못했다."
          action="네트워크 상태를 확인한 뒤 다시 시도하라."
          onRetry={retry}
        />
      )}

      <RegionFilter
        items={items}
        regions={filters.regions}
        districts={filters.districts}
        onChange={(regions, districts) => setFilters({ ...filters, regions, districts })}
      />
      <PriceFilter
        value={filters.priceBands}
        onChange={(priceBands) => setFilters({ ...filters, priceBands })}
      />
      <CategoryFilter
        value={filters.categories}
        onChange={(categories: Category[]) => setFilters({ ...filters, categories })}
      />

      {status === "loading" && <ListSkeleton rows={2} />}
      {status === "ready" && (
        <>
          <PickEntry count={pickCount} />
          <NewThisWeek items={fresh} />
          <RecentViewed items={items} />
        </>
      )}

      {status !== "error" && (
        <ResultButton
          count={count}
          href={`/list${buildListQuery(filters)}`}
          loading={status === "loading"}
        />
      )}
    </div>
  );
}
