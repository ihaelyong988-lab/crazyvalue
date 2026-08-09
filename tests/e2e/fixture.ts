import { readFileSync } from "node:fs";
import path from "node:path";
import { PRICE_BANDS } from "../../src/lib/data";
import { CATEGORIES } from "../../src/types/catalog";

// E2E 픽스처 선택기 — 지역별 산출 건수는 갱신마다 바뀐다.
// 테스트가 특정 지역·특정 id를 고정 참조하면 그 지역이 0건이 되는 주에 통째로 깨진다
// (2026-08-02: 서울 0건 하나로 smoke·layout-overflow가 동시에 실패했다).
// 그래서 "어느 지역인가"가 아니라 "조건을 만족하는 지역"을 산출물에서 결정적으로 고른다.

export interface FixtureItem {
  id: string;
  address: string;
  category: string;
  region: string;
  district: string;
  minPrice: number;
  saleDate: string;
  failCount: number;
}

const DATA_DIR = path.resolve(__dirname, "..", "..", "public", "data");
const counts = (
  JSON.parse(readFileSync(path.join(DATA_DIR, "meta.json"), "utf-8")) as {
    countsByRegion: Record<string, number>;
  }
).countsByRegion;

/** 보유 건수가 minCount를 넘는 시도 중 사전순 첫 번째. 실행마다 같은 지역을 고른다. */
export function pickRegion(minCount = 0): { key: string; name: string; items: FixtureItem[] } {
  const key = Object.keys(counts)
    .filter((k) => counts[k] > minCount)
    .sort()[0];
  if (!key) {
    throw new Error(`E2E 픽스처: ${minCount}건 초과 시도가 없다 — 산출물을 먼저 확인하라`);
  }
  const items = JSON.parse(
    readFileSync(path.join(DATA_DIR, `${key}.json`), "utf-8"),
  ) as FixtureItem[];
  return { key, name: items[0].region, items };
}

/**
 * 지역 안에서 결과가 비지 않는 금액구간·용도 조합을 고른다.
 *
 * 위 pickRegion과 같은 규칙을 나머지 두 축에도 적용한다. 라벨을 고정하면(예: 1~3억 × 상가)
 * 그 조합이 0건인 주에 결과 CTA 자체가 사라져 테스트가 링크를 못 찾고 타임아웃한다 —
 * 2026-08-09 CI 실패가 정확히 그것이다(데이터가 08-07로 바뀌며 픽스처 지역이 부산→충북으로
 * 옮겨갔고, 충북에는 상가가 0건이었다). 원장 2026-08-02 처방을 지역에만 적용한 절반짜리였다.
 *
 * 건수가 가장 많은 조합을 고른다 — 동수는 카탈로그 순서로 갈라 실행마다 같은 값을 준다.
 */
export function pickAxes(items: FixtureItem[]): {
  band: string;
  bandKey: string;
  category: string;
  count: number;
} {
  let best: { band: string; bandKey: string; category: string; count: number } | null = null;
  for (const b of PRICE_BANDS) {
    for (const c of CATEGORIES) {
      const count = items.filter(
        (i) => i.minPrice >= b.min && i.minPrice < b.max && i.category === c,
      ).length;
      if (count > 0 && (!best || count > best.count)) {
        best = { band: b.label, bandKey: b.key, category: c, count };
      }
    }
  }
  if (!best) {
    throw new Error("E2E 픽스처: 금액×용도 교집합이 1건도 없다 — 산출물을 먼저 확인하라");
  }
  return best;
}
