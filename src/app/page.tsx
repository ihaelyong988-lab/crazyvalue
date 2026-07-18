"use client";

import { useEffect, useMemo, useState } from "react";
import type { Category } from "@/types/auction";
import { applyFilters, isPick, newThisWeek, type Filters, type PriceBandKey } from "@/lib/data";
import { buildListQuery, parseListQuery } from "@/lib/query";
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

// 홈 필터 유지(감사 백로그 3): useState만으로는 리스트·상세 뒤로가기 복귀(재마운트) 시 휘발된다.
// 세션 저장 값은 /list와 동일한 쿼리 문자열 형식 — parseListQuery/buildListQuery를 재사용해 URL 계약(§13 규칙 11)과 일치.
const FILTERS_KEY = "crazyvalue.home-filters.v1";
const FILTER_PARAM_KEYS = ["r", "d", "b", "c"] as const;

/** 쿼리 문자열 → 홈 필터 4축. 알 수 없는 값 폐기는 parseListQuery가 담당한다. */
function filtersFromQuery(query: string): Filters {
  const { regions, districts, priceBands, categories } = parseListQuery(
    new URLSearchParams(query),
  );
  return { regions, districts, priceBands, categories };
}

/** 세션 미러 저장 — 실패(용량·프라이빗 모드)는 기능 저하로만 흡수한다(§13 규칙 5). */
function saveSessionFilters(query: string): void {
  try {
    window.sessionStorage.setItem(FILTERS_KEY, query);
  } catch {
    // 저장 불가 시 URL 복원 경로만으로 동작한다.
  }
}

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

  // 복원(마운트 1회): URL 쿼리 → 세션 저장 값 → 온보딩 prefs 순.
  // URL 복원은 세션에, 세션 복원은 URL에 각각 되미러링해 두 저장소를 항상 일치시킨다.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (FILTER_PARAM_KEYS.some((k) => params.has(k))) {
      const restored = filtersFromQuery(window.location.search);
      setFilters(restored);
      saveSessionFilters(buildListQuery(restored));
      return;
    }
    let saved: string | null = null;
    try {
      saved = window.sessionStorage.getItem(FILTERS_KEY);
    } catch {
      // 접근 실패(프라이빗 모드 등)는 기본 흐름으로 흡수한다(§13 규칙 5).
    }
    if (saved !== null) {
      const restored = filtersFromQuery(saved);
      setFilters(restored);
      window.history.replaceState(null, "", window.location.pathname + buildListQuery(restored));
      return;
    }
    applyPrefs();
  }, []);

  // 칩 토글 시 세션·홈 URL 쿼리를 동시 미러(셸로우 replaceState — 서버 왕복 없음).
  const updateFilters = (next: Filters) => {
    setFilters(next);
    const query = buildListQuery(next);
    saveSessionFilters(query);
    window.history.replaceState(null, "", window.location.pathname + query);
  };

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
        onChange={(regions, districts) => updateFilters({ ...filters, regions, districts })}
      />
      <PriceFilter
        value={filters.priceBands}
        onChange={(priceBands) => updateFilters({ ...filters, priceBands })}
      />
      <CategoryFilter
        value={filters.categories}
        onChange={(categories: Category[]) => updateFilters({ ...filters, categories })}
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
