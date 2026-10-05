import { z } from "zod";
import { REGIONS } from "./catalog";

/** 후보는 검증과 출력 날짜 창을 통과한 부분집합이며 원천 전체가 아니다. */
export const CRAWL_DIAGNOSTIC_STAGES = [
  "receiveRaw", "dedup", "mapped", "invalid", "idDuplicates", "windowExcluded", "candidates", "output",
] as const;
export type CrawlDiagnosticStage = (typeof CRAWL_DIAGNOSTIC_STAGES)[number];

export const CRAWL_MAPPING_SOURCES = ["sidoPrefix", "sidoCode", "courtFallback", "unknown"] as const;
export type CrawlMappingSource = (typeof CRAWL_MAPPING_SOURCES)[number];

/** 임의 원천 문자열을 사유나 객체 키로 저장하지 않는다. */
export const CRAWL_EXCLUSION_REASONS = [
  "missingIdentity", "missingPrice", "failCount", "priceContract", "missingSaleDate", "expiredSaleDate",
  "unmappedRegion", "missingDistrict", "missingCourt", "schemaInvalid", "duplicateId",
  "beforeOutputWindow", "afterOutputWindow", "scope", "limit", "cap", "other",
] as const;
export type CrawlExclusionReason = (typeof CRAWL_EXCLUSION_REASONS)[number];

/** 실달력 ISO 날짜만 허용한다. 원천에서 결측된 날짜는 집계 키 unknown으로 따로 기록한다. */
export function isCrawlDiagnosticSaleDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const count = z.number().int().nonnegative();
const saleDate = z.string().refine(isCrawlDiagnosticSaleDate, { message: "실제 ISO 날짜만 허용" });
const saleDates = z.record(z.union([saleDate, z.literal("unknown")]), count);
const regionKeys = REGIONS.map((region) => region.key) as [string, ...string[]];

export const CrawlDiagnosticStageSchema = z.enum(CRAWL_DIAGNOSTIC_STAGES);
export const CrawlMappingSourceSchema = z.enum(CRAWL_MAPPING_SOURCES);
export const CrawlExclusionReasonSchema = z.enum(CRAWL_EXCLUSION_REASONS);

export const CrawlDiagnosticsWindowSchema = z.object({
  start: saleDate,
  end: saleDate,
  endInclusive: z.boolean(),
}).strict().refine((window) => window.start <= window.end, {
  message: "날짜 창 끝은 시작보다 앞설 수 없다",
  path: ["end"],
});
export type CrawlDiagnosticsWindow = z.infer<typeof CrawlDiagnosticsWindowSchema>;

export const CrawlExclusionCountSchema = z.object({ count, saleDates }).strict();
export type CrawlExclusionCount = z.infer<typeof CrawlExclusionCountSchema>;

export const CrawlDiagnosticsBucketSchema = z.object({
  stages: z.record(CrawlDiagnosticStageSchema, count),
  saleDatesByStage: z.record(CrawlDiagnosticStageSchema, saleDates),
  /** 고유 목록(dedup)에서만 1회 기록하며, 탈락·미인식 행도 포함한다. */
  mappingSources: z.record(CrawlMappingSourceSchema, count),
  exclusionsByReason: z.record(CrawlExclusionReasonSchema, CrawlExclusionCountSchema),
}).strict();
export type CrawlDiagnosticsBucket = z.infer<typeof CrawlDiagnosticsBucketSchema>;

/** 필드·지역·단계·출처·사유·날짜 키 모두 화이트리스트로 제한한다. */
export const CrawlDiagnosticsSchema = z.object({
  version: z.literal(1),
  searchWindow: CrawlDiagnosticsWindowSchema,
  outputWindow: CrawlDiagnosticsWindowSchema,
  scope: z.enum(regionKeys).nullable(),
  totals: CrawlDiagnosticsBucketSchema,
  /** 시도 17개와 unknown. unknown을 임의의 실제 지역으로 귀속하지 않는다. */
  byRegion: z.record(z.enum([...regionKeys, "unknown"] as [string, ...string[]]), CrawlDiagnosticsBucketSchema),
}).strict();
export type CrawlDiagnostics = z.infer<typeof CrawlDiagnosticsSchema>;

export interface CrawlDiagnosticsOptions {
  searchWindow: CrawlDiagnosticsWindow;
  outputWindow: CrawlDiagnosticsWindow;
  /** 이번 실행 관측만 집계하므로 유지된 다른 지역 파일을 섞지 않는다. */
  scope: string | null;
}

/** 주소·성명·사건번호·RawRow를 받지 않는 집계 관측 API. */
export interface CrawlDiagnosticObservation {
  regionKey: string | null;
  saleDate?: string | null;
  mappingSource?: CrawlMappingSource;
}

export interface CrawlDiagnosticsRecorder {
  record(stage: CrawlDiagnosticStage, observation: CrawlDiagnosticObservation, reason?: CrawlExclusionReason): void;
  /** 단계 수를 올리지 않고 scope·limit·cap 등 제외 사유만 집계한다. */
  exclude(reason: CrawlExclusionReason, observation: CrawlDiagnosticObservation): void;
  snapshot(): CrawlDiagnostics;
}
