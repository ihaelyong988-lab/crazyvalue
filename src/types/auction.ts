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
});
export type Meta = z.infer<typeof MetaSchema>;
