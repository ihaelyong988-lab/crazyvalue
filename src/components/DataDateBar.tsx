"use client";

import { formatDateKr, isFreshUpdate, seoulDateTime, updateDelay } from "@/lib/format";
import { useMeta } from "@/lib/use-meta";

// 기준일 바 — 주 1회 갱신의 신뢰 장치. 모든 화면 상단 상시 표기(§4.4-8).
// meta.json만 읽는다 — 물건 데이터 로드는 화면별 훅이 담당(§13 규칙 4).
// 역할 분리(감사 68·86): 이 바는 "값"만 말한다. 로드 실패의 안내·복구 버튼은 본문 ErrorState 1곳이 맡고
//   (그 다시 시도가 meta까지 재요청한다 — 감사 39), 바는 값 미표기 상태만 보여 2중 안내를 만들지 않는다.
export function DataDateBar() {
  const { meta, failed, pending, dropped } = useMeta();
  const stamp = meta ? seoulDateTime(meta.crawledAt) : null;
  const delay = meta ? updateDelay(meta.nextUpdateAt) : null;
  const nextDate = meta ? (seoulDateTime(meta.nextUpdateAt)?.date ?? null) : null;
  const pendingDate = pending ? (seoulDateTime(pending.crawledAt)?.date ?? null) : null;
  const fresh = meta ? isFreshUpdate(meta.crawledAt) : null;

  // 수집 시각은 crawledAt 실값을 쓴다 — 리터럴 03:00 하드코딩은 지연·수동 실행 주에 거짓이 된다(감사 38).
  // 예정일이 지났으면 예정일 대신 지연 일수를 말한다(감사 92) — 같은 줄에 둘 다 두지 않는다(1정보 1표시).
  const status = stamp
    ? `데이터 기준: ${formatDateKr(stamp.date)} ${stamp.time} · ${
        delay?.overdue
          ? delay.days >= 1
            ? `갱신 ${delay.days}일 지연`
            : "갱신 지연"
          : `다음 갱신: ${nextDate ? formatDateKr(nextDate) : "미정"}`
      }`
    : failed || meta // meta는 왔지만 시각을 읽지 못한 경우도 미확인이다 — 확인 중으로 위장하지 않는다
      ? "데이터 기준일 미확인"
      : "데이터 기준일 확인 중";

  return (
    <div className="bg-navy px-4 pb-2 text-[12px] leading-snug tabular-nums text-white/80">
      {/* 갱신 직후에는 기준일을 말하는 것만으로 부족하다 — 방문자가 "이번에 새로 들어왔다"를 인식해야 한다.
          배지는 기준일을 수식할 뿐 같은 값을 다시 쓰지 않는다(1정보 1표시). */}
      <p>
        {fresh && stamp && (
          <span className="mr-1.5 rounded bg-white px-1.5 py-0.5 font-semibold text-navy">
            새로 갱신
          </span>
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
