import { describe, expect, it } from "vitest";
import { parseSearchPage } from "../../scripts/crawl";
import { collectPaginatedRows, IncompletePaginationError } from "../../scripts/crawl-pagination";

describe("법원 목록 응답 계약", () => {
  it("문자열 숫자와 선택적인 echo를 검증 가능한 숫자로 변환한다", () => {
    expect(parseSearchPage({ dlt_srchResult: [], dma_pageInfo: { totalCnt: "0", pageNo: "1", pageSize: "40", startRowNo: "1" } }))
      .toEqual({ rows: [], totalCnt: 0, pageNo: 1, pageSize: 40, startRowNo: 0 });
  });

  it("실측 응답의 시작행 1/41을 요청 비교 기준 0/40으로 정규화한다", () => {
    expect(parseSearchPage({ dlt_srchResult: [], dma_pageInfo: { totalCnt: "80", startRowNo: "41" } }).startRowNo).toBe(40);
    expect(Number.isNaN(parseSearchPage({ dlt_srchResult: [], dma_pageInfo: { totalCnt: "0", startRowNo: "0" } }).startRowNo)).toBe(true);
  });

  it.each([undefined, null, "", " ", "0x10", "1.5", -1, {}, true])("총계 %j를 0건이나 수신 행수로 대체하지 않는다", async (totalCnt) => {
    const page = parseSearchPage({ dlt_srchResult: [], dma_pageInfo: { totalCnt } });
    expect(Number.isNaN(page.totalCnt)).toBe(true);
    await expect(collectPaginatedRows(async () => page, { pageSize: 40, maxRepeatRetries: 0 }))
      .rejects.toBeInstanceOf(IncompletePaginationError);
  });

  it.each([
    { dma_pageInfo: { totalCnt: "0" } },
    { dlt_srchResult: {}, dma_pageInfo: { totalCnt: "0" } },
    { dlt_srchResult: [], dma_pageInfo: null },
    { dlt_srchResult: [], dma_pageInfo: [] },
  ])("원천 봉투 변경을 정상 빈 목록으로 오판하지 않는다", (data) => {
    expect(() => parseSearchPage(data)).toThrow();
  });
});
