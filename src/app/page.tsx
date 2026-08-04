"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Category } from "@/types/auction";
import { applyFilters, type Filters, type PriceBandKey } from "@/lib/data";
import {
  buildListQuery,
  parseListQuery,
  readHomeFilterMirror,
  writeHomeFilterMirror,
} from "@/lib/query";
import {
  clearHomeFilterMirror,
  getWatchState,
  subscribePrefs,
  type Prefs,
} from "@/lib/watchlist";
import { useAuctionData } from "@/lib/use-auction-data";
import { RegionFilter } from "@/components/RegionFilter";
import { PriceFilter } from "@/components/PriceFilter";
import { CategoryFilter } from "@/components/CategoryFilter";
import { ResultButton } from "@/components/ResultButton";
import { RecentViewed } from "@/components/RecentViewed";
import { OnboardingSheet } from "@/components/OnboardingSheet";
import { ListSkeleton } from "@/components/Skeleton";
import { ErrorState } from "@/components/ErrorState";

// 홈 필터 유지(감사 백로그 3): useState만으로는 리스트·상세 뒤로가기 복귀(재마운트) 시 휘발된다.
// 세션 미러 값은 /list와 동일한 쿼리 문자열 형식 — parseListQuery/buildListQuery를 재사용해 URL 계약(§13 규칙 11)과 일치.
// 미러 저장소는 리스트와 공유한다(query.ts) — 관심조건 저장이 이 미러를 무효화해야 새 조건이 홈에 반영된다(감사 2차 32).
const FILTER_PARAM_KEYS = ["r", "d", "b", "c"] as const;

/**
 * 이 문서에서 홈을 이미 한 번 복원했는지 — 직접 진입(새 문서)과 뒤로가기 복귀(같은 문서 재마운트)를 가른다.
 * 뒤로가기로 돌아온 홈의 URL은 떠날 때의 스냅샷이라 그 뒤 리스트에서 해제한 조건을 모른다(감사 2차 55).
 * 미러는 홈·리스트가 함께 갱신하므로 복귀 시점의 최신값이다 — 재마운트 복원에서만 미러를 URL보다 앞세운다.
 */
let restoredInThisDocument = false;

/** 쿼리 문자열 → 홈 필터 4축. 알 수 없는 값 폐기는 parseListQuery가 담당한다. */
function filtersFromQuery(query: string): Filters {
  const { regions, districts, priceBands, categories } = parseListQuery(
    new URLSearchParams(query),
  );
  return { regions, districts, priceBands, categories };
}

// ① 홈(검색) — 배치 순서(§4.3-①): 필터 3축 → 결과 버튼(고정) → 최근 본 물건.
// "이번 주 신규" 섹션 제거: 갱신이 매일이라 주 단위 판정창이 성립하지 않고, 신규 건수는 기준일 바가
// meta.newCount로 한 번만 말한다(1정보 1표시). 홈에서 같은 사실을 섹션으로 다시 세지 않는다.
// 픽 진입 카드(감정가 50% 이하) 제거: 데이터셋 전체가 이미 유찰 2회 이상이라, 첫 화면 기준을
// "유찰 2회 이상으로 값이 내려간 물건" 하나로 통일한다(2026-07-22 주인님 지시). 감정가 50% 기준은
// 리스트 카드 픽 배지·/list?pick·안내(/guide)에만 부가정보로 남긴다.
export default function HomePage() {
  const { status, items, retry } = useAuctionData();
  const [filters, setFilters] = useState<Filters>({
    regions: [],
    districts: [],
    priceBands: [],
    categories: [],
  });

  // 필터 출처 추적(감사 2차 33): 관심조건에서 온 필터만 타 탭의 조건 변경을 따라간다.
  // 이번 세션에 사용자가 직접 만진 필터는 타 탭 저장으로 덮지 않는다.
  const fromPrefs = useRef(false);
  const seenPrefs = useRef<Prefs>({ regions: [], priceBands: [] });

  // 온보딩 반영(§4.3-① 9): 설정한 지역·금액이 필터 초기값
  const applyPrefs = () => {
    const { prefs } = getWatchState();
    fromPrefs.current = true;
    seenPrefs.current = prefs;
    setFilters((f) => ({
      ...f,
      regions: prefs.regions,
      priceBands: prefs.priceBands.filter((b): b is PriceBandKey =>
        ["b1", "b2", "b3", "b4", "b5"].includes(b),
      ),
    }));
  };

  // 복원(마운트 1회): URL 쿼리 → 세션 미러 → 온보딩 prefs 순.
  // URL 복원은 미러에, 미러 복원은 URL에 각각 되미러링해 두 저장소를 항상 일치시킨다.
  // 단, 같은 문서에서의 재마운트(뒤로가기 복귀)는 미러를 앞세운다 — 그 사이 리스트에서 바뀐 조건이
  // 히스토리 URL에는 없기 때문이다(감사 2차 55). 새 문서의 직접 진입·공유 링크는 URL이 계속 원천이다.
  useEffect(() => {
    const mirror = readHomeFilterMirror();
    const remounted = restoredInThisDocument;
    restoredInThisDocument = true;
    const params = new URLSearchParams(window.location.search);
    if (!(remounted && mirror !== null) && FILTER_PARAM_KEYS.some((k) => params.has(k))) {
      const restored = filtersFromQuery(window.location.search);
      setFilters(restored);
      writeHomeFilterMirror(restored);
      return;
    }
    if (mirror !== null) {
      const restored = filtersFromQuery(mirror);
      setFilters(restored);
      window.history.replaceState(null, "", window.location.pathname + buildListQuery(restored));
      return;
    }
    applyPrefs();
  }, []);

  // 타 탭 관심조건 변경 반영(감사 2차 33): 이 화면 필터가 관심조건에서 왔으면 새 조건을 그대로 따르고,
  // 사용자가 직접 만진 필터는 유지하되 세션 미러만 버려 다음 복원이 새 조건을 쓰게 한다(감사 2차 32).
  useEffect(
    () =>
      subscribePrefs(
        () => seenPrefs.current,
        (next) => {
          seenPrefs.current = next;
          if (fromPrefs.current) applyPrefs();
          else clearHomeFilterMirror();
        },
      ),
    [],
  );

  // 칩 토글 시 세션 미러·홈 URL 쿼리를 동시 갱신(셸로우 replaceState — 서버 왕복 없음).
  const updateFilters = (next: Filters) => {
    fromPrefs.current = false; // 사용자가 만진 필터 — 이후 타 탭 조건 변경에 덮이지 않는다
    setFilters(next);
    writeHomeFilterMirror(next);
    window.history.replaceState(null, "", window.location.pathname + buildListQuery(next));
  };

  const count = useMemo(() => applyFilters(items, filters).length, [items, filters]);

  // 필터 UI는 정적이므로 데이터와 무관하게 즉시 렌더한다(첫 페인트 = 필터 화면).
  // 데이터 의존 블록(최근 본 물건·건수)만 로드 후 표시 — LCP 예산(§13 규칙 4) 준수 구조.
  return (
    <div className="space-y-4 p-4 pb-8">
      <OnboardingSheet onDone={applyPrefs} />

      {/* 앱 목적 1줄 = 홈 h1 겸용(감사 2차 50·73). 헤더 태그라인이 분류("법원경매 초저가 큐레이션")를
          말하므로 여기서는 선별 기준을 말한다 — 같은 말을 두 번 두지 않는다. */}
      <h1 className="text-[15px] font-semibold leading-snug">
        유찰 2회 이상으로 값이 내려간 물건만 모았다.
      </h1>

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
      {status === "ready" && <RecentViewed items={items} />}

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
