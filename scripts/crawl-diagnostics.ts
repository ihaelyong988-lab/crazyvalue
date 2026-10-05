import { REGIONS } from "../src/types/catalog";
import {
  CRAWL_DIAGNOSTIC_STAGES,
  CRAWL_MAPPING_SOURCES,
  CRAWL_EXCLUSION_REASONS,
  isCrawlDiagnosticSaleDate,
  type CrawlDiagnosticObservation,
  type CrawlDiagnostics,
  type CrawlDiagnosticsBucket,
  type CrawlDiagnosticsOptions,
  type CrawlDiagnosticsRecorder,
  type CrawlDiagnosticsWindow,
  type CrawlExclusionReason,
} from "../src/types/crawl-diagnostics";

// 기존 수집기와 테스트의 import 경로를 유지한다.
export { CRAWL_DIAGNOSTIC_STAGES, CRAWL_MAPPING_SOURCES, CRAWL_EXCLUSION_REASONS } from "../src/types/crawl-diagnostics";
export type {
  CrawlDiagnosticStage, CrawlMappingSource, CrawlExclusionReason, CrawlDiagnosticsWindow,
  CrawlDiagnosticsOptions, CrawlDiagnosticObservation, CrawlExclusionCount,
  CrawlDiagnosticsBucket, CrawlDiagnostics, CrawlDiagnosticsRecorder,
} from "../src/types/crawl-diagnostics";

const regionKeys = new Set(REGIONS.map((region) => region.key));

/** 형식과 실제 달력 날짜를 검사하고, 불명 날짜는 안전한 고정 키로 묶는다. */
function saleDateKey(value: unknown): string {
  return isCrawlDiagnosticSaleDate(value) ? value : "unknown";
}

function copyWindow(window: CrawlDiagnosticsWindow): CrawlDiagnosticsWindow {
  if (saleDateKey(window.start) === "unknown" || saleDateKey(window.end) === "unknown" ||
    window.start > window.end || typeof window.endInclusive !== "boolean") {
    throw new Error("수집 진단 날짜 경계가 올바르지 않다.");
  }
  return { start: window.start, end: window.end, endInclusive: window.endInclusive };
}

function createBucket(): CrawlDiagnosticsBucket {
  return {
    stages: Object.fromEntries(CRAWL_DIAGNOSTIC_STAGES.map((stage) => [stage, 0])) as CrawlDiagnosticsBucket["stages"],
    saleDatesByStage: Object.fromEntries(CRAWL_DIAGNOSTIC_STAGES.map((stage) => [stage, {}])) as CrawlDiagnosticsBucket["saleDatesByStage"],
    mappingSources: Object.fromEntries(CRAWL_MAPPING_SOURCES.map((source) => [source, 0])) as CrawlDiagnosticsBucket["mappingSources"],
    exclusionsByReason: Object.fromEntries(
      CRAWL_EXCLUSION_REASONS.map((reason) => [reason, { count: 0, saleDates: {} }]),
    ) as CrawlDiagnosticsBucket["exclusionsByReason"],
  };
}

/**
 * 관측한 단계와 사유만 세는 순수 집계기. 파일 쓰기·네트워크·콘솔 출력은 없다.
 * receiveRaw는 중복 포함 응답, dedup은 목록 고유 행, mapped는 mapRow 성공이다.
 * invalid는 정규화/검증 탈락, idDuplicates는 출력 id 중복을 센다.
 * windowExcluded는 출력 우선 배분 창 밖의 유효 물건이다. 창 밖 보충 출력도
 * 가능하므로 최종 출력 제외로 해석하지 않는다. cap은 전체 gate.valid에서
 * 실제 output에 선정되지 않은 물건만 기록한다.
 */
export function createCrawlDiagnostics(options: CrawlDiagnosticsOptions): CrawlDiagnosticsRecorder {
  if (options.scope !== null && !regionKeys.has(options.scope)) throw new Error("수집 진단 범위가 올바르지 않다.");
  const data: CrawlDiagnostics = {
    version: 1,
    searchWindow: copyWindow(options.searchWindow),
    outputWindow: copyWindow(options.outputWindow),
    scope: options.scope,
    totals: createBucket(),
    byRegion: Object.fromEntries([...regionKeys, "unknown"].map((key) => [key, createBucket()])),
  };
  const bucketsFor = (observation: CrawlDiagnosticObservation): CrawlDiagnosticsBucket[] => {
    const key = observation.regionKey !== null && regionKeys.has(observation.regionKey) ? observation.regionKey : "unknown";
    return [data.totals, data.byRegion[key]];
  };
  const exclude = (reason: CrawlExclusionReason, observation: CrawlDiagnosticObservation): void => {
    if (!CRAWL_EXCLUSION_REASONS.includes(reason)) throw new Error("수집 진단 제외 사유가 올바르지 않다.");
    const date = saleDateKey(observation.saleDate);
    for (const bucket of bucketsFor(observation)) {
      const excluded = bucket.exclusionsByReason[reason];
      excluded.count++;
      excluded.saleDates[date] = (excluded.saleDates[date] ?? 0) + 1;
    }
  };
  return {
    record(stage, observation, reason) {
      if (!CRAWL_DIAGNOSTIC_STAGES.includes(stage)) throw new Error("수집 진단 단계가 올바르지 않다.");
      if (reason !== undefined && !CRAWL_EXCLUSION_REASONS.includes(reason)) throw new Error("수집 진단 제외 사유가 올바르지 않다.");
      const date = saleDateKey(observation.saleDate);
      const source = observation.mappingSource !== undefined && CRAWL_MAPPING_SOURCES.includes(observation.mappingSource)
        ? observation.mappingSource : "unknown";
      for (const bucket of bucketsFor(observation)) {
        bucket.stages[stage]++;
        bucket.saleDatesByStage[stage][date] = (bucket.saleDatesByStage[stage][date] ?? 0) + 1;
        if (stage === "dedup") bucket.mappingSources[source]++;
      }
      if (reason !== undefined) exclude(reason, observation);
    },
    exclude,
    snapshot() { return JSON.parse(JSON.stringify(data)) as CrawlDiagnostics; },
  };
}
