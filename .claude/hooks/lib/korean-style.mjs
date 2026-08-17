// 한국어 문체 판정 — 이 저장소의 사용자 노출 문구는 **단정형**이 확정 문체다
// (AGENTS.md §1 정체성 · 컨셉 DNA "단정형 명세체": "…불러오지 못했다." · "…다시 시도하라.").
//
// 왜 게이트 본문이 아니라 별도 모듈인가:
//   2차 감사 63번이 "단정형 통일 + 게이트 문체 룰 연동"으로 처방됐는데, ui-quality-gate.mjs 의
//   R12 가 「습니다.…습니다.」 정규식에서 문장 수 판정으로 바뀌며 **문체 룰이 함께 사라졌고**
//   3차 감사에서 6개 화면에 같은 결함이 되살아났다. 규칙이 한 곳에만 있으면 그 곳이 바뀔 때
//   조용히 없어진다 → 판정을 단일 구현으로 떼어내고 게이트(R13)와 유닛 테스트가 **같은 함수**를
//   호출한다. 한쪽이 사라지면 다른 쪽이 죽어 사라진 사실이 드러난다.
//
// 오탐 차단:
//   ① 주석은 판정에서 뺀다(제품 문구가 아니다) — 블록 주석·`{/* */}` JSX 주석·줄 주석 제거.
//   ② 판정 대상은 문자열/템플릿 리터럴과 JSX 텍스트 노드뿐이다.
//   ③ 「아니다·다니다·지니다」는 합쇼체가 아니다 — 「니다」 앞 음절의 **종성이 ㅂ**일 때만 센다
//      (습니다·입니다·합니다·됩니다는 전부 앞 음절 종성이 ㅂ이고, 아니다는 종성이 없다).

/** 한글 음절 종성 ㅂ 의 인덱스. 음절 = 0xAC00 + (초성*21 + 중성)*28 + 종성. */
const JONGSEONG_BIEUP = 17;

/** 「습·입·합·됩」처럼 종성이 ㅂ인 음절인가 — 합쇼체 어간 말음 판정. */
function hasBieupFinal(ch) {
  const code = ch.codePointAt(0);
  if (code === undefined || code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 === JONGSEONG_BIEUP;
}

/** 주석 제거 — 판정은 제품 문구만 본다. `https://`의 `//`는 주석이 아니므로 앞 문자가 `:`이면 남긴다. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ") // 블록 주석 + {/* JSX 주석 */}
    .replace(/(^|[^:])\/\/[^\n]*/gm, "$1"); // 줄 주석
}

/**
 * 사용자에게 보이는 문구 후보를 뽑는다 — ① 문자열·템플릿 리터럴 ② JSX 텍스트 노드.
 * 변수·식별자는 애초에 대상이 아니고(이 저장소의 식별자는 영문이다), 주석은 앞서 제거된다.
 */
export function userFacingText(source) {
  const src = stripComments(source);
  const out = [];
  for (const m of src.matchAll(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g)) out.push(m[0]);
  // JSX 텍스트 노드: 여는 태그의 `>`와 다음 `<` 사이. 보간식({…})이 낀 구간은 건너뛴다 —
  // 보간 양옆 텍스트는 각각 다른 `>`…`<` 구간으로 다시 잡힌다.
  for (const m of src.matchAll(/>([^<>{}]*)</g)) out.push(m[1]);
  return out.filter((t) => /[가-힣]/.test(t)).map((t) => t.replace(/\s+/g, " ").trim());
}

/**
 * 습니다체·청유형 종결을 찾는다. 반환: `{ ending, text }[]` (ending = 잡힌 종결 어미, text = 그 문구).
 * 비어 있으면 단정형이다.
 */
export function politeFormHits(source) {
  const hits = [];
  for (const text of userFacingText(source)) {
    // 합쇼체 평서·의문·청유: 습니다 · 입니다 · 합니다 · 됩니다 · 합니까 · 합시다
    for (const m of text.matchAll(/[가-힣](?:니다|니까|시다)/g)) {
      if (hasBieupFinal(m[0][0])) hits.push({ ending: m[0], text });
    }
    // 해요체·합쇼체 존대 명령: 하세요 · 해주세요 · 하십시오
    for (const m of text.matchAll(/[가-힣]세요|십시오/g)) hits.push({ ending: m[0], text });
  }
  return hits;
}
