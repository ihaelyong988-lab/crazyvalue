import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { REGIONS } from "../../src/types/catalog";

const prefix = "crazyvalue-crawl-preservation-";
const originalCwd = process.cwd();
let fixtureDir: string;
let snapshots: Map<string, Buffer>;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T00:00:00Z"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("테스트 중 process.exit 호출"); });
  fixtureDir = mkdtempSync(join(tmpdir(), prefix));
  const dataDir = join(fixtureDir, "public", "data");
  mkdirSync(dataDir, { recursive: true });
  snapshots = new Map(["meta.json", ...REGIONS.map((region) => `${region.key}.json`)].map((name) => {
    const contents = Buffer.from(`preserve:${name}\r\n기존 산출물\u0000\r\n`, "utf8");
    writeFileSync(join(dataDir, name), contents);
    return [name, contents];
  }));
  process.chdir(fixtureDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  // 새로 만든 명명된 임시 디렉터리만 삭제한다. 저장소/public/data를 삭제할 수 없는 경계다.
  const target = resolve(fixtureDir);
  expect(dirname(target)).toBe(resolve(tmpdir()));
  expect(basename(target).startsWith(prefix)).toBe(true);
  rmSync(target, { recursive: true, force: true });
});

function sourceRows(pageNo: number) {
  return Array.from({ length: 40 }, (_, index) => ({
    boCd: "B000210",
    jiwonNm: "서울중앙지방법원",
    printCsNo: `2026타경${pageNo * 1000 + index}`,
    maemulSer: "1",
    printSt: "서울특별시 강남구 테스트로 1",
    realSt: "서울특별시 강남구 테스트로 1",
    hjguSido: "서울특별시",
    hjguSigu: "강남구",
    daepyoSidoCd: "11",
    gamevalAmt: "100000000",
    notifyMinmaePrice1: "49000000",
    minmaePrice: "49000000",
    yuchalCnt: "2",
    maeGiil: "20261006",
    dspslUsgNm: "아파트",
  }));
}

function expectPreservedOutput() {
  const dataDir = join(fixtureDir, "public", "data");
  expect(readdirSync(dataDir).sort()).toEqual([...snapshots.keys()].sort());
  for (const [name, contents] of snapshots) {
    expect(readFileSync(join(dataDir, name)).equals(contents), `${name} 쓰기 보존`).toBe(true);
  }
}

describe("실제 main의 목록 미완주 예외는 기존 산출물 쓰기 전에 발생한다", () => {
  it.each([
    ["반복 페이지", "반복 응답"],
    ["서버 총계 변동", "서버 총계 변동"],
  ] as const)("%s에서 전국 17파일과 meta의 바이트를 보존한다", async (scenario, expectedReason) => {
    const searchRequests: number[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/pgj/index.on")) {
        return new Response("mock session", { status: 200, headers: { "set-cookie": "JSESSIONID=mock-only; Path=/" } });
      }
      if (!url.endsWith("/pgj/pgjsearch/searchControllerMain.on")) {
        throw new Error(`허용되지 않은 테스트 요청: ${url}`);
      }
      const body = JSON.parse(String(init?.body)) as { dma_pageInfo: Record<string, unknown> };
      const pageNo = Number(body.dma_pageInfo.pageNo);
      searchRequests.push(pageNo);
      const broken = pageNo > 1;
      const totalCnt = broken && scenario === "서버 총계 변동" ? 119 : 120;
      const rows = sourceRows(broken && scenario === "반복 페이지" ? 1 : pageNo);
      return new Response(JSON.stringify({ data: {
        dma_pageInfo: {
          pageNo: String(pageNo),
          pageSize: "40",
          startRowNo: String(Number(body.dma_pageInfo.startRowNo) + 1),
          totalCnt: String(totalCnt),
        },
        dlt_srchResult: rows,
      } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { main } = await import("../../scripts/crawl");
    // 즉시 rejection handler를 달아 fake timers 진행 중의 unhandled rejection도 막는다.
    const completion = main(["--window", "7", "--no-detail"]).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.runAllTimersAsync();
    const error = await completion;
    expect(error).toMatchObject({ name: "IncompletePaginationError", pageNo: 2, received: 40, totalCnt: 120 });
    expect((error as Error).message).toContain(expectedReason);
    expect(searchRequests).toEqual([1, 2, 2, 2]);
    expect(fetchMock).toHaveBeenCalledTimes(5); // 세션 1 + 검색 최초 2 + 같은 2페이지 추가 2
    expect(process.exit).not.toHaveBeenCalled();

    expectPreservedOutput();
  });

  it("--limit은 원천20행을 완주했어도 1행만 매핑한 진단 결과를 운영 파일에 쓰지 않는다", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/pgj/index.on")) {
        return new Response("mock session", { status: 200, headers: { "set-cookie": "JSESSIONID=mock-only; Path=/" } });
      }
      if (!url.endsWith("/pgj/pgjsearch/searchControllerMain.on")) throw new Error(`허용되지 않은 테스트 요청: ${url}`);
      return new Response(JSON.stringify({ data: {
        dma_pageInfo: { pageNo: "1", pageSize: "40", startRowNo: "1", totalCnt: "20" },
        dlt_srchResult: sourceRows(1).slice(0, 20),
      } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { main } = await import("../../scripts/crawl");
    const completion = main(["--window", "7", "--no-detail", "--limit", "1"]).then(
      () => undefined,
      (error: unknown) => error,
    );
    await vi.runAllTimersAsync();
    expect(await completion).toBeUndefined();
    // 실제 mapping·검증 게이트·상한까지 유효 1건이 도달해야 이 회귀 검증이 성립한다.
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("기일 이력 — 실취득 0건 · 역산 폴백 1건"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("상한적용 1→1"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(process.exit).not.toHaveBeenCalled();
    expectPreservedOutput();
  });
});
