/**
 * 수집 파이프라인 순수 헬퍼 — crawl.ts에서 분리한 신규 로직(테스트 가능성 목적).
 *
 * 설계 기준(2026-07-30): "오류 0건이어야 배포" → "유효 부분집합은 항상 배포".
 * 이상 데이터는 개별 드롭+카운트 로깅으로 강등하고, 전체 기각은 "유효 0건"일 때만 한다(crawl.ts 게이트).
 * 실패 시 기존 파일 무변경(무커밋) 계약은 불변.
 *
 * 배경(07-28·07-29 실측):
 * - 서버가 야간 배치 중 목록의 같은 행을 재서빙한다(같은 id 최대 154회) → 수신 시점 dedupe(seenRowKeys).
 * - 중복 포함 누적 행수 >= totalCnt 종결 판정은 재서빙 구간에서 영원히 미달할 수 있다 → 정체 종결(stallPages).
 * - 오류 1건 전량 기각 게이트가 고유 약 9,400건을 중복 7,044건 때문에 전량 폐기했다 → 드롭 강등 게이트.
 */

export type RawRow = Record<string, unknown>;

const rowStr = (row: RawRow, key: string): string => {
  const v = row[key];
  return v == null ? "" : String(v).trim();
};

/**
 * 목록 행 키 — 기존 id(`regionKey-caseNo-itemNo`) 유도와 동일 원천 필드를 쓴다:
 * 사건번호(printCsNo의 `\d{4}타경\d+`, 결측 시 srnSaNo·saNo)·물건번호(maemulSer)·법원(boCd).
 * id의 regionKey는 주소 해석이 필요해 목록 수신 시점 키로는 법원코드(boCd)를 쓴다.
 * 식별 불가(사건번호·물건번호 결측)면 null — 중복 판정 없이 수용한다(mapRow가 결측 사유로 거른다).
 */
export function deriveRowKey(row: RawRow): string | null {
  const caseNo =
    /\d{4}타경\d+/.exec(rowStr(row, "printCsNo"))?.[0] || rowStr(row, "srnSaNo") || rowStr(row, "saNo");
  const itemNo = rowStr(row, "maemulSer");
  if (!caseNo || !itemNo) return null;
  return `${rowStr(row, "boCd")}-${caseNo}-${itemNo}`;
}

/** 연속 신규 고유 0건 페이지가 이 수에 도달하면 목록을 정상 종결한다(서버 꼬리 반복 대응). */
export const STALL_PAGE_LIMIT = 5;

/** 목록 수신 누적기 — seenRowKeys로 첫 등장만 축적한다. 종결 판정의 누적 행수는 자연히 고유 건수가 된다. */
export interface ListAccumulator {
  /** 첫 등장 행만 축적한 고유 목록 */
  rows: RawRow[];
  /** 이미 수신한 행 키 집합 */
  seenRowKeys: Set<string>;
  /** 수신 총 행수(중복 포함) — 수집 요약용 */
  received: number;
  /** 연속 신규 고유 0건 페이지 수 — STALL_PAGE_LIMIT 도달 시 정체 종결 */
  stallPages: number;
}

export function createListAccumulator(): ListAccumulator {
  return { rows: [], seenRowKeys: new Set(), received: 0, stallPages: 0 };
}

/** 페이지 1개를 수용하고 신규 고유 행수를 돌려준다. stallPages를 갱신한다. */
export function acceptPage(acc: ListAccumulator, pageRows: readonly RawRow[]): number {
  let added = 0;
  for (const row of pageRows) {
    acc.received++;
    const key = deriveRowKey(row);
    if (key !== null) {
      if (acc.seenRowKeys.has(key)) continue;
      acc.seenRowKeys.add(key);
    }
    acc.rows.push(row);
    added++;
  }
  acc.stallPages = added === 0 ? acc.stallPages + 1 : 0;
  return added;
}

/** 정체 종결 판정 — 연속 STALL_PAGE_LIMIT 페이지 신규 고유 0건이면 참(오류가 아니라 정상 종결). */
export function isStalled(acc: ListAccumulator): boolean {
  return acc.stallPages >= STALL_PAGE_LIMIT;
}

export interface GateResult<T> {
  valid: T[];
  /** 검증(zod) 실패로 드롭한 건수 */
  invalidDropped: number;
  /** 중복 id로 드롭한 건수(첫 등장 유지) */
  dupDropped: number;
}

/**
 * 검증 게이트 — 순회하며 ① 검증 실패 → 드롭+invalidDropped++ ② 중복 id → 드롭+dupDropped++(첫 등장 유지).
 * 유효 부분집합만 돌려준다. 전체 기각(exit 1)은 호출부가 "유효 0건"일 때만 한다.
 */
export function gateItems<T extends { id: string }>(
  items: readonly T[],
  isValid: (item: T) => boolean,
): GateResult<T> {
  const valid: T[] = [];
  const ids = new Set<string>();
  let invalidDropped = 0;
  let dupDropped = 0;
  for (const item of items) {
    if (!isValid(item)) {
      invalidDropped++;
      continue;
    }
    if (ids.has(item.id)) {
      dupDropped++;
      continue;
    }
    ids.add(item.id);
    valid.push(item);
  }
  return { valid, invalidDropped, dupDropped };
}

/**
 * 산출물 상한 — 매각기일 임박순(saleDate 오름차순, 동일일은 id 순 안정 정렬) 상위 cap건만 선별한다.
 * cappedFrom = 상한 적용 전 유효 건수(meta 기록용). 입력 배열은 변형하지 않는다.
 */
export function capBySaleDate<T extends { id: string; saleDate: string }>(
  items: readonly T[],
  cap: number,
): { capped: T[]; cappedFrom: number } {
  const sorted = [...items].sort(
    (a, b) => a.saleDate.localeCompare(b.saleDate) || a.id.localeCompare(b.id),
  );
  return { capped: sorted.slice(0, cap), cappedFrom: items.length };
}

export interface CollectSummary {
  /** 목록 수신 총 행수(중복 포함) */
  received: number;
  /** 목록 dedupe 후 고유 행수 */
  unique: number;
  /** 중복 드롭 합계(목록 dedupe + 게이트 중복 id) */
  dupDropped: number;
  /** 검증 실패 드롭 */
  invalidDropped: number;
  /** 상한 적용 전 유효 건수 */
  cappedFrom: number;
  /** 최종 산출 건수 */
  output: number;
}

/** 수집 요약 1줄 — 마감 직전 로그. 형식 고정(기계 대조용). */
export function buildSummaryLine(s: CollectSummary): string {
  return (
    `수집 요약 — 수신 ${s.received} · 고유 ${s.unique} · 중복드롭 ${s.dupDropped} · ` +
    `무효드롭 ${s.invalidDropped} · 상한적용 ${s.cappedFrom}→${s.output}`
  );
}
