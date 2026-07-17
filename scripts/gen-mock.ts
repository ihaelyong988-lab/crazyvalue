/**
 * 목데이터 생성기 — 시드 20260717 고정(결정적 산출).
 * 120건 · 용도 8종 전부 · 유찰 2~5회 · 저감률 20%/30% 혼합(법원별) · 17개 시·도 분포 · 픽 포함.
 * 산출: public/data/{region}.json ×17 + meta.json. 전건 zod 통과 실패 시 종료 코드 1(무산출).
 * 실행: npm run mock
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AuctionItemSchema,
  REGIONS,
  CATEGORIES,
  type AuctionItem,
  type Meta,
} from "../src/types/auction";

const SEED = 20260717;
function mulberry32(seed: number) {
  let s = seed;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

// 데이터 기준: 직전 일요일 03:00 KST(2026-07-12) — 갱신 서사와 일치
const CRAWLED_AT = "2026-07-12T03:00:00+09:00";
const NEXT_UPDATE_AT = "2026-07-19T03:00:00+09:00";
const BASE_DATE = "2026-07-12";

const addDays = (dateOnly: string, days: number): string =>
  new Date(Date.parse(dateOnly + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);

// 지역 분포(합 120) · 법원 · 저감률(법원별 20% 또는 30% — 전국 일률 아님)
const PLAN: { key: string; count: number; court: string; rate: number; districts: string[] }[] = [
  { key: "seoul", count: 14, court: "서울중앙지방법원", rate: 0.2, districts: ["강남구", "노원구", "마포구", "구로구"] },
  { key: "busan", count: 9, court: "부산지방법원", rate: 0.2, districts: ["해운대구", "사하구", "부산진구"] },
  { key: "daegu", count: 7, court: "대구지방법원", rate: 0.3, districts: ["수성구", "달서구", "북구"] },
  { key: "incheon", count: 8, court: "인천지방법원", rate: 0.3, districts: ["남동구", "부평구", "서구"] },
  { key: "gwangju", count: 5, court: "광주지방법원", rate: 0.3, districts: ["북구", "광산구"] },
  { key: "daejeon", count: 5, court: "대전지방법원", rate: 0.3, districts: ["서구", "유성구"] },
  { key: "ulsan", count: 4, court: "울산지방법원", rate: 0.2, districts: ["남구", "울주군"] },
  { key: "sejong", count: 2, court: "대전지방법원 세종지원", rate: 0.3, districts: ["세종시"] },
  { key: "gyeonggi", count: 20, court: "수원지방법원", rate: 0.3, districts: ["수원시 영통구", "성남시 분당구", "부천시", "안산시 단원구", "평택시"] },
  { key: "gangwon", count: 6, court: "춘천지방법원", rate: 0.3, districts: ["춘천시", "원주시", "강릉시"] },
  { key: "chungbuk", count: 5, court: "청주지방법원", rate: 0.2, districts: ["청주시 흥덕구", "충주시"] },
  { key: "chungnam", count: 6, court: "대전지방법원 천안지원", rate: 0.3, districts: ["천안시 서북구", "아산시"] },
  { key: "jeonbuk", count: 6, court: "전주지방법원", rate: 0.3, districts: ["전주시 완산구", "군산시"] },
  { key: "jeonnam", count: 6, court: "광주지방법원 순천지원", rate: 0.3, districts: ["순천시", "여수시", "목포시"] },
  { key: "gyeongbuk", count: 7, court: "대구지방법원 포항지원", rate: 0.2, districts: ["포항시 북구", "구미시", "경주시"] },
  { key: "gyeongnam", count: 7, court: "창원지방법원", rate: 0.3, districts: ["창원시 성산구", "김해시", "진주시"] },
  { key: "jeju", count: 3, court: "제주지방법원", rate: 0.3, districts: ["제주시", "서귀포시"] },
];

// 용도별 감정가 범위(원)
const PRICE_RANGE: Record<string, [number, number]> = {
  아파트: [150_000_000, 1_500_000_000],
  다세대: [60_000_000, 400_000_000],
  단독다가구: [100_000_000, 900_000_000],
  오피스텔: [50_000_000, 350_000_000],
  상가: [80_000_000, 1_200_000_000],
  토지: [30_000_000, 2_000_000_000],
  공장창고: [200_000_000, 3_000_000_000],
  기타: [20_000_000, 500_000_000],
};

const NOTES: (string | null)[] = [
  null, null, null, null, null, null,
  "재매각 사건. 입찰보증금은 최저매각가격의 20%",
  "대항력 있는 임차인 존재 가능 — 매각물건명세서 확인 요망",
  "지분 매각",
  "토지 별도 등기",
  "제시 외 건물 포함",
];

const round1000 = (n: number) => Math.round(n / 1000) * 1000;

function makeItem(globalIdx: number, p: (typeof PLAN)[number], regionName: string): AuctionItem {
  const category = CATEGORIES[globalIdx % CATEGORIES.length];
  const [lo, hi] = PRICE_RANGE[category];
  const appraisal = round1000(lo + rng() * (hi - lo));
  const failCount = 2 + Math.floor(rng() * 4); // 2~5
  const minPrice = round1000(appraisal * Math.pow(1 - p.rate, failCount));
  const priceRatio = Number((minPrice / appraisal).toFixed(4));

  // 매각기일: 기준일 +3~+48일. 앞 2건은 기일 경과 케이스(-3일)로 고정해 경과 처리 검증.
  const saleDate = globalIdx < 2 ? addDays(BASE_DATE, -3) : addDays(BASE_DATE, 3 + Math.floor(rng() * 45));

  // 기일 이력: 신건 1 + 유찰 failCount (35일 간격 역산). 일부 회차에 "변경" 삽입.
  const history: AuctionItem["history"] = [];
  const firstDate = addDays(saleDate, -35 * (failCount + 1));
  history.push({ date: firstDate, minPrice: appraisal, result: "신건" });
  for (let k = 1; k <= failCount; k++) {
    history.push({
      date: addDays(saleDate, -35 * (failCount + 1 - k)),
      minPrice: round1000(appraisal * Math.pow(1 - p.rate, k - 1)),
      result: "유찰",
    });
  }
  if (rng() < 0.12) {
    history.push({ date: addDays(saleDate, -20), minPrice, result: "변경" });
  }

  const note = pick(NOTES);
  const isResale = note !== null && note.startsWith("재매각");
  const deposit = round1000(minPrice * (isResale ? 0.2 : 0.1));
  const caseNo = `2025타경${String(10000 + Math.floor(rng() * 89999))}`;
  const itemNo = String(1 + Math.floor(rng() * 3));
  const district = pick(p.districts);
  const hasBuilding = category !== "토지";
  const dong = 1 + Math.floor(rng() * 999);

  return {
    id: `${p.key}-${caseNo}-${itemNo}`,
    court: p.court,
    caseNo,
    itemNo,
    category,
    address: `${regionName} ${district} ${["중앙로", "번영로", "산업로", "평화로"][globalIdx % 4]} ${dong}`,
    region: regionName,
    district,
    appraisalPrice: appraisal,
    minPrice,
    priceRatio,
    failCount,
    saleDate,
    saleTime: pick(["10:00", "10:30", "14:00"]),
    courtRoom: `경매법정 ${pick(["제1호", "제2호", "제3호"])}`,
    deposit,
    areaBuilding: hasBuilding ? Number((30 + rng() * 220).toFixed(1)) : null,
    areaLand: category === "아파트" ? null : Number((40 + rng() * 900).toFixed(1)),
    photoUrl: null, // MVP 목데이터는 무사진 — 카드·상세는 용도별 플레이스홀더 분기 렌더
    detailUrl: "https://www.courtauction.go.kr/",
    history,
    specialNote: note,
  };
}

function main() {
  const outDir = join(process.cwd(), "public", "data");
  mkdirSync(outDir, { recursive: true });

  const byRegion: Record<string, AuctionItem[]> = {};
  let idx = 0;
  for (const p of PLAN) {
    const regionName = REGIONS.find((r) => r.key === p.key)!.name;
    byRegion[p.key] = Array.from({ length: p.count }, () => makeItem(idx++, p, regionName));
  }

  // 검증 게이트: 전건 zod 통과 + id 중복 0 (§5.4와 동일 규율 — 실패 시 산출하지 않는다)
  const all = Object.values(byRegion).flat();
  const ids = new Set<string>();
  let errors = 0;
  for (const item of all) {
    const parsed = AuctionItemSchema.safeParse(item);
    if (!parsed.success) {
      errors++;
      console.error(`[검증 실패] ${item.id}:`, parsed.error.issues.map((i) => i.message).join("; "));
    }
    if (ids.has(item.id)) {
      errors++;
      console.error(`[중복 id] ${item.id}`);
    }
    ids.add(item.id);
  }
  if (errors > 0 || all.length !== 120) {
    console.error(`목데이터 생성 실패 — 오류 ${errors}건, 총 ${all.length}건(기대 120)`);
    process.exit(1);
  }

  const countsByRegion: Record<string, number> = {};
  for (const p of PLAN) {
    countsByRegion[p.key] = byRegion[p.key].length;
    writeFileSync(join(outDir, `${p.key}.json`), JSON.stringify(byRegion[p.key], null, 1));
  }
  const meta: Meta = {
    crawledAt: CRAWLED_AT,
    totalCount: all.length,
    countsByRegion,
    nextUpdateAt: NEXT_UPDATE_AT,
  };
  writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 1));

  // 실행 요약(§13 규칙 9 관측성 규율과 동일 형식)
  const picks = all.filter((i) => i.priceRatio <= 0.5).length;
  const categories = new Set(all.map((i) => i.category)).size;
  console.log(
    `목데이터 생성 완료 — 총 ${all.length}건 · 픽 ${picks}건 · 용도 ${categories}종 · 지역 ${PLAN.length}개 · 시드 ${SEED}`,
  );
  if (picks === 0) {
    console.error("픽 0건 — 사양(픽 포함) 위반");
    process.exit(1);
  }
}

main();
