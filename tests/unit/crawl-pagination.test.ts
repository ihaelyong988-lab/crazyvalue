import { describe, expect, it, vi } from "vitest";
import { acceptPage, createListAccumulator, isStalled, type RawRow } from "../../scripts/crawl-lib";
import {
  collectPaginatedRows,
  IncompletePaginationError,
  type AcceptedPageEvent,
  type PaginationPage,
  type PaginationRequest,
} from "../../scripts/crawl-pagination";

function row(index: number, extra: RawRow = {}): RawRow {
  return { boCd: "B000210", printCsNo: `2026타경${index}`, maemulSer: "1", ...extra };
}

const page = (rows: RawRow[], totalCnt: number, echo: Partial<PaginationPage> = {}): PaginationPage => ({
  rows,
  totalCnt,
  ...echo,
});

describe("목록 페이지 완주 — raw 행 범위·총계와 중복 제거를 분리", () => {
  it("마지막 짧은 페이지까지 수용한 raw 범위가 총계에 맞으면 완주한다(응답 echo는 선택)", async () => {
    const fetch = vi.fn(async ({ pageNo }: PaginationRequest) =>
      page(pageNo === 1 ? [row(1), row(2)] : [row(3)], 3),
    );
    const accepted: AcceptedPageEvent[] = [];
    const result = await collectPaginatedRows(fetch, { pageSize: 2, onAcceptedPage: (event) => accepted.push(event) });
    expect(result.complete).toBe(true);
    expect(result.stopReason).toBe("complete");
    expect(result.accumulator.received).toBe(3);
    expect(result.accumulator.rows).toHaveLength(3);
    expect(result.pageCount).toBe(2);
    expect(fetch.mock.calls.map(([request]) => [request.pageNo, request.startRowNo, request.knownTotal])).toEqual([
      [1, 0, 0], [2, 2, 3],
    ]);
    expect(accepted.map(({ pageNo, addedUnique, received, unique }) => [pageNo, addedUnique, received, unique])).toEqual([
      [1, 2, 2, 2], [2, 1, 3, 3],
    ]);
  });

  it("같은 물건의 서로 다른 원천 행은 수용한다 — 고유 건수가 총계보다 작아도 전량 수신이다", async () => {
    const fetch = vi.fn(async ({ pageNo }: PaginationRequest) =>
      page([row(1, { printSt: `원천 행 ${pageNo}-1` }), row(2, { printSt: `원천 행 ${pageNo}-2` })], 4),
    );
    const result = await collectPaginatedRows(fetch, { pageSize: 2 });
    expect(result.complete).toBe(true);
    expect(result.accumulator.received).toBe(4);
    expect(result.accumulator.rows).toHaveLength(2);
    expect(result.retries).toBe(0);
  });

  it("총계 0·빈 목록은 완주한 빈 원천이다", async () => {
    const result = await collectPaginatedRows(async () => page([], 0), { pageSize: 40 });
    expect(result.complete).toBe(true);
    expect(result.accumulator.received).toBe(0);
    expect(result.totalCnt).toBe(0);
  });

  it("마지막 페이지가 pageSize를 채워도 raw 총계를 모두 채우면 추가 조회하지 않는다", async () => {
    const fetch = vi.fn(async ({ pageNo }: PaginationRequest) => page([row(pageNo * 2), row(pageNo * 2 + 1)], 4));
    const result = await collectPaginatedRows(fetch, { pageSize: 2, maxPages: 2 });
    expect(result.complete).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("반복 페이지 — 현재 페이지에서 제한된 회복·폐기행 별도 집계", () => {
  it("일시적인 반복이 회복되면 해당 페이지를 한 번만 수용하고 다음 페이지로 진행한다", async () => {
    const fetch = vi.fn(async ({ pageNo, attempt }: PaginationRequest) => {
      if (pageNo === 2 && attempt === 1) return page([row(1), row(2)], 6);
      return page([row(pageNo * 2 - 1), row(pageNo * 2)], 6);
    });
    const onAcceptedPage = vi.fn();
    const onRetry = vi.fn();
    const result = await collectPaginatedRows(fetch, { pageSize: 2, onAcceptedPage, onRetry });
    expect(result.complete).toBe(true);
    expect(result.accumulator.received).toBe(6);
    expect(result.accumulator.rows).toHaveLength(6);
    expect(result.retries).toBe(1);
    expect(result.rejectedRows).toBe(2);
    expect(onAcceptedPage).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ nextAttempt: 2, retries: 1, rejectedRows: 2 });
    expect(fetch.mock.calls.map(([request]) => [request.pageNo, request.startRowNo, request.attempt])).toEqual([
      [1, 0, 1], [2, 2, 1], [2, 2, 2], [3, 4, 1],
    ]);
  });

  it("지속 반복은 같은 페이지 두 번 추가 조회 후 실패하며 다음 페이지나 부분 결과를 반환하지 않는다", async () => {
    const fetch = vi.fn<(request: PaginationRequest) => Promise<PaginationPage>>(async () => page([row(1), row(2)], 6));
    const onAcceptedPage = vi.fn();
    const onRetry = vi.fn();
    await expect(collectPaginatedRows(fetch, { pageSize: 2, onAcceptedPage, onRetry })).rejects.toMatchObject({
      name: "IncompletePaginationError", pageNo: 2, received: 2, totalCnt: 6,
    });
    expect(fetch).toHaveBeenCalledTimes(4); // 첫 페이지 + 두 번째 페이지 최초/추가 2회
    expect(onAcceptedPage).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([request]) => request.pageNo)).toEqual([1, 2, 2, 2]);
  });

  it("행/객체 키 순서가 달라져도 같은 페이지 전체의 재서빙을 감지한다", async () => {
    const initial = [row(1, { nested: { a: 1, b: 2 } }), row(2)];
    const reordered = [row(2), { nested: { b: 2, a: 1 }, maemulSer: "1", printCsNo: "2026타경1", boCd: "B000210" }];
    const fetch = vi.fn(async ({ pageNo }: PaginationRequest) => page(pageNo === 1 ? initial : reordered, 4));
    await expect(collectPaginatedRows(fetch, { pageSize: 2 })).rejects.toThrow("반복 응답");
    expect(initial.map((value) => value.printCsNo)).toEqual(["2026타경1", "2026타경2"]);
  });

  it("회귀: 서버 총 20725·63페이지 수신2520·고유1865의 옛 stall 성공을 실패로 바꾼다", async () => {
    // run 37151202075/job 111285292857 로그와 같은 단계 수치의 합성 fixture. 실제 원천 본문은 없다.
    const pages: RawRow[][] = [];
    let next = 1;
    for (let p = 1; p <= 58; p++) {
      const fresh = p <= 45 ? 40 : 5;
      const rows = Array.from({ length: fresh }, () => row(next++));
      while (rows.length < 40) rows.push(row(rows.length));
      pages.push(rows);
    }
    for (let p = 59; p <= 63; p++) pages.push(pages[57]);
    const legacy = createListAccumulator();
    pages.forEach((rows) => acceptPage(legacy, rows));
    expect(legacy.received).toBe(2520);
    expect(legacy.rows).toHaveLength(1865);
    expect(isStalled(legacy)).toBe(true); // 옛 crawl.ts는 여기서 정상 break를 했다.

    const fetch = vi.fn(async ({ pageNo }: PaginationRequest) => page(pages[pageNo - 1], 20725));
    await expect(collectPaginatedRows(fetch, { pageSize: 40 })).rejects.toMatchObject({
      name: "IncompletePaginationError", pageNo: 59, received: 2320, totalCnt: 20725,
    });
    expect(fetch).toHaveBeenCalledTimes(61); // 58페이지 수용 + 반복된 59페이지 최초/추가 2회
  });
});

