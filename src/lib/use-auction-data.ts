"use client";

import { useCallback, useEffect, useState } from "react";
import { REGIONS } from "@/types/catalog";
import type { AuctionItem, Meta } from "@/types/auction";
import { readMeta } from "@/lib/use-meta";

// 전 물건·메타를 1회 로드해 모듈 캐시로 공유한다(주간 정적 데이터 — §5.2 클라이언트 연산 전제).
// 실패 분기·재시도는 §13 규칙 5(SRE): 조용한 실패 금지, 화면은 ErrorState로 복구 동작을 제공한다.
// zod 재검증은 수집·테스트 게이트에서 이미 끝났으므로 클라이언트에 싣지 않는다(§13 규칙 4 성능 예산 — 번들 ≈50kB 절감).

export interface AuctionData {
  items: AuctionItem[];
  meta: Meta;
}

let cache: AuctionData | null = null;
let inflight: Promise<AuctionData> | null = null;

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path} 응답 ${res.status}`);
  return res.json();
}

async function load(): Promise<AuctionData> {
  if (cache) return cache;
  if (!inflight) {
    inflight = (async () => {
      const [meta, ...regions] = await Promise.all([
        readMeta(),
        ...REGIONS.map((r) => fetchJson(`/data/${r.key}.json`) as Promise<AuctionItem[]>),
      ]);
      const items = regions.flat();
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error("물건 데이터 비어 있음");
      }
      cache = { items, meta };
      return cache;
    })();
    inflight.catch(() => {
      inflight = null; // 실패 시 재시도 가능하게 초기화
    });
  }
  return inflight;
}

export type LoadStatus = "loading" | "ready" | "error";

export function useAuctionData(): {
  status: LoadStatus;
  items: AuctionItem[];
  meta: Meta | null;
  retry: () => void;
} {
  const [state, setState] = useState<{ status: LoadStatus; data: AuctionData | null }>({
    status: cache ? "ready" : "loading",
    data: cache,
  });

  const run = useCallback(() => {
    setState((s) => (s.data ? s : { status: "loading", data: null }));
    load()
      .then((data) => setState({ status: "ready", data }))
      .catch(() => setState({ status: "error", data: null }));
  }, []);

  useEffect(() => {
    run();
  }, [run]);

  return {
    status: state.status,
    items: state.data?.items ?? [],
    meta: state.data?.meta ?? null,
    retry: run,
  };
}
