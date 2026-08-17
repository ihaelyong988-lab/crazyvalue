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
  chooseHomeRestore,
  clearHomeFilterMirror,
  getWatchState,
  readHomeFilterMirrorAt,
  stampHomeFilterMirror,
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
 * 이 문서에서 홈을 이미 한 번 복원했는지 — 직접 진입(새 문서)과 뒤로가기·탭 복귀(같은 문서 재마운트)를 가른다.
 * 재마운트 홈의 URL은 떠날 때의 스냅샷이라 그 뒤 리스트에서 해제한 조건도, /me에서 저장한 조건도 모른다.
 * 이 값이 복원 우선순위(chooseHomeRestore)의 첫 입력이다.
 */
let restoredInThisDocument = false;

/** 빈 필터는 호출마다 새 객체다 — 공유 상수를 넘기면 호출부 변이가 초기값을 오염시킨다. */
const emptyFilters = (): Filters => ({
  regions: [],
  districts: [],
  priceBands: [],
  categories: [],
});

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
  const [filters, setFilters] = useState<Filters>(emptyFilters);

  // 필터 출처 추적(감사 2차 33): 관심조건에서 온 필터만 타 탭의 조건 변경을 따라간다.
  // 이번 세션에 사용자가 직접 만진 필터는 타 탭 저장으로 덮지 않는다.
  const fromPrefs = useRef(false);
  const seenPrefs = useRef<Prefs>({ regions: [], priceBands: [] });
  // 지금 화면에 걸린 필터의 거울 — 이펙트·구독 콜백 클로저는 첫 렌더의 state에 묶인다.
  const shown = useRef<Filters>(emptyFilters());

  /**
   * 필터 반영 1경로: 화면·세션 미러(기록 시각 포함)·홈 URL을 한 번에 맞춘다.
   * 셋 중 하나만 갱신하면 다음 진입이 서로 다른 조건을 주장한다 — 미러 되쓰기가 옛 조건을 부활시킨
   * 것이 감사 3차 32의 원인이다. 미러에는 반드시 기록 시각을 함께 남긴다.
   */
  const commit = (next: Filters) => {
    shown.current = next;
    setFilters(next);
    writeHomeFilterMirror(next);
    stampHomeFilterMirror();
    // state를 null로 밀지 않는다 — Next app-router의 `__NA` 마커가 사라진 엔트리로 뒤로 가면
    // 라우터가 SPA 복원 대신 window.location.reload()로 떨어진다(감사 3차 95).
    // 리스트(list/page.tsx)는 반대다 — 거기는 useSearchParams가 원천이라 state를 새로 써야
    // 라우터가 새 URL을 인식한다. 홈은 window.location.search를 직접 읽으므로 보존이 안전하다.
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + buildListQuery(next),
    );
  };

  // 온보딩·관심조건 반영(§4.3-① 9): 설정한 지역·금액이 필터 초기값
  const applyPrefs = () => {
    const { prefs } = getWatchState();
    fromPrefs.current = true;
    seenPrefs.current = prefs;
    commit({
      ...shown.current,
      regions: prefs.regions,
      priceBands: prefs.priceBands.filter((b): b is PriceBandKey =>
        ["b1", "b2", "b3", "b4", "b5"].includes(b),
      ),
    });
  };

  // 복원(마운트 1회): URL → 관심조건(미러보다 최신이면) → 미러 → 관심조건.
  // 순위 판정은 watchlist.chooseHomeRestore가 단독으로 진다(저장값의 나이를 아는 곳이 한 곳이어야 한다).
  // 어느 원천을 택하든 commit으로 세 저장소를 일치시킨다 — 옛 URL을 미러로 되쓰는 경로를 남기지 않는다.
  useEffect(() => {
    const remounted = restoredInThisDocument;
    restoredInThisDocument = true;
    const mirror = readHomeFilterMirror();
    const params = new URLSearchParams(window.location.search);
    const source = chooseHomeRestore({
      remounted,
      hasUrlFilters: FILTER_PARAM_KEYS.some((k) => params.has(k)),
      hasMirror: mirror !== null,
      mirrorAt: readHomeFilterMirrorAt(),
      prefsSavedAt: getWatchState().prefs.savedAt ?? 0,
    });
    if (source === "url") commit(filtersFromQuery(window.location.search));
    else if (source === "mirror" && mirror !== null) commit(filtersFromQuery(mirror));
    else applyPrefs();
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

  const updateFilters = (next: Filters) => {
    fromPrefs.current = false; // 사용자가 만진 필터 — 이후 타 탭 조건 변경에 덮이지 않는다
    commit(next);
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
