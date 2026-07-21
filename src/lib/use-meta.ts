"use client";

import { useEffect, useState } from "react";
import type { Meta } from "@/types/auction";

// 기준일 상태의 단일 소스 — meta.json 하나만 읽는다.
// 상세·안내처럼 물건 데이터가 필요 없는 화면이 지역 17개 파일을 내려받지 않게 분리한다(§13 규칙 4).
// 모듈 스토어로 둔 이유(감사 39): 본문 ErrorState의 "다시 시도"가 성공하면 기준일 바도 같은 순간 복구돼야 한다.

export interface MetaState {
  /** 화면이 반영 중인 기준일. 재검증으로 값이 바뀌어도 사용자가 새로고침하기 전까지 교체하지 않는다. */
  meta: Meta | null;
  /** 최초 로드 실패. 안내·복구 동선은 본문 ErrorState 1곳이 맡는다(감사 68 — 2중 안내 금지). */
  failed: boolean;
  /** 재검증에서 확인한 새 기준일(현재 화면 데이터와 다름). 자동 새로고침은 하지 않는다(감사 41). */
  pending: Meta | null;
  /** 형식 오류로 제외한 물건 수(감사 36). */
  dropped: number;
}

let state: MetaState = { meta: null, failed: false, pending: null, dropped: 0 };
const listeners = new Set<(s: MetaState) => void>();

function publish(patch: Partial<MetaState>): void {
  state = { ...state, ...patch };
  for (const notify of listeners) notify(state);
}

function isMeta(v: unknown): v is Meta {
  const m = v as Meta;
  return (
    !!m &&
    typeof m.crawledAt === "string" &&
    typeof m.nextUpdateAt === "string" &&
    typeof m.totalCount === "number" &&
    typeof m.countsByRegion === "object"
  );
}

let inflight: Promise<Meta> | null = null;

async function fetchMeta(bypassCache: boolean): Promise<Meta> {
  // 재검증은 캐시를 우회한다 — 서비스워커·HTTP 캐시가 지난주 meta를 돌려주면 지연·갱신 판정이 무의미해진다.
  const res = await fetch("/data/meta.json", bypassCache ? { cache: "no-store" } : undefined);
  if (!res.ok) throw new Error(`meta.json 응답 ${res.status}`);
  const json: unknown = await res.json();
  if (!isMeta(json)) throw new Error("meta.json 형식 오류");
  return json;
}

/** 최초 로드(캐시 우선). force=true면 재요청 — 본문 다시 시도가 기준일까지 되살리는 경로(감사 39). */
export async function readMeta(force = false): Promise<Meta> {
  if (!force && state.meta) return state.meta;
  if (!inflight) {
    const run = fetchMeta(force);
    inflight = run;
    run.then(
      (meta) => {
        inflight = null;
        publish({ meta, failed: false, pending: null });
      },
      () => {
        inflight = null; // 실패 시 초기화 — 다음 시도가 새 요청을 낸다
        publish({ failed: true });
      },
    );
  }
  return inflight;
}

// 재검증 간격 하한 — 데이터는 주 1회 갱신이므로 앱 전환마다 요청할 이유가 없다.
const REVALIDATE_MIN_MS = 5 * 60_000;
let lastRevalidatedAt = 0;

/**
 * 화면 복귀·온라인 복귀 시 재검증(감사 41). 값이 바뀌면 알리기만 하고 화면 상태는 보존한다 —
 * 자동 새로고침은 사용자의 필터·스크롤을 날린다.
 */
export async function revalidateMeta(): Promise<void> {
  if (inflight || state.pending) return; // 진행 중 요청·이미 안내 중인 갱신은 재요청하지 않는다
  const current = state.meta;
  if (!current) {
    await readMeta(true).catch(() => {}); // 실패 상태의 자동 복구는 간격 제한 없이 시도한다
    return;
  }
  const now = Date.now();
  if (now - lastRevalidatedAt < REVALIDATE_MIN_MS) return;
  lastRevalidatedAt = now;
  try {
    const fresh = await fetchMeta(true);
    publish({ pending: fresh.crawledAt === current.crawledAt ? null : fresh });
  } catch {
    // 재검증 실패는 표시 중인 기준일을 무효화하지 않는다 — 다음 복귀에서 다시 시도한다.
  }
}

/** 손상 항목 제외 결과 보고(감사 36) — 고지는 기준일 바 1곳에서만 한다(1정보 1표시). */
export function reportDropped(count: number): void {
  if (count !== state.dropped) publish({ dropped: count });
}

export function useMeta(): MetaState {
  const [snapshot, setSnapshot] = useState<MetaState>(state);
  useEffect(() => {
    listeners.add(setSnapshot);
    setSnapshot(state);
    void readMeta().catch(() => {});
    // 열린 세션이 낡은 화면을 무기한 유지하지 않게 화면 복귀·온라인 복귀 시 재검증한다(감사 41).
    const onWake = () => {
      if (document.visibilityState === "visible") void revalidateMeta();
    };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    return () => {
      listeners.delete(setSnapshot);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
    };
  }, []);
  return snapshot;
}
