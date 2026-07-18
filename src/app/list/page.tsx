"use client";

import { Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { applyFilters, sortItems, type SortKey } from "@/lib/data";
import { buildListQuery, parseListQuery } from "@/lib/query";
import { useAuctionData } from "@/lib/use-auction-data";
import { ItemList } from "@/components/ItemList";
import { ListSkeleton } from "@/components/Skeleton";
import { ErrorState } from "@/components/ErrorState";
import { PickBadge } from "@/components/PickBadge";

// ② 리스트 — 상태 원천은 URL 쿼리(§13 규칙 11). 새로고침·뒤로가기·공유에서 동일 화면 복원.
function ListContent() {
  const router = useRouter();
  const params = useSearchParams();
  const query = useMemo(() => parseListQuery(new URLSearchParams(params.toString())), [params]);
  const { status, items, retry } = useAuctionData();

  const filtered = useMemo(
    () => sortItems(applyFilters(items, query), query.sort),
    [items, query],
  );

  const update = (patch: Partial<typeof query>) => {
    router.replace(`/list${buildListQuery({ ...query, ...patch })}`, { scroll: false });
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
      <ItemList
        items={filtered}
        shown={query.count}
        sort={query.sort}
        onSortChange={(sort: SortKey) => update({ sort, count: 10 })}
        onMore={() => update({ count: query.count + 10 })}
        onRelaxPrice={() => update({ priceBands: [], count: 10 })}
        onRelaxRegion={() =>
          update(
            query.districts.length > 0
              ? { districts: [], count: 10 }
              : { regions: [], count: 10 },
          )
        }
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
