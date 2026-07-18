"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  applyFilters,
  parseDistrictKey,
  PRICE_BANDS,
  sortItems,
  type SortKey,
} from "@/lib/data";
import { buildListQuery, parseListQuery, type ListQuery } from "@/lib/query";
import { useAuctionData } from "@/lib/use-auction-data";
import { ItemList } from "@/components/ItemList";
import { ListSkeleton } from "@/components/Skeleton";
import { ErrorState } from "@/components/ErrorState";
import { PickBadge } from "@/components/PickBadge";

// ② 리스트 — 상태 원천은 URL 쿼리(§13 규칙 11). 새로고침·뒤로가기·공유에서 동일 화면 복원.
function ListContent() {
  const params = useSearchParams();
  const query = useMemo(() => parseListQuery(new URLSearchParams(params.toString())), [params]);
  const { status, items, retry } = useAuctionData();

  const filtered = useMemo(
    () => sortItems(applyFilters(items, query), query.sort),
    [items, query],
  );

  // 셸로우 URL 갱신(감사 29) — 데이터·필터 연산이 전부 클라이언트에 있으므로 서버 RSC 왕복을 만들지
  // 않는다. Next가 history.replaceState를 라우터와 동기화해 useSearchParams가 즉시 갱신되므로
  // URL 원천 계약(§13 규칙 11: 직접 진입·새로고침·뒤로가기 복원)은 그대로 유지된다.
  const update = (patch: Partial<ListQuery>) => {
    window.history.replaceState(null, "", `/list${buildListQuery({ ...query, ...patch })}`);
  };

  if (status === "loading") return <ListSkeleton />;
  if (status === "error")
    return (
      <ErrorState
        message="물건 데이터를 불러오지 못했다."
        action="네트워크 상태를 확인한 뒤 다시 시도하라."
        onRetry={retry}
      />
    );

  // 적용 중 필터 요약 칩(감사 15) — 어떤 조건으로 좁혀졌는지 상시 표시, 탭하면 그 조건만 해제.
  const chips: { key: string; label: string; onRemove: () => void }[] = [
    ...query.regions.map((r) => ({
      key: `r:${r}`,
      label: r,
      // 시·도 해제 시 그 시·도의 시·군·구 선택도 함께 해제(RegionFilter와 동일 규약).
      onRemove: () =>
        update({
          regions: query.regions.filter((x) => x !== r),
          districts: query.districts.filter((d) => parseDistrictKey(d).region !== r),
          count: 10,
        }),
    })),
    ...query.districts.map((d) => {
      const { region, district } = parseDistrictKey(d);
      return {
        key: `d:${d}`,
        label: region ? `${region} ${district}` : district,
        onRemove: () =>
          update({ districts: query.districts.filter((x) => x !== d), count: 10 }),
      };
    }),
    ...query.priceBands.map((b) => ({
      key: `b:${b}`,
      label: PRICE_BANDS.find((band) => band.key === b)?.label ?? b,
      onRemove: () =>
        update({ priceBands: query.priceBands.filter((x) => x !== b), count: 10 }),
    })),
    ...query.categories.map((c) => ({
      key: `c:${c}`,
      label: c,
      onRemove: () =>
        update({ categories: query.categories.filter((x) => x !== c), count: 10 }),
    })),
  ];

  // 빈 결과 완화 제안(감사 25·26) — 실제 적용 중인 조건의 해제만 제안해 무동작 버튼을 없앤다.
  // 시·군·구가 있으면 그것부터 단계적으로, 시·도만 있으면 전국 보기 — 라벨과 실동작을 일치시킨다.
  const relaxActions = [
    ...(query.priceBands.length > 0
      ? [{ label: "금액 범위 넓히기", onClick: () => update({ priceBands: [], count: 10 }) }]
      : []),
    ...(query.districts.length > 0
      ? [{ label: "시·군·구 조건 해제", onClick: () => update({ districts: [], count: 10 }) }]
      : query.regions.length > 0
        ? [{ label: "지역 조건 해제(전국 보기)", onClick: () => update({ regions: [], count: 10 }) }]
        : []),
    ...(query.categories.length > 0 &&
    query.priceBands.length === 0 &&
    query.districts.length === 0 &&
    query.regions.length === 0
      ? [{ label: "용도 조건 해제", onClick: () => update({ categories: [], count: 10 }) }]
      : []),
  ];

  return (
    <>
      {query.pickOnly && (
        <div className="flex items-center gap-2 px-4 pt-4">
          <PickBadge />
          <span className="text-[13px] text-ink/70">
            감정가 대비 50% 이하 물건만 보는 중
          </span>
        </div>
      )}
      {chips.length > 0 && (
        <div
          role="group"
          aria-label="적용 중인 필터"
          className={`flex flex-wrap gap-1.5 px-4 ${query.pickOnly ? "pt-2" : "pt-4"}`}
        >
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={c.onRemove}
              aria-label={`${c.label} 필터 해제`}
              className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-[14px] tabular-nums text-ink transition-colors duration-200 hover:bg-paper"
            >
              {c.label}
              <span aria-hidden className="text-[12px] text-ink/70">
                ×
              </span>
            </button>
          ))}
        </div>
      )}
      <ItemList
        items={filtered}
        shown={query.count}
        sort={query.sort}
        onSortChange={(sort: SortKey) => update({ sort, count: 10 })}
        onMore={() => update({ count: query.count + 10 })}
        relaxActions={relaxActions}
      />
    </>
  );
}

export default function ListPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <ListContent />
    </Suspense>
  );
}
