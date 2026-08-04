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
 * 산출물 상한 — 갱신 주기 내내 유효 물건이 남도록 매각기일별로 배분해 cap건을 선별한다.
 *
 * 단순 임박순 절단(직전 설계)은 갱신 주기와 무관하게 첫 기일에서 상한을 소진한다. 2026-08-02 실측:
 * 유효 9,359건 → 산출 1,000건이 전부 08-03 하루였고, 다음 갱신(08-09)까지 5일간 전 물건이
 * 기일 경과로 표시됐다. 상한이 하루 물량보다 작으면 "임박순 상위 N건"은 곧 "첫날 N건"이다.
 *
 * - windowEnd: 배분 창의 끝 날짜(YYYY-MM-DD, **미포함**). 이 날짜 이전 기일이 배분 1순위다.
 *   창은 갱신 주기가 아니라 상수(crawl-config OUTPUT_WINDOW_DAYS)로 정한다 — 갱신 주기를 쓰면
 *   매일 갱신에서 창이 하루로 붕괴해 위 결함이 그대로 재현된다.
 * - 배분은 물채우기(water-filling) — 얕은 기일이 남긴 몫은 다음 회차에서 다른 기일에 재분배된다.
 * - 기일 내 선별은 priceRatio 오름차순(저가 우선 = 앱 정체성) · 동일 비율은 id 순으로 결정적이다.
 * - 반환 배열은 기존 산출 계약대로 saleDate 오름차순·동일일 id 순이다. 입력 배열은 변형하지 않는다.
 */
export function capAcrossSaleDates<T extends { id: string; saleDate: string; priceRatio: number }>(
  items: readonly T[],
  cap: number,
  windowEnd: string,
): { capped: T[]; cappedFrom: number; dateSpread: number } {
  const byDate = new Map<string, T[]>();
  for (const item of items) {
    const list = byDate.get(item.saleDate);
    if (list) list.push(item);
    else byDate.set(item.saleDate, [item]);
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => a.priceRatio - b.priceRatio || a.id.localeCompare(b.id));
  }
  const dates = [...byDate.keys()].sort();
  const inWindow = dates.filter((d) => d < windowEnd);
  const beyond = dates.filter((d) => d >= windowEnd);
  const supply = (d: string): number => (byDate.get(d) as T[]).length;

  const quota = new Map<string, number>();
  let remaining = Math.max(0, cap);
  // 1순위: 갱신 주기 안의 기일에 균등 배분. share≥1이라 매 회차 remaining이 최소 1 줄어 종료가 보장된다.
  while (remaining > 0) {
    const open = inWindow.filter((d) => (quota.get(d) ?? 0) < supply(d));
    if (open.length === 0) break;
    const share = Math.max(1, Math.floor(remaining / open.length));
    for (const d of open) {
      if (remaining === 0) break;
      const add = Math.min(share, supply(d) - (quota.get(d) ?? 0), remaining);
      quota.set(d, (quota.get(d) ?? 0) + add);
      remaining -= add;
    }
  }
  // 2순위: 창 안을 다 채우고도 남으면 그 이후 기일을 임박순으로 채운다(앞으로의 기일 예고).
  for (const d of beyond) {
    if (remaining === 0) break;
    const add = Math.min(supply(d), remaining);
    quota.set(d, add);
    remaining -= add;
  }

  const capped: T[] = [];
  for (const d of dates) {
    const take = quota.get(d) ?? 0;
    if (take > 0) capped.push(...(byDate.get(d) as T[]).slice(0, take));
  }
  capped.sort((a, b) => a.saleDate.localeCompare(b.saleDate) || a.id.localeCompare(b.id));
  return {
    capped,
    cappedFrom: items.length,
    dateSpread: new Set(capped.map((i) => i.saleDate)).size,
  };
}

/**
 * 신규 건수 — 이번 산출 id 중 직전 산출물에 없던 것의 수(새로 유입된 물건).
 * 비교 기준이 없을 때(첫 실행·부분 수집) 무엇을 기록할지는 호출부가 정한다 — 이 함수는 두 집합만 본다.
 */
export function countNewIds(previousIds: ReadonlySet<string>, currentIds: ReadonlySet<string>): number {
  let count = 0;
  for (const id of currentIds) {
    if (!previousIds.has(id)) count++;
  }
  return count;
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
