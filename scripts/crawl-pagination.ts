import { createHash } from "node:crypto";
import { acceptPage, createListAccumulator, type ListAccumulator, type RawRow } from "./crawl-lib";

/** 검색 응답의 페이지 메타데이터는 실제로 제공된 필드만 검사한다. */
export interface PaginationPage {
  rows: RawRow[];
  totalCnt: number;
  pageNo?: number;
  /** 0-based로 정규화한 시작 위치. 공식 응답의 1-based startRowNo는 source parser가 변환한다. */
  startRowNo?: number;
  pageSize?: number;
}

export interface PaginationRequest {
  pageNo: number;
  pageSize: number;
  startRowNo: number;
  knownTotal: number;
  /** 최초 조회 1, 같은 페이지의 추가 조회 2·3. */
  attempt: number;
}

export interface AcceptedPageEvent {
  page: PaginationPage;
  request: PaginationRequest;
  pageNo: number;
  addedUnique: number;
  received: number;
  unique: number;
}

export interface PaginationRetryEvent {
  request: PaginationRequest;
  reason: string;
  nextAttempt: number;
  retries: number;
  rejectedRows: number;
}

export interface PaginationOptions {
  pageSize: number;
  maxPages?: number;
  /** 같은 페이지를 최대 두 번 추가 조회한다. 요청 예산·간격·timeout은 fetchPage가 집행한다. */
  maxRepeatRetries?: number;
  dryRun?: boolean;
  limit?: number | null;
  onAcceptedPage?: (event: AcceptedPageEvent) => void;
  onRetry?: (event: PaginationRetryEvent) => void;
}

export interface PaginationResult {
  accumulator: ListAccumulator;
  totalCnt: number;
  pageCount: number;
  retries: number;
  /** 재조회로 폐기한 행수. accumulator.received(수용한 페이지)에는 합산하지 않는다. */
  rejectedRows: number;
  complete: boolean;
  stopReason: "complete" | "dry-run" | "limit";
}

export class IncompletePaginationError extends Error {
  readonly pageNo: number;
  readonly received: number;
  readonly totalCnt: number | null;

  constructor(reason: string, pageNo: number, received: number, totalCnt: number | null) {
    super(`목록 완주 확인 실패 — ${pageNo}페이지 · 수용 ${received}건 · 서버 총 ${totalCnt ?? "미확인"}건 · ${reason}`);
    this.name = "IncompletePaginationError";
    this.pageNo = pageNo;
    this.received = received;
    this.totalCnt = totalCnt;
  }
}

/** 키 순서만 달라진 같은 응답도 잡되, 같은 물건의 서로 다른 원천 행은 합치지 않는다. */
function pageFingerprint(rows: readonly RawRow[]): string {
  const canonicalize = (_key: string, value: unknown) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
    }
    return value;
  };
  // 행 순서가 바뀌어도 같은 페이지다. 중복 행의 개수는 보존하고 입력 배열은 정렬하지 않는다.
  const canonical = rows.map((row) => JSON.stringify(row, canonicalize)).sort().join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

function validatePage(
  page: PaginationPage,
  request: PaginationRequest,
  received: number,
  knownTotal: number | null,
): string | null {
  if (!Array.isArray(page.rows)) return "목록 배열 결측";
  if (!Number.isInteger(page.totalCnt) || page.totalCnt < 0) return "서버 총계 결측 또는 비정상";
  if (knownTotal !== null && page.totalCnt !== knownTotal) {
    return `서버 총계 변동(${knownTotal} → ${page.totalCnt})`;
  }
  for (const field of ["pageNo", "pageSize", "startRowNo"] as const) {
    if (page[field] !== undefined && page[field] !== request[field]) {
      return `응답 ${field} 불일치(요청 ${request[field]} · 응답 ${page[field]})`;
    }
  }
  const expectedRows = Math.min(request.pageSize, page.totalCnt - received);
  if (expectedRows < 0 || page.rows.length !== expectedRows) {
    return `행 범위 불일치(시작 ${request.startRowNo} · 기대 ${Math.max(0, expectedRows)} · 응답 ${page.rows.length})`;
  }
  return null;
}

