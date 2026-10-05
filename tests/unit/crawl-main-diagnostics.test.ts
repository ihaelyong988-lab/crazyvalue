import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { AuctionItemSchema, MetaSchema } from "../../src/types/auction";
import { REGIONS } from "../../src/types/catalog";

const prefix = "crazyvalue-crawl-diagnostics-";
const originalCwd = process.cwd();
const projectDataDir = join(originalCwd, "public", "data");
let fixtureDir: string;
let originalData: Map<string, Buffer>;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("테스트 중 process.exit 호출"); });
  // 실제 저장소는 읽기 대조만 한다. main의 모든 쓰기는 새 임시 cwd로 향한다.
  originalData = new Map(["meta.json", ...REGIONS.map((region) => `${region.key}.json`)].map((name) => [
    name, readFileSync(join(projectDataDir, name)),
  ]));
  fixtureDir = mkdtempSync(join(tmpdir(), prefix));
  process.chdir(fixtureDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  // 새로 만든 명명된 임시 디렉터리만 삭제한다. 저장소나 임의 경로는 대상이 될 수 없다.
  const target = resolve(fixtureDir);
  expect(dirname(target)).toBe(resolve(tmpdir()));
  expect(basename(target).startsWith(prefix)).toBe(true);
  rmSync(target, { recursive: true, force: true });
});

function sourceRow(caseNo: string, saleDate: string, overrides: Record<string, unknown> = {}) {
  return {
    boCd: "B000210",
    jiwonNm: "서울중앙지방법원",
    printCsNo: caseNo,
    maemulSer: "1",
    printSt: "서울특별시 강남구 합성로 1",
    hjguSido: "서울특별시",
    hjguSigu: "강남구",
    daepyoSidoCd: "11",
    gamevalAmt: "100000000",
    notifyMinmaePrice1: "40000000",
    minmaePrice: "40000000",
    yuchalCnt: "2",
    maeGiil: saleDate,
    dspslUsgNm: "아파트",
    ...overrides,
  };
}

