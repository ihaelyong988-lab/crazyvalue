"use client";

import { useEffect, useState } from "react";
import type { Meta } from "@/types/auction";

// meta.json의 클라이언트 로드 — 물건 데이터 로드(use-auction-data)가 함께 쓰는 경로다.
//
// 화면 기준일은 여기서 오지 않는다. 그건 빌드 산출물에서 서버 렌더한다(src/lib/build-meta.ts).
// 2026-08-09까지는 기준일도 이 훅이 날랐고, 서비스워커가 옛 값을 돌려준 첫 화면이 영구히 굳었다.
// 굳은 이유는 캐시만이 아니라 설계였다 — 재검증이 새 날짜를 찾아도 화면 값을 교체하지 않고
// "새로고침" 버튼만 띄웠다(옛 pending). 그 근거로 "자동 새로고침은 필터·스크롤을 날린다"를 달아
// 두었는데, 그건 페이지 재적재에나 해당하는 말이지 날짜 글자 하나를 바꾸는 것과는 무관했다.
// 그 혼동이 고착을 영구로 만들었으므로 pending 경로를 통째로 걷어냈다. 새 배포 감지는
// DataDateNotice가 "빌드에 구운 값보다 더 새로운가"로 판정한다 — 비교 기준이 화면이 아니라 산출물이다.

export interface MetaState {
  /** 로드된 meta. 물건 화면이 쓰는 값이다(기준일 바는 쓰지 않는다). */
  meta: Meta | null;
  /** 최초 로드 실패. 안내·복구 동선은 본문 ErrorState 1곳이 맡는다(감사 68 — 2중 안내 금지). */
  failed: boolean;
  /** 형식 오류로 제외한 물건 수(감사 36). */
  dropped: number;
}

let state: MetaState = { meta: null, failed: false, dropped: 0 };
const listeners = new Set<(s: MetaState) => void>();

function publish(patch: Partial<MetaState>): void {
  state = { ...state, ...patch };
  for (const notify of listeners) notify(state);
}

// 필수 4필드만 검사한다 — newCount를 비롯한 optional 필드는 옛 meta.json(서비스워커 캐시)에 없고,
// 여기에 더하면 재방문자의 물건 화면이 통째로 로드 실패로 떨어진다. 소비처는 값 부재를 표시로 흡수한다.
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
  const res = await fetch("/data/meta.json", bypassCache ? { cache: "no-store" } : undefined);
  if (!res.ok) throw new Error(`meta.json 응답 ${res.status}`);
  const json: unknown = await res.json();
  if (!isMeta(json)) throw new Error("meta.json 형식 오류");
  return json;
}

/** 최초 로드(캐시 우선). force=true면 재요청 — 본문 다시 시도가 meta까지 되살리는 경로(감사 39). */
export async function readMeta(force = false): Promise<Meta> {
  if (!force && state.meta) return state.meta;
  if (!inflight) {
    const run = fetchMeta(force);
    inflight = run;
    run.then(
      (meta) => {
        inflight = null;
        publish({ meta, failed: false });
      },
      () => {
        inflight = null; // 실패 시 초기화 — 다음 시도가 새 요청을 낸다
        publish({ failed: true });
      },
    );
  }
  return inflight;
}

/** 손상 항목 제외 결과 보고(감사 36) — 고지는 기준일 바 1곳에서만 한다(1정보 1표시). */
export function reportDropped(count: number): void {
  if (count !== state.dropped) publish({ dropped: count });
}

/**
 * 스토어 구독만 한다 — 여기서 로드를 시작하지 않는다.
 * 물건 데이터가 필요한 화면은 use-auction-data가 readMeta를 부르고, 필요 없는 화면(/guide 등)은
 * meta를 받을 이유가 없다. 기준일은 이미 HTML에 구워져 있다.
 */
export function useMeta(): MetaState {
  const [snapshot, setSnapshot] = useState<MetaState>(state);
  useEffect(() => {
    listeners.add(setSnapshot);
    setSnapshot(state);
    return () => {
      listeners.delete(setSnapshot);
    };
  }, []);
  return snapshot;
}
