"use client";

import { formatDateKr, formatMonthDayKr, seoulDateTime } from "@/lib/format";
import { useMeta } from "@/lib/use-meta";

// 기준일 바 — 매일 03:00 갱신의 신뢰 장치. 모든 화면 상단 상시 표기(§4.4-8).
// meta.json만 읽는다 — 물건 데이터 로드는 화면별 훅이 담당(§13 규칙 4).
// 역할 분리(감사 68·86): 이 바는 "값"만 말한다. 로드 실패의 안내·복구 버튼은 본문 ErrorState 1곳이 맡고
//   (그 다시 시도가 meta까지 재요청한다 — 감사 39), 바는 값 미표기 상태만 보여 2중 안내를 만들지 않는다.
export function DataDateBar() {
  const { meta, failed, pending, dropped } = useMeta();
  const stamp = meta ? seoulDateTime(meta.crawledAt) : null;
  const pendingDate = pending ? (seoulDateTime(pending.crawledAt)?.date ?? null) : null;
  const newCount = meta?.newCount;

  // 수집 시각은 crawledAt 실값을 쓴다 — 리터럴 03:00 하드코딩은 지연·수동 실행 주에 거짓이 된다(감사 38).
  // 신규 건수는 직전 산출물과의 비교값이라 비교 대상이 없으면 부재다 — 그때는 0건으로 단정하지 않고 감춘다.
  // 0건도 같이 감춘다: 표시할 값이 없는 것과 같고, "새로 갱신" 배지 옆의 "신규 0건"은 모순으로 읽힌다.
  const status = stamp
    ? `${formatMonthDayKr(stamp.date)} ${stamp.time}${newCount ? ` · 신규 ${newCount}건` : ""}`
    : failed || meta // meta는 왔지만 시각을 읽지 못한 경우도 미확인이다 — 확인 중으로 위장하지 않는다
      ? "데이터 기준일 미확인"
      : "데이터 기준일 확인 중";

  return (
    <div className="bg-navy px-4 pb-2 text-[12px] leading-snug tabular-nums text-white/80">
      {/* 배지는 수집 시각·신규 건수를 수식할 뿐 같은 값을 다시 쓰지 않는다(1정보 1표시).
          신선도 판정은 두지 않는다 — 매일 03:00에 갱신되므로 조건부 노출은 배지가 사라진 날에만
          의미를 갖고, 그날은 이미 시각 자체가 낡음을 말한다. 다만 시각을 읽지 못한 상태에는 붙이지
          않는다: 미확인 옆의 "새로 갱신"은 근거 없는 단정이다. */}
      <p>
        {stamp && (
          <>
            <span className="mr-1.5 rounded bg-white px-1.5 py-0.5 font-semibold text-navy">
              새로 갱신
            </span>
            {/* 낭독 시 "새로 갱신08-03"으로 붙지 않게 텍스트 노드로 띄운다(시각 간격은 mr-1.5). */}{" "}
          </>
        )}
        {status}
      </p>
      {/* 세션 중 발생하는 알림 자리 — 비어 있어도 유지해야 삽입 시점에 낭독된다. */}
      <div role="status">
        {dropped > 0 && <p className="mt-0.5">형식 오류 {dropped}건 제외</p>}
        {pendingDate && (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-1 flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-white/40 px-3 text-left text-white transition-colors duration-200 hover:bg-white/10"
          >
            <span>새 기준일 {formatDateKr(pendingDate)} 공개</span>
            <span className="font-semibold">새로고침</span>
          </button>
        )}
      </div>
    </div>
  );
}