describe("실제 main의 성공 산출 — 단계별 진단과 제공 기간", () => {
  it("원천 중복·id 중복·미인식·가격 탈락과 창 밖 전북 보충을 정확히 기록한다", async () => {
    const a = sourceRow("2026타경990001", "20261011");
    const rows = [
      a,
      { ...a }, // 목록 행 키 중복: receiveRaw만 1 증가한다.
      { ...a, boCd: "B000211" }, // 목록 키는 다르지만 같은 지역/사건/물건 id다.
      sourceRow("2026타경990002", "20261012", {
        boCd: "B000520", jiwonNm: "전주지방법원", hjguSido: "전북특별자치도",
        printSt: "전북특별자치도 익산시 합성로 1", hjguSigu: "익산시", daepyoSidoCd: "52",
      }),
      sourceRow("2026타경990003", "20261011", {
        boCd: "UNKNOWN", hjguSido: "미인식지역", printSt: "미인식지역 합성구 합성로 1", daepyoSidoCd: "00",
      }),
      sourceRow("2026타경990004", "20261011", { notifyMinmaePrice1: "100000000", minmaePrice: "100000000" }),
    ];
    const searchBodies: { dma_pageInfo: Record<string, unknown>; dma_srchGdsDtlSrchInfo: Record<string, unknown> }[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/pgj/index.on")) {
        return new Response("mock session", { status: 200, headers: { "set-cookie": "JSESSIONID=mock-only; Path=/" } });
      }
      if (!url.endsWith("/pgj/pgjsearch/searchControllerMain.on")) throw new Error(`허용되지 않은 테스트 요청: ${url}`);
      const body = JSON.parse(String(init?.body)) as (typeof searchBodies)[number];
      searchBodies.push(body);
      return new Response(JSON.stringify({ data: {
        dma_pageInfo: {
          pageNo: String(body.dma_pageInfo.pageNo), pageSize: "40",
          // 실제 원천의 응답 echo는 1-based이며 요청은 0-based다.
          startRowNo: String(Number(body.dma_pageInfo.startRowNo) + 1), totalCnt: "6",
        },
        dlt_srchResult: rows,
      } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { main } = await import("../../scripts/crawl");
    // 타이머 진행 중의 실패도 completion에 수용해 unhandled rejection을 피한다.
    const completion = main(["--window", "7", "--no-detail"]).then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.runAllTimersAsync();
    expect(await completion).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2); // 세션 1 + 합성 목록 1, 상세·실제 원천 요청 0.
    expect(searchBodies).toHaveLength(1);
    expect(searchBodies[0].dma_pageInfo).toMatchObject({ pageNo: 1, startRowNo: 0 });
    expect(searchBodies[0].dma_srchGdsDtlSrchInfo).toMatchObject({ bidBgngYmd: "20261005", bidEndYmd: "20261012" });
    expect(process.exit).not.toHaveBeenCalled();

    const dataDir = join(fixtureDir, "public", "data");
    expect(readdirSync(dataDir).sort()).toEqual([...originalData.keys()].sort());
    const rawMeta = JSON.parse(readFileSync(join(dataDir, "meta.json"), "utf8"));
    const meta = MetaSchema.parse(rawMeta);
    expect(meta).toMatchObject({
      totalCount: 2,
      countsByRegion: { seoul: 1, jeonbuk: 1 },
      candidatesByRegion: { seoul: 1, jeonbuk: 0 },
      sourceLastSaleDate: "2026-10-11",
      outputWindow: { start: "2026-10-05", end: "2026-10-12", endInclusive: false },
      outputSaleDateRange: { first: "2026-10-11", last: "2026-10-12" },
      collectionCompleteness: { complete: true, totalCnt: 6, received: 6, pageCount: 1, retries: 0, rejectedRows: 0 },
    });
    expect(rawMeta).toMatchObject({ dedupDropped: 2, invalidDropped: 0, cappedFrom: 2 });
    const diagnostics = meta.collectionDiagnostics;
    expect(diagnostics).toBeDefined();
    if (!diagnostics) throw new Error("성공 main 진단 필드 결측");
    expect(diagnostics.totals.stages).toEqual({
      receiveRaw: 6, dedup: 5, mapped: 3, invalid: 2, idDuplicates: 1,
      windowExcluded: 1, candidates: 1, output: 2,
    });
    expect(diagnostics.totals.exclusionsByReason.priceContract.count).toBe(1);
    expect(diagnostics.totals.exclusionsByReason.unmappedRegion.count).toBe(1);
    expect(diagnostics.totals.exclusionsByReason.cap.count).toBe(0);
    expect(diagnostics.byRegion.unknown.stages).toMatchObject({ receiveRaw: 1, dedup: 1, invalid: 1, mapped: 0, candidates: 0, output: 0 });
    expect(diagnostics.byRegion.jeonbuk.stages).toMatchObject({ receiveRaw: 1, dedup: 1, mapped: 1, invalid: 0, candidates: 0, windowExcluded: 1, output: 1 });
    expect(diagnostics.byRegion.jeonbuk.exclusionsByReason.afterOutputWindow).toEqual({ count: 1, saleDates: { "2026-10-12": 1 } });
    expect(diagnostics.byRegion.jeonbuk.mappingSources.sidoPrefix).toBe(1);
    expect(diagnostics.byRegion.unknown.exclusionsByReason.unmappedRegion.count).toBe(1);
    expect(JSON.stringify(diagnostics)).not.toMatch(/2026타경|합성로|JSESSIONID|mock-only/);

    const seoul = JSON.parse(readFileSync(join(dataDir, "seoul.json"), "utf8"));
    const jeonbuk = JSON.parse(readFileSync(join(dataDir, "jeonbuk.json"), "utf8"));
    expect(seoul).toHaveLength(1);
    expect(jeonbuk).toHaveLength(1);
    expect(AuctionItemSchema.parse(seoul[0]).saleDate).toBe("2026-10-11");
    expect(AuctionItemSchema.parse(jeonbuk[0]).saleDate).toBe("2026-10-12");
    for (const [name, contents] of originalData) {
      expect(readFileSync(join(projectDataDir, name)).equals(contents), `${name} 기존 저장소 바이트 보존`).toBe(true);
    }
  });
});