/**
 * 목록 전량 수신만 complete=true다. 원천 총계는 중복 포함 행수이므로 고유 건수와 비교하지 않는다.
 * 반복 페이지·총계/범위 이상은 같은 요청 페이지에서 두 번까지 추가 조회한 뒤 실패한다.
 * 실패는 결과를 반환하지 않는다 — 호출부가 기존 산출물을 유지하도록 예외를 전파해야 한다.
 * dry-run/limit으로 전량 수신 전에 멈췄을 때는 complete=false다. 작은 원천을 전량 수신했더라도
 * 호출부의 limit 절단은 진단 결과이므로 해당 CLI 옵션을 사용한 실행에서는 파일을 쓰면 안 된다.
 */
export async function collectPaginatedRows(
  fetchPage: (request: PaginationRequest) => Promise<PaginationPage>,
  options: PaginationOptions,
): Promise<PaginationResult> {
  const maxPages = options.maxPages ?? 600;
  const maxRepeatRetries = options.maxRepeatRetries ?? 2;
  if (!Number.isInteger(options.pageSize) || options.pageSize <= 0) throw new Error("pageSize는 양의 정수여야 한다.");
  if (!Number.isInteger(maxPages) || maxPages <= 0) throw new Error("maxPages는 양의 정수여야 한다.");
  if (!Number.isInteger(maxRepeatRetries) || maxRepeatRetries < 0 || maxRepeatRetries > 2) {
    throw new Error("같은 페이지 추가 조회는 0~2회만 허용한다.");
  }
  if (options.limit != null && (!Number.isInteger(options.limit) || options.limit <= 0)) {
    throw new Error("limit는 양의 정수여야 한다.");
  }

  const accumulator = createListAccumulator();
  const acceptedFingerprints = new Set<string>();
  let totalCnt: number | null = null;
  let retries = 0;
  let rejectedRows = 0;

  for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
    let acceptedPage: PaginationPage | null = null;
    for (let attempt = 1; attempt <= maxRepeatRetries + 1; attempt++) {
      const request: PaginationRequest = {
        pageNo,
        pageSize: options.pageSize,
        startRowNo: (pageNo - 1) * options.pageSize,
        knownTotal: totalCnt ?? 0,
        attempt,
      };
      const page = await fetchPage(request);
      let reason = validatePage(page, request, accumulator.received, totalCnt);
      const fingerprint = reason === null && page.rows.length > 0 ? pageFingerprint(page.rows) : null;
      if (fingerprint !== null && acceptedFingerprints.has(fingerprint)) reason = "수용한 페이지 전체의 반복 응답";
      if (reason !== null) {
        rejectedRows += Array.isArray(page.rows) ? page.rows.length : 0;
        if (attempt > maxRepeatRetries) {
          throw new IncompletePaginationError(reason, pageNo, accumulator.received, totalCnt);
        }
        retries++;
        options.onRetry?.({ request, reason, nextAttempt: attempt + 1, retries, rejectedRows });
        continue;
      }
      if (fingerprint !== null) acceptedFingerprints.add(fingerprint);
      totalCnt = page.totalCnt;
      const addedUnique = acceptPage(accumulator, page.rows);
      options.onAcceptedPage?.({ page, request, pageNo, addedUnique, received: accumulator.received, unique: accumulator.rows.length });
      acceptedPage = page;
      break;
    }

    // 위 반복문은 페이지를 수용하거나 예외로 끝난다. 이 가드는 타입 좁힘과 계약을 함께 보장한다.
    if (acceptedPage === null || totalCnt === null) {
      throw new IncompletePaginationError("페이지 미수용", pageNo, accumulator.received, totalCnt);
    }
    const complete = accumulator.received === totalCnt;
    const stopReason = complete ? "complete" : options.dryRun ? "dry-run" :
      options.limit != null && accumulator.rows.length >= options.limit ? "limit" : null;
    if (stopReason !== null) {
      return { accumulator, totalCnt, pageCount: pageNo, retries, rejectedRows, complete, stopReason };
    }
  }
  throw new IncompletePaginationError(`페이지 상한(${maxPages}) 도달`, maxPages, accumulator.received, totalCnt);
}
