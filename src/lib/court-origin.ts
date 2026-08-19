import { COURT_SELECT_OPTIONS } from "./court-select-options";

/**
 * 법원 원문 도달 — 목적지 URL·법원 표기·복사값을 한곳에서 정한다(AGENTS §2-2 조문 6).
 *
 * 사건 단위 딥링크는 없다(`docs/CRAWLER.md` §4.1). 그래서 목적지는 **최상단 컨테이너 화면**이어야 한다.
 * 법원 사이트(WebSquare)의 화면 ID에는 규칙이 있다 — `…F00`/`…M00`은 최상단(`scwin.isMain → true`,
 * 헤더·본문 프레임을 스스로 구성), `…F01`/`…M01`은 **부모가 사건 파라미터를 넣어 줘야 뜨는 자식 화면**이다.
 * 자식 화면으로 직접 들어가면 `$p.getParameter("param")`이 비고 최상단 전역(`scglblo`) 조회가 실패해
 * 오류창 "부모 객체를 찾을 수 없습니다."가 뜨고, 닫아도 법원·사건번호가 빈 화면이 남는다
 * (2026-08-20 실측 — 이전 목적지 `PGJ15AF01.xml`이 그 자식 화면이었다. AGENTS §9 참조).
 *
 * 원문 링크는 물건마다 다르지 않으므로 데이터 필드가 아니라 이 상수를 렌더한다 —
 * 데이터에 박힌 URL은 다음 수집까지 낡은 값으로 남아 배포와 어긋난다.
 */
export const COURT_ORIGIN_URL =
  "https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ159M00.xml";

/**
 * 우리 표기 → 법원 선택 목록 표기.
 *
 * 우리는 본원을 붙여 쓰고(`대전지방법원 천안지원`) 법원은 지원명만 쓰거나(`천안지원`) 본원을 앞에 붙여
 * 한 낱말로 쓴다(`부산서부지원`). 어긋나면 안내가 지목하는 항목이 목록에 없어 방문자가 60개를 훑는다.
 *
 * **표가 아니라 규칙이다.** 처음엔 어긋난 10종을 손으로 적었는데, 다음 수집(2026-08-20)에 11종이 새로
 * 들어와 게이트가 곧바로 빨강이 됐다 — 지원 20곳은 물건이 있는 주에만 데이터에 나타나므로 표는 매주
 * 낡는다. 그래서 두 형태를 규칙으로 처리한다:
 *   ① `X지방법원 Y지원` → `Y지원`            (대부분)
 *   ② ①이 목록에 없으면 `XY지원`으로 결합    (부산서부지원·대구서부지원·부산동부지원)
 * 후보는 **실물 목록에 있을 때만** 채택한다 — 규칙이 못 맞춘 표기는 그대로 남아 전건 대조에서
 * 빨강이 된다(fail-closed). 조용히 틀린 이름을 지목하는 것보다 게이트가 멈추는 편이 낫다.
 */
const AMBIGUOUS_COURT_LABEL: Readonly<Record<string, string>> = {
  // 본원 없는 폴백 표기(`crawl.ts`의 `jiwonNm` 경로) — 서울동부·부산동부가 모두 있어 이름만으로는
  // 특정되지 않는다. 데이터상 전부 부산이며, 그 가정이 깨지면 유닛 게이트가 잡는다(백로그 118 참조).
  동부지원: "부산동부지원",
};

/** 법원 선택 목록에서 방문자가 골라야 하는 이름. 못 맞추면 우리 표기를 그대로 돌려준다(게이트가 잡는다). */
export function siteCourtLabel(court: string): string {
  const options: readonly string[] = COURT_SELECT_OPTIONS;
  if (options.includes(court)) return court;
  const ambiguous = AMBIGUOUS_COURT_LABEL[court];
  if (ambiguous !== undefined) return ambiguous;
  const m = /^(\S+?)지방법원\s+(\S+지원)$/.exec(court);
  if (m === null) return court;
  const [, head, branch] = m;
  if (options.includes(branch)) return branch;
  const joined = `${head}${branch}`;
  return options.includes(joined) ? joined : court;
}

/**
 * 사건번호 → 연도·번호. 원문 화면은 연도를 선택 목록에서, 번호를 입력칸에서 따로 받는다.
 * 입력칸은 `maxlength="7"`에 한글을 지우므로 `2023타경104819`를 붙여넣으면 `20231`만 남아 검색이 실패한다
 * (2026-08-20 실측). 그래서 복사값은 **번호 단독**이다. 형식 밖 사건번호는 null → 호출부가 전체를 쓴다.
 */
export function splitCaseNo(caseNo: string): { year: string; no: string } | null {
  const m = /^(\d{4})타경(\d+)$/.exec(caseNo);
  return m === null ? null : { year: m[1], no: m[2] };
}

/** 복사 대상 문자열 — 번호 단독(분해 불가 시 사건번호 전체). */
export function copyableCaseNo(caseNo: string): string {
  return splitCaseNo(caseNo)?.no ?? caseNo;
}
