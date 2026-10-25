import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { AuctionItem } from "@/types/auction";

const originalCwd = process.cwd();
const prefix = "crazyvalue-provenance-";
let fixtureDir: string;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T00:00:00Z"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  fixtureDir = mkdtempSync(join(tmpdir(), prefix));
  process.chdir(fixtureDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  const target = resolve(fixtureDir);
  expect(dirname(target)).toBe(resolve(tmpdir()));
  expect(basename(target).startsWith(prefix)).toBe(true);
  rmSync(target, { recursive: true, force: true });
});

describe("수집 산출물의 출처 — 합성 응답만 사용", () => {
  it.each(["none", "complete", "partial"] as const)("상세 상태=%s일 때 이력 출처와 법원 코드를 개별 물건에 보존한다", async (detailKind) => {
    const withDetail = detailKind !== "none";
    const observedHistory = detailKind === "complete";
    const row = {
      boCd: "B000210", jiwonNm: "서울중앙지방법원", printCsNo: "2026타경990001", srnSaNo: "2026013990001",
      maemulSer: "1", printSt: "서울특별시 강남구 합성로 1", hjguSido: "서울특별시", hjguSigu: "강남구",
      daepyoSidoCd: "11", gamevalAmt: "100000000", notifyMinmaePrice1: "49000000", minmaePrice: "70000000",
      yuchalCnt: "2", maeGiil: "20261030", dspslUsgNm: "아파트",
    };
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/pgj/index.on")) return new Response("session", { headers: { "set-cookie": "JSESSIONID=mock-only" } });
      if (url.endsWith("/pgj/pgjsearch/searchControllerMain.on")) {
        const body = JSON.parse(String(init?.body));
        return Response.json({ data: {
          dma_pageInfo: { pageNo: String(body.dma_pageInfo.pageNo), pageSize: "40", startRowNo: "1", totalCnt: "1" },
          dlt_srchResult: [row],
        } });
      }
      if (withDetail && url.endsWith("/pgj/pgj15B/selectAuctnCsSrchRslt.on")) {
        return Response.json({ data: { dma_result: {
          dspslGdsDxdyInfo: { prchDposRate: "20" },
          gdsDspslDxdyLst: [
            { auctnDxdyKndCd: "01", dxdyYmd: "20260819", auctnDxdyRsltCd: "002", tsLwsDspslPrc: "100000000" },
            { auctnDxdyKndCd: "01", dxdyYmd: "20260923", auctnDxdyRsltCd: "002",
              tsLwsDspslPrc: detailKind === "partial" ? "invalid-price" : "70000000" },
          ],
        } } });
      }
      throw new Error(`허용하지 않은 합성 요청: ${url}`);
    });
    const { main } = await import("../../scripts/crawl");
    const completion = main(withDetail ? ["--window", "7"] : ["--window", "7", "--no-detail"])
      .then(() => undefined, (error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await completion).toBeUndefined();
    const [item] = JSON.parse(readFileSync(join(fixtureDir, "public/data/seoul.json"), "utf8")) as AuctionItem[];
    expect(item).toMatchObject({ courtCode: "B000210", historySource: observedHistory ? "observed" : "estimated" });
    expect(item).toMatchObject({ depositRate: withDetail ? 20 : 10, depositSource: withDetail ? "observed" : "estimated",
      deposit: withDetail ? 9_800_000 : 4_900_000 });
    expect(item.history[0].date).toBe(observedHistory ? "2026-08-19" : "2026-07-17");
    if (detailKind === "partial") {
      // 유효한 실취득 한 행이 있어도 전체 역산으로 전환하며 실측/추정 이력을 섞어 observed로 저장하지 않는다.
      expect(item.history).toEqual([
        { date: "2026-07-17", minPrice: 100_000_000, result: "신건" },
        { date: "2026-08-21", minPrice: 100_000_000, result: "유찰" },
        { date: "2026-09-25", minPrice: 70_000_000, result: "유찰" },
      ]);
      expect(item.history.some((entry) => entry.date === "2026-08-19")).toBe(false);
    }
  });
});
