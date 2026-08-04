import { z } from "zod";

// 단일 데이터 계약(기획안 §5.3) — 목데이터(Phase 1)와 실데이터(Phase 3)가 공유한다.
// 화면 코드는 데이터 출처를 모른다. 필드 추가·변경은 이 파일에서만 한다(§13 규칙 6).

import { CATEGORIES } from "./catalog";

export { CATEGORIES, REGIONS, regionNameByKey, regionKeyByName } from "./catalog";
export type { Category } from "./catalog";

export const CategorySchema = z.enum(CATEGORIES);

// 외부 데이터 불신 원칙(§13 규칙 1): URL은 https 검증 통과 후에만 src·href에 쓴다.
const HttpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith("https://"), { message: "https URL만 허용" });

export const HistoryEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  minPrice: z.number().int().positive(),
  result: z.enum(["유찰", "변경", "신건"]),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const AuctionItemSchema = z
  .object({
    id: z.string().min(1), // "{법원코드}-{사건번호}-{물건번호}"
    court: z.string().min(1),
    caseNo: z.string().min(1),
    itemNo: z.string().min(1),
    category: CategorySchema,
    address: z.string().min(1),
    region: z.string().min(1), // 시·도 한글명
    district: z.string().min(1), // 시·군·구
    appraisalPrice: z.number().int().positive(), // 원 단위 정수(§13 규칙 12)
    minPrice: z.number().int().positive(),
    priceRatio: z.number().gt(0).lte(1), // minPrice/appraisalPrice — 표시 할인율 = 1 − priceRatio(부호 반전 주의)
    failCount: z.number().int().gte(2), // 유찰 2회 이상만 수집(제품 정체성)
    saleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    saleTime: z.string(),
    courtRoom: z.string(),
    deposit: z.number().int().nonnegative(),
    areaBuilding: z.number().nullable(),
    areaLand: z.number().nullable(),
    photoUrl: HttpsUrl.nullable(),
    detailUrl: HttpsUrl,
    history: z.array(HistoryEntrySchema).min(1),
    specialNote: z.string().nullable(), // 자연인 성명은 수집 단계에서 마스킹(§13 규칙 2)
  })
  .superRefine((item, ctx) => {
    const computed = item.minPrice / item.appraisalPrice;
    if (Math.abs(computed - item.priceRatio) > 0.005) {
      ctx.addIssue({
        code: "custom",
        message: `priceRatio 불일치: 저장 ${item.priceRatio}, 계산 ${computed.toFixed(4)}`,
      });
    }
    const failsInHistory = item.history.filter((h) => h.result === "유찰").length;
    if (failsInHistory !== item.failCount) {
      ctx.addIssue({
        code: "custom",
        message: `failCount(${item.failCount})와 history 유찰 수(${failsInHistory}) 불일치`,
      });
    }
  });
export type AuctionItem = z.infer<typeof AuctionItemSchema>;

export const RegionFileSchema = z.array(AuctionItemSchema);

export const MetaSchema = z.object({
  crawledAt: z.string(), // 데이터 기준 시각(ISO, KST 오프셋 포함)
  totalCount: z.number().int().nonnegative(),
  countsByRegion: z.record(z.string(), z.number().int().nonnegative()),
  nextUpdateAt: z.string(),
  /**
   * 직전 산출물에 없던 물건 수. 비교 대상이 없거나 부분 수집이면 null(=건수를 감춘다).
   * optional인 이유는 아래 운영 필드와 같다 — 배포된 meta.json에 이 필드가 없고, 서비스워커 캐시로
   * 옛 meta를 읽는 재방문자가 있어 필수로 두면 그 방문자의 화면이 깨진다.
   */
  newCount: z.number().int().nonnegative().nullable().optional(),
  // 아래 운영 필드는 전부 optional이다 — 기존 public/data/meta.json에 없고 src/lib/use-meta.ts의
  // isMeta()가 위 4필드만 검사하므로 추가 필드는 앱 동작에 무영향이다.
  // 의미를 한 필드에 겹치지 않는다: "후보가 예산보다 많다"(truncated)와 "차단·마감으로 끊겼다"(aborted)는
  // 다른 사건이고, 전자는 설계상 상시 참이라 한 필드로 묶으면 차단 재발을 구별하지 못한다.
  /** 이번 실행이 갱신한 범위 — null이면 전국, 값이 있으면 그 지역만(--region). 나머지 지역 수치는 직전 파일 기준이다. */
  scope: z.string().nullable().optional(),
  /** 상세 단계가 차단·마감·예산 소진으로 조기 종료됐는지. 물건 데이터 자체는 전건 계약 통과분이다. */
  aborted: z.boolean().optional(),
  abortReason: z.string().nullable().optional(),
  /** 조기 종료 시점의 누적 라이브 요청 수 — 차단 임계는 사후 재현이 불가능한 1회성 관측치다. */
  abortedAtRequest: z.number().int().nonnegative().nullable().optional(),
  /** 이번 실행의 총 라이브 요청 수(세션+목록+상세, 재시도 포함). */
  totalRequests: z.number().int().nonnegative().optional(),
  /** 예산 절단으로 상세를 포기한 픽 후보 수(매각기일 먼 순). */
  truncated: z.number().int().nonnegative().optional(),
  /** 상세 취득 커버리지 — 기일 이력 정밀도 지표(미취득분은 역산 폴백으로 채운다). */
  detailCoverage: z
    .object({
      candidates: z.number().int().nonnegative(),
      requested: z.number().int().nonnegative(),
      succeeded: z.number().int().nonnegative(),
    })
    .optional(),
  /** 기일 이력 출처 집계 — 산출물만 보고 실취득/역산 비율을 판정한다. */
  historySource: z
    .object({
      real: z.number().int().nonnegative(),
      backcalc: z.number().int().nonnegative(),
    })
    .optional(),
});
export type Meta = z.infer<typeof MetaSchema>;
