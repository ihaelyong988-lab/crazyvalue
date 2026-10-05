import { describe, expect, it } from "vitest";
import { REGIONS } from "../../src/types/catalog";
import { CrawlDiagnosticsSchema } from "../../src/types/crawl-diagnostics";
import {
  createCrawlDiagnostics,
  type CrawlDiagnosticObservation,
  type CrawlDiagnosticsOptions,
  type CrawlExclusionReason,
} from "../../scripts/crawl-diagnostics";

const options = (): CrawlDiagnosticsOptions => ({
  searchWindow: { start: "2026-10-05", end: "2026-10-12", endInclusive: true },
  outputWindow: { start: "2026-10-05", end: "2026-10-12", endInclusive: false },
  scope: null,
});
const jeonbuk: CrawlDiagnosticObservation = { regionKey: "jeonbuk", saleDate: "2026-10-05", mappingSource: "sidoPrefix" };

describe("수집 진단 — 지역별 단계·사유·날짜를 원천과 구분", () => {
  it("17개 지역과 unknown은 독립된 0건 집계로 시작한다", () => {
    const snapshot = createCrawlDiagnostics(options()).snapshot();
    expect(Object.keys(snapshot.byRegion)).toEqual([...REGIONS.map((region) => region.key), "unknown"]);
    expect(snapshot.byRegion.jeonbuk.stages.receiveRaw).toBe(0);
    expect(snapshot.byRegion.seoul.stages.receiveRaw).toBe(0);
    expect(snapshot.totals.stages.output).toBe(0);
    expect(snapshot.version).toBe(1);
  });
  it("원천 재서빙 중복을 후보·매핑 출처 수에 섞지 않는다", () => {
    const recorder = createCrawlDiagnostics(options());
    recorder.record("receiveRaw", jeonbuk);
    recorder.record("receiveRaw", jeonbuk);
    recorder.record("dedup", jeonbuk);
    recorder.record("mapped", jeonbuk);
    recorder.record("candidates", jeonbuk);
    recorder.record("output", jeonbuk);
    const snapshot = recorder.snapshot();
    expect(snapshot.byRegion.jeonbuk.stages).toMatchObject({ receiveRaw: 2, dedup: 1, mapped: 1, candidates: 1, output: 1 });
    expect(snapshot.totals.stages.receiveRaw).toBe(2);
    expect(snapshot.byRegion.jeonbuk.mappingSources.sidoPrefix).toBe(1);
    expect(snapshot.byRegion.jeonbuk.saleDatesByStage.receiveRaw).toEqual({ "2026-10-05": 2 });
  });
  it("미인식 행은 unknown에 남기며 전북이나 다른 지역으로 추정하지 않는다", () => {
    const recorder = createCrawlDiagnostics(options());
    const unknown = { regionKey: null, saleDate: "2026-10-06", mappingSource: "unknown" } as const;
    recorder.record("receiveRaw", unknown);
    recorder.record("dedup", unknown);
    recorder.record("invalid", unknown, "unmappedRegion");
    const snapshot = recorder.snapshot();
    expect(snapshot.byRegion.unknown.stages).toMatchObject({ receiveRaw: 1, dedup: 1, invalid: 1, mapped: 0, candidates: 0 });
    expect(snapshot.byRegion.unknown.mappingSources.unknown).toBe(1);
    expect(snapshot.byRegion.unknown.exclusionsByReason.unmappedRegion).toEqual({ count: 1, saleDates: { "2026-10-06": 1 } });
    expect(snapshot.byRegion.jeonbuk.stages.receiveRaw).toBe(0);
    expect(snapshot.totals.exclusionsByReason.unmappedRegion.count).toBe(1);
  });
  it("가격 탈락·스키마 실패·id 중복은 별도 사유와 단계로 기록한다", () => {
    const recorder = createCrawlDiagnostics(options());
    recorder.record("dedup", jeonbuk);
    recorder.record("invalid", jeonbuk, "priceContract");
    recorder.record("invalid", { ...jeonbuk, saleDate: "2026-10-07" }, "schemaInvalid");
    recorder.record("idDuplicates", jeonbuk, "duplicateId");
    const snapshot = recorder.snapshot();
    expect(snapshot.byRegion.jeonbuk.stages.invalid).toBe(2);
    expect(snapshot.byRegion.jeonbuk.stages.idDuplicates).toBe(1);
    expect(snapshot.byRegion.jeonbuk.exclusionsByReason.priceContract.count).toBe(1);
    expect(snapshot.byRegion.jeonbuk.exclusionsByReason.schemaInvalid.saleDates).toEqual({ "2026-10-07": 1 });
    expect(snapshot.byRegion.jeonbuk.exclusionsByReason.duplicateId.count).toBe(1);
  });
  it("검색 끝일 포함과 후보 창 끝일 미포함을 기록하고 창 밖 보충도 출력으로 센다", () => {
    const recorder = createCrawlDiagnostics(options());
    const boundary = { ...jeonbuk, saleDate: "2026-10-12" };
    recorder.record("windowExcluded", boundary, "afterOutputWindow");
    recorder.record("output", boundary);
    const snapshot = recorder.snapshot();
    expect(snapshot.searchWindow.endInclusive).toBe(true);
    expect(snapshot.outputWindow.endInclusive).toBe(false);
    expect(snapshot.byRegion.jeonbuk.stages).toMatchObject({ candidates: 0, windowExcluded: 1, output: 1 });
    expect(snapshot.byRegion.jeonbuk.exclusionsByReason.cap.count).toBe(0);
    expect(snapshot.byRegion.jeonbuk.saleDatesByStage.output).toEqual({ "2026-10-12": 1 });
  });
  it("scope·limit·cap 사유만 기록해 invalid 단계나 후보 수를 부풀리지 않는다", () => {
    const recorder = createCrawlDiagnostics({ ...options(), scope: "jeonbuk" });
    recorder.exclude("scope", { regionKey: "seoul", saleDate: "2026-10-05" });
    recorder.exclude("limit", jeonbuk);
    recorder.exclude("cap", jeonbuk);
    const snapshot = recorder.snapshot();
    expect(snapshot.scope).toBe("jeonbuk");
    expect(snapshot.byRegion.seoul.exclusionsByReason.scope.count).toBe(1);
    expect(snapshot.byRegion.jeonbuk.exclusionsByReason.limit.count).toBe(1);
    expect(snapshot.byRegion.jeonbuk.exclusionsByReason.cap.count).toBe(1);
    expect(snapshot.totals.stages.invalid).toBe(0);
    expect(snapshot.totals.stages.candidates).toBe(0);
  });
  it("prefix·행정코드·법원 폴백의 출처를 고유 목록에서만 센다", () => {
    const recorder = createCrawlDiagnostics(options());
    recorder.record("dedup", jeonbuk);
    recorder.record("dedup", { ...jeonbuk, mappingSource: "sidoCode" });
    recorder.record("dedup", { ...jeonbuk, mappingSource: "courtFallback" });
    recorder.record("dedup", { ...jeonbuk, mappingSource: undefined });
    expect(recorder.snapshot().byRegion.jeonbuk.mappingSources).toEqual({ sidoPrefix: 1, sidoCode: 1, courtFallback: 1, unknown: 1 });
  });
  it("잘못된 지역·날짜와 추가 필드를 버려 민감 문자열이 직렬화되지 않는다", () => {
    const recorder = createCrawlDiagnostics(options());
    const unsafe = { regionKey: "홍길동 주소", saleDate: "비밀값", mappingSource: "개인정보", address: "주소 원문", name: "성명 원문", secret: "인증정보 원문" } as unknown as CrawlDiagnosticObservation;
    recorder.record("receiveRaw", unsafe);
    recorder.record("dedup", unsafe);
    recorder.record("receiveRaw", { regionKey: null, saleDate: "2026-02-30" });
    recorder.record("receiveRaw", { regionKey: null, saleDate: "2026-10-05T00:00:00Z" });
    const snapshot = recorder.snapshot();
    expect(snapshot.byRegion.unknown.saleDatesByStage.receiveRaw).toEqual({ unknown: 3 });
    expect(snapshot.byRegion.unknown.mappingSources.unknown).toBe(1);
    expect(JSON.stringify(snapshot)).not.toMatch(/홍길동|비밀값|개인정보|주소 원문|성명 원문|인증정보 원문/);
  });
  it("허용되지 않은 사유·날짜 경계·scope는 입력값을 담지 않는 오류로 거절한다", () => {
    const recorder = createCrawlDiagnostics(options());
    expect(() => recorder.exclude("비밀 사유" as CrawlExclusionReason, jeonbuk)).toThrow("수집 진단 제외 사유가 올바르지 않다.");
    expect(() => createCrawlDiagnostics({ ...options(), scope: "비밀 범위" })).toThrow("수집 진단 범위가 올바르지 않다.");
    expect(() => createCrawlDiagnostics({ ...options(), searchWindow: { start: "비밀 날짜", end: "2026-10-12", endInclusive: true } })).toThrow("수집 진단 날짜 경계가 올바르지 않다.");
    expect(() => createCrawlDiagnostics({ ...options(), outputWindow: { start: "2026-10-13", end: "2026-10-12", endInclusive: false } })).toThrow();
    expect(recorder.snapshot().totals.stages.invalid).toBe(0);
  });
  it("입력 옵션과 snapshot의 변이가 다른 지역이나 이후 집계에 영향을 주지 않는다", () => {
    const input = options();
    const recorder = createCrawlDiagnostics(input);
    input.outputWindow.end = "2026-11-01";
    const first = recorder.snapshot();
    first.byRegion.jeonbuk.stages.output = 999;
    first.byRegion.jeonbuk.saleDatesByStage.output["2026-10-05"] = 999;
    first.totals.exclusionsByReason.cap.count = 999;
    recorder.record("output", jeonbuk);
    const second = recorder.snapshot();
    expect(second.outputWindow.end).toBe("2026-10-12");
    expect(second.byRegion.jeonbuk.stages.output).toBe(1);
    expect(second.byRegion.jeonbuk.saleDatesByStage.output["2026-10-05"]).toBe(1);
    expect(second.byRegion.seoul.stages.output).toBe(0);
    expect(second.totals.exclusionsByReason.cap.count).toBe(0);
  });

  it("관측 snapshot을 공유 Zod 계약으로 파싱하고 불명 날짜는 unknown으로 유지한다", () => {
    const recorder = createCrawlDiagnostics(options());
    recorder.record("receiveRaw", jeonbuk);
    recorder.record("dedup", { regionKey: null, saleDate: null });
    recorder.record("invalid", { regionKey: null, saleDate: null }, "unmappedRegion");
    const snapshot = recorder.snapshot();
    expect(CrawlDiagnosticsSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot.byRegion.unknown.saleDatesByStage.dedup).toEqual({ unknown: 1 });
  });

  it("공유 계약은 음수·분수 카운트, 임의 단계·출처·사유·지역을 거절한다", () => {
    const base = createCrawlDiagnostics(options()).snapshot();
    const mutations = [
      (s: typeof base) => { s.totals.stages.receiveRaw = -1; },
      (s: typeof base) => { s.totals.mappingSources.sidoPrefix = 1.5; },
      (s: typeof base) => { s.totals.exclusionsByReason.cap.count = -1; },
      (s: typeof base) => { Object.assign(s.totals.stages, { secretStage: 1 }); },
      (s: typeof base) => { Object.assign(s.totals.mappingSources, { secretSource: 1 }); },
      (s: typeof base) => { Object.assign(s.totals.exclusionsByReason, { secretReason: { count: 1, saleDates: {} } }); },
      (s: typeof base) => { s.byRegion.secretRegion = s.byRegion.unknown; },
      (s: typeof base) => { s.scope = "unknown"; },
    ];
    for (const mutate of mutations) {
      const changed = JSON.parse(JSON.stringify(base)) as typeof base;
      mutate(changed);
      expect(CrawlDiagnosticsSchema.safeParse(changed).success).toBe(false);
    }
  });

  it("공유 계약은 실제 날짜·boolean 경계만 허용하고 개인정보 추가 필드는 거절한다", () => {
    const base = createCrawlDiagnostics(options()).snapshot();
    const mutations = [
      (s: typeof base) => { s.totals.saleDatesByStage.receiveRaw["주소 원문"] = 1; },
      (s: typeof base) => { s.totals.exclusionsByReason.cap.saleDates["2026-02-30"] = 1; },
      (s: typeof base) => { s.outputWindow.start = "2026-10-13"; },
      (s: typeof base) => { Object.assign(s.searchWindow, { endInclusive: "true" }); },
      (s: typeof base) => { Object.assign(s, { address: "주소 원문" }); },
      (s: typeof base) => { Object.assign(s.byRegion.jeonbuk, { name: "성명 원문" }); },
      (s: typeof base) => { Object.assign(s.byRegion.jeonbuk.exclusionsByReason.cap, { secret: "인증정보 원문" }); },
    ];
    for (const mutate of mutations) {
      const changed = JSON.parse(JSON.stringify(base)) as typeof base;
      mutate(changed);
      expect(CrawlDiagnosticsSchema.safeParse(changed).success).toBe(false);
    }
  });
});
