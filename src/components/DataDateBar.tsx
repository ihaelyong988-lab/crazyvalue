"use client";

import { formatDateKr } from "@/lib/format";
import { useMeta } from "@/lib/use-meta";

// 기준일 바 — 주 1회 갱신의 신뢰 장치. 모든 화면 상단 상시 표기(§4.4-8).
// meta.json만 읽는다 — 물건 데이터 로드는 화면별 훅이 담당(§13 규칙 4).
export function DataDateBar() {
  const { meta, failed } = useMeta();
  if (failed) {
    return (
      <div className="bg-navy px-4 pb-2 text-[12px] text-white/80">
        데이터 기준일을 불러오지 못했다. 네트워크 확인 후 다시 시도.
      </div>
    );
  }
  const crawled = meta ? formatDateKr(meta.crawledAt.slice(0, 10)) : "";
  const next = meta ? formatDateKr(meta.nextUpdateAt.slice(0, 10)) : "";
  return (
    <div className="bg-navy px-4 pb-2 text-[12px] tabular-nums text-white/80">
      {meta ? (
        <>
          데이터 기준: {crawled} 03:00 · 다음 갱신: {next}
        </>
      ) : (
        "데이터 기준일 확인 중"
      )}
    </div>
  );
}
