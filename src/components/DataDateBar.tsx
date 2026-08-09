import { formatMonthDayKr, seoulDateTime } from "@/lib/format";
import { buildMeta } from "@/lib/build-meta";
import { DataDateNotice } from "@/components/DataDateNotice";

// 기준일 바 — 매일 03:00 갱신의 신뢰 장치. 모든 화면 상단 상시 표기(§4.4-8).
//
// 서버 컴포넌트다. 날짜는 빌드 산출물에서 온다(build-meta.ts) — 네트워크를 타지 않는다.
// 예전에는 클라이언트가 /data/meta.json을 fetch했고, 서비스워커가 옛 값을 돌려준 첫 화면이
// 영구히 굳었다(2026-08-09 재현 확정). 받아올 게 없으면 굳을 것도 없다.
// 오프라인이면 서비스워커가 옛 HTML을 열어 옛 날짜를 보여준다 — 그건 정확한 표기다.
// 그 HTML이 실제로 그 시점의 산출물이기 때문이다.
export function DataDateBar() {
  const stamp = seoulDateTime(buildMeta.crawledAt);
  const newCount = buildMeta.newCount;

  // 신규 건수는 직전에도 수집 대상이던 매각기일에서 새로 등장한 물건 수다(집계 정의는 crawl-lib
  // countNewOnSharedDates — 배분 창이 하루 굴러 들어온 기일은 제외한다). 근거가 없으면 부재다 —
  // 0건도 같이 감춘다: "새로 갱신" 배지 옆의 "신규 0건"은 모순으로 읽힌다.
  const status = stamp
    ? `${formatMonthDayKr(stamp.date)} ${stamp.time}${newCount ? ` · 신규 ${newCount}건` : ""}`
    : "데이터 기준일 미확인";

  return (
    <div className="bg-navy px-4 pb-2 text-[12px] leading-snug tabular-nums text-white/80">
      {/* 배지는 수집 시각·신규 건수를 수식할 뿐 같은 값을 다시 쓰지 않는다(1정보 1표시).
          신선도 판정은 두지 않는다 — 매일 갱신이므로 조건부 노출은 배지가 사라진 날에만 의미를
          갖고, 그날은 이미 시각 자체가 낡음을 말한다. 시각을 읽지 못한 상태에는 붙이지 않는다. */}
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
      <DataDateNotice baked={buildMeta.crawledAt} />
    </div>
  );
}
