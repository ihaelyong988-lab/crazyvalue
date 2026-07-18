import { LegalNotice } from "@/components/LegalNotice";
import { PickBadge } from "@/components/PickBadge";

// 용어·고지 시트(§4.1 시트 B) — 부록 B 원고. 용어 12개 + 미친가치 픽 기준 공개 + 법적 고지 전문.
const TERMS: { term: string; desc: string }[] = [
  { term: "유찰", desc: "매각기일에 입찰자가 없어 매각이 되지 않은 것. 다음 기일에 최저가가 내려간다" },
  { term: "감정가", desc: "법원이 감정평가로 정한 물건의 기준 가격. 첫 회차의 최저매각가격" },
  { term: "최저매각가격(최저가)", desc: "그 회차에 입찰할 수 있는 가장 낮은 금액. 유찰 시 법원별로 20~30%씩 저감" },
  { term: "매각기일", desc: "법원에서 입찰을 실시하는 날" },
  { term: "입찰보증금", desc: "입찰 시 내는 보증금. 통상 최저가의 10%(재매각 사건은 다를 수 있음)" },
  { term: "사건번호", desc: "경매 사건의 고유 번호(예: 2025타경12345). 원문 확인의 열쇠" },
  { term: "물건번호", desc: "한 사건에 물건이 여러 개일 때의 일련번호" },
  { term: "재매각", desc: "낙찰자가 대금을 내지 않아 다시 진행하는 매각" },
  { term: "권리분석", desc: "낙찰 후 인수하는 권리(임차인·유치권 등)를 따지는 일 — 본 앱 범위 밖, 전문가 확인 필요" },
  { term: "대항력 있는 임차인", desc: "낙찰자가 보증금을 인수할 수 있는 임차인 — 원문 확인 필수 항목" },
  { term: "매각물건명세서", desc: "법원이 제공하는 물건의 공식 명세 — 입찰 전 필독 문서" },
  { term: "배당요구종기", desc: "채권자가 배당을 요구할 수 있는 마감일" },
];

export function GlossarySheet() {
  return (
    <div className="space-y-5 p-4">
      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="flex items-center gap-2 font-bold">
          <PickBadge /> 기준 공개
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ink/85">
          현재 최저가가 감정가의 <b>50% 이하</b>로 내려온 물건에 붙는 배지다. 가격
          사실 기준이며 투자 권유가 아니다. 유찰 2회 물건의 최저가는 법원 저감률에
          따라 감정가의 49%(30% 저감)~64%(20% 저감)가 된다.
        </p>
      </section>

      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="font-bold">경매 용어 풀이</h2>
        <dl className="mt-3 space-y-3">
          {TERMS.map((t) => (
            <div key={t.term}>
              <dt className="font-semibold text-[14px]">{t.term}</dt>
              <dd className="mt-0.5 text-[13px] leading-relaxed text-ink/75">{t.desc}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="font-bold">데이터 안내</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-ink/75">
          <li>수집 대상: 법원경매정보의 전국 진행 물건 중 유찰 2회 이상</li>
          <li>갱신: 매주 일요일 03:00. 모든 화면에 데이터 기준일을 표기한다</li>
          <li>저감률은 법원별로 20% 또는 30%로 다르며, 본 앱은 임의 계산하지 않는다</li>
          <li>관심함은 이 기기에만 저장된다(무가입). 기기 변경 시 이전되지 않는다</li>
        </ul>
      </section>

      <section aria-label="법적 고지">
        <LegalNotice />
      </section>
    </div>
  );
}
