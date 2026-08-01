import { readFileSync } from "node:fs";
import path from "node:path";

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
