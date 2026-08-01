import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// 0건 UX 회귀 가드 — 홈 하단 고정 CTA의 count===0 분기(§4.3-① 5)와 리스트의 빈 결과 완화
// 제안(감사 25·26)을 한 흐름으로 잇는다. 0건에서 "물건 0건 보기"라고 쓰면 결과가 있는 것으로
// 읽히고, 탭한 뒤에야 빈 화면을 만난다 — CTA가 0건 사실을 먼저 말하고 다음 행동으로 넘겨야 한다.
//
// 0건 조합은 고정하지 않고 산출물에서 고른다 — 직전 설계는 "토지 × ~5천만"을 0건으로 못박았으나
// 실데이터에서 그 교집합은 268건이라 전제가 통째로 깨졌다(2026-08-02). 데이터가 바뀌어도
// "0건 → 완화 → 결과 복귀" 흐름 자체는 계속 검증되도록 조합을 매번 다시 고른다.

interface FixtureItem {
  category: string;
  minPrice: number;
}

const DATA_DIR = path.resolve(__dirname, "..", "..", "public", "data");

const allItems: FixtureItem[] = readdirSync(DATA_DIR)
  .filter((f) => f.endsWith(".json") && f !== "meta.json")
  .flatMap((f) => JSON.parse(readFileSync(path.join(DATA_DIR, f), "utf-8")) as FixtureItem[]);

/** src/lib/data.ts PRICE_BANDS의 사본 — 게이트는 제품 코드를 재사용하지 않고 독립 대조한다. */
const PRICE_BANDS = [
  { key: "b1", label: "~5천만", min: 0, max: 50_000_000 },
  { key: "b2", label: "5천만~1억", min: 50_000_000, max: 100_000_000 },
  { key: "b3", label: "1~3억", min: 100_000_000, max: 300_000_000 },
  { key: "b4", label: "3~10억", min: 300_000_000, max: 1_000_000_000 },
  { key: "b5", label: "10억~", min: 1_000_000_000, max: Number.POSITIVE_INFINITY },
] as const;
type Band = (typeof PRICE_BANDS)[number];
/** 경계 규약: 하한 초과~상한 이하. 첫 구간만 0을 포함한다(lib/data.ts inBand와 동일). */
const inBand = (won: number, b: Band) => (b.key === "b1" ? won <= b.max : won > b.min && won <= b.max);

// 교집합은 0이면서 두 축 단독으로는 결과가 있는 조합 — 그래야 완화 후 결과 복귀까지 이어진다.
const categories = [...new Set(allItems.map((i) => i.category))].sort();
const combo = PRICE_BANDS.flatMap((band) => categories.map((category) => ({ band, category }))).find(
  ({ band, category }) => {
    const ofCategory = allItems.filter((i) => i.category === category);
    return (
      ofCategory.length > 0 &&
      allItems.some((i) => inBand(i.minPrice, band)) &&
      ofCategory.every((i) => !inBand(i.minPrice, band))
    );
  },
);

const WATCH_KEY = "crazyvalue.watchlist.v1";

/** 온보딩 억제: onboarded 상태를 주입해 최초 방문 시트를 막는다(smoke.spec.ts와 동일 규약) */
async function suppressOnboarding(page: Page) {
  await page.addInitScript(
    ([key, json]) => window.localStorage.setItem(key, json),
    [
      WATCH_KEY,
      JSON.stringify({ items: {}, prefs: { regions: [], priceBands: [] }, onboarded: true }),
    ] as [string, string],
  );
}

/**
 * 홈 하단 고정 결과 CTA — 상시 마운트되는 aria-live 컨테이너 안의 링크다(감사 백로그 5).
 * 컨테이너 경유로 잡아 "건수·상태 변화가 공지되는 영역 안에 CTA가 있다"는 구조까지 함께 지킨다.
 */
const homeCta = (page: Page) => page.locator('div[aria-live="polite"][aria-atomic="true"] a');

/** /list의 물건 카드 = /item/{id} 링크 */
const itemCards = (page: Page) => page.locator('a[href^="/item/"]');

// 라벨 한 줄 수용 여부는 가장 좁은 대상 폭에서 판정한다(iPhone SE급 375px).
test.use({ viewport: { width: 375, height: 812 } });

test("0건 조건(용도 × 금액): 홈 CTA가 없음을 알리고 리스트 완화 제안으로 잇는다", async ({
  page,
}) => {
  expect(
    combo,
    "0건이 되는 (용도 × 금액) 조합이 산출물에 없다 — 0건 UX를 검증할 상태를 만들 수 없다",
  ).toBeDefined();
  if (!combo) return;

  await suppressOnboarding(page);
  await page.goto("/");

  // 0건 조합 선택. 칩 상태는 aria-pressed로 판정한다.
  const priceChip = page.getByRole("button", { name: combo.band.label, exact: true });
  const categoryChip = page.getByRole("button", { name: combo.category, exact: true });
  await categoryChip.click();
  await expect(categoryChip).toHaveAttribute("aria-pressed", "true");
  await priceChip.click();
  await expect(priceChip).toHaveAttribute("aria-pressed", "true");

  // 검증 1: CTA는 0건 사실을 말한다 — "물건 0건 보기"류 문구가 남아 있으면 안 된다.
  const cta = homeCta(page);
  await expect(cta).toBeVisible();
  await expect(cta).toHaveText(/조건에 맞는 물건 없음|물건 없음/);
  await expect(cta).not.toHaveText(/물건\s*0\s*건 보기/);

  // 동작은 그대로 — 선택한 2축을 담은 /list 링크다(§13 규칙 11 URL 계약).
  const href = decodeURIComponent((await cta.getAttribute("href")) ?? "");
  expect(href).toContain(`b=${combo.band.key}`);
  expect(href).toContain(`c=${combo.category}`);

  // 검증 2: 탭 → /list 이동, 결과 0건 + 완화 제안 노출(홈에 별도 완화 UI를 두지 않는 전제)
  await cta.click();
  await expect(page).toHaveURL(/\/list\?/);
  const params = new URL(page.url()).searchParams;
  expect(params.get("b")).toBe(combo.band.key);
  expect(params.get("c")).toBe(combo.category);
  await expect(itemCards(page)).toHaveCount(0);

  // 라벨 문구는 구현 소유 — 금액 조건을 푸는 버튼임만 느슨하게 단언한다.
  const relax = page.getByRole("button", { name: /금액/ });
  await expect(relax).toBeVisible();

  // 검증 3: 완화 버튼 → 금액 조건 해제 → 토지 결과 복귀
  await relax.click();
  await expect(itemCards(page)).not.toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("b")).toBeNull();
});