describe("페이지 프로토콜 이상은 성공/부분 완료로 강등하지 않는다", () => {
  it.each([
    ["총계 결측", Number.NaN],
    ["총계 음수", -1],
    ["총계 비정수", 2.5],
  ])("%s은 첫 페이지에서도 최대 3회 조회 후 실패한다", async (_label, totalCnt) => {
    const fetch = vi.fn(async () => page([row(1), row(2)], totalCnt));
    await expect(collectPaginatedRows(fetch, { pageSize: 2 })).rejects.toThrow(IncompletePaginationError);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("서버 총계 전에 짧은 페이지가 오면 재조회하며 계속 짧으면 실패한다", async () => {
    const fetch = vi.fn(async ({ pageNo }: PaginationRequest) => page(pageNo === 1 ? [row(1), row(2)] : [], 6));
    await expect(collectPaginatedRows(fetch, { pageSize: 2 })).rejects.toThrow("행 범위 불일치");
    expect(fetch.mock.calls.map(([request]) => request.pageNo)).toEqual([1, 2, 2, 2]);
  });

  it("짧은 페이지가 같은 요청에서 올바른 범위로 회복되면 누락 없이 완주한다", async () => {
    const fetch = vi.fn(async ({ pageNo, attempt }: PaginationRequest) => {
      if (pageNo === 2 && attempt === 1) return page([row(3)], 4);
      return page(pageNo === 1 ? [row(1), row(2)] : [row(3), row(4)], 4);
    });
    const result = await collectPaginatedRows(fetch, { pageSize: 2 });
    expect(result.complete).toBe(true);
    expect(result.accumulator.received).toBe(4);
    expect(result.rejectedRows).toBe(1);
  });

  it("총계 변동을 기존 snapshot보다 작은 완주 총계로 바꾸지 않는다", async () => {
    const fetch = vi.fn(async ({ pageNo }: PaginationRequest) => page([row(pageNo * 2), row(pageNo * 2 + 1)], pageNo === 1 ? 6 : 4));
    await expect(collectPaginatedRows(fetch, { pageSize: 2 })).rejects.toThrow("서버 총계 변동");
    expect(fetch.mock.calls.slice(1).map(([request]) => request.knownTotal)).toEqual([6, 6, 6]);
  });

  it.each(["pageNo", "pageSize", "startRowNo"] as const)("응답이 제공한 %s가 요청과 다르면 실패한다", async (field) => {
    const fetch = vi.fn(async (request: PaginationRequest) => page([row(1), row(2)], 2, { [field]: request[field] + 1 }));
    await expect(collectPaginatedRows(fetch, { pageSize: 2 })).rejects.toThrow(`응답 ${field} 불일치`);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("페이지 상한 전에 전체를 받지 못하면 실패한다", async () => {
    const fetch = vi.fn(async ({ pageNo }: PaginationRequest) => page([row(pageNo * 2), row(pageNo * 2 + 1)], 6));
    await expect(collectPaginatedRows(fetch, { pageSize: 2, maxPages: 2 })).rejects.toMatchObject({
      name: "IncompletePaginationError", pageNo: 2, received: 4, totalCnt: 6,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("HTTP/예산 예외는 재조회 루프에 태우지 않고 그대로 전파한다", async () => {
    const failure = new Error("목록 요청 예산 소진");
    const fetch = vi.fn(async () => { throw failure; });
    await expect(collectPaginatedRows(fetch, { pageSize: 2 })).rejects.toBe(failure);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("명시적인 진단 부분 조회", () => {
  it.each([
    [{ dryRun: true }, "dry-run"],
    [{ limit: 1 }, "limit"],
  ] as const)("%o는 완주와 구분해 complete=false를 반환한다", async (partial, reason) => {
    const fetch = vi.fn(async () => page([row(1), row(2)], 6));
    const result = await collectPaginatedRows(fetch, { pageSize: 2, ...partial });
    expect(result.complete).toBe(false);
    expect(result.stopReason).toBe(reason);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("dry-run도 잘못된 첫 페이지를 정상 부분 조회로 처리하지 않는다", async () => {
    const fetch = vi.fn(async () => page([], 6));
    await expect(collectPaginatedRows(fetch, { pageSize: 2, dryRun: true })).rejects.toThrow("행 범위 불일치");
  });
});
