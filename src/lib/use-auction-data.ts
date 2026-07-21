"use client";

import { useCallback, useEffect, useState } from "react";
import { REGIONS } from "@/types/catalog";
import type { AuctionItem, Meta } from "@/types/auction";
import { isValidAuctionItem } from "@/lib/data";
import { readMeta, reportDropped } from "@/lib/use-meta";

// 전 물건·메타를 1회 로드해 모듈 캐시로 공유한다(주간 정적 데이터 — §5.2 클라이언트 연산 전제).
// 실패 분기·재시도는 §13 규칙 5(SRE): 조용한 실패 금지, 화면은 ErrorState로 복구 동작을 제공한다.
// 손상 대응 2단(감사 36): 항목 단위 손상은 그 항목만 제외하고 건수를 고지하며(기준일 바 1곳),
//   파일 자체가 배열이 아니면 지역 하나가 통째로 사라져 건수·픽 통계가 거짓이 되므로 로드 실패로 올린다.
// 검증은 zod가 아니라 data.ts의 순수 가드로 한다 — 클라이언트 번들에 스키마를 싣지 않는다(§13 규칙 4).

export interface AuctionData {
  items: AuctionItem[];
  meta: Meta;
  /** 형식 오류로 제외한 항목 수 */
  dropped: number;
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
        ...REGIONS.map((r) => fetchJson(`/data/${r.key}.json`)),
      ]);
      const items: AuctionItem[] = [];
      let dropped = 0;
      regions.forEach((raw, i) => {
        if (!Array.isArray(raw)) throw new Error(`/data/${REGIONS[i].key}.json 형식 오류`);
        for (const entry of raw) {
          if (isValidAuctionItem(entry)) items.push(entry);
          else dropped++;
        }
      });
      if (items.length === 0) throw new Error("물건 데이터 비어 있음");
      reportDropped(dropped);
      cache = { items, meta, dropped };
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
