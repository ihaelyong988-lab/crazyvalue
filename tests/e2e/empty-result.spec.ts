import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// 0건 UX 회귀 가드 — 홈 하단 고정 CTA의 count===0 분기(§4.3-① 5)와 리스트의 빈 결과 완화
// 제안(감사 25·26)을 한 흐름으로 잇는다. 0건에서 "물건 0건 보기"라고 쓰면 결과가 있는 것으로
// 읽히고, 탭한 뒤에야 빈 화면을 만난다 — CTA가 0건 사실을 먼저 말하고 다음 행동으로 넘겨야 한다.
//
// 왜 "토지 + ~5천만(b1)"이 0건인가 — 시드 목데이터(public/data/*.json)의 사실:
//   토지 15건은 금액대가 1~3억(b3) 3건 · 3~10억(b4) 12건뿐이라 5천만 이하(b1)와 교집합이 없다.
//   금액 조건만 풀면 토지 15건이 되살아나므로 "0건 → 완화 → 결과 복귀"가 한 번에 검증된다.
// 데이터 교체 시 이 전제가 깨질 수 있어 아래 픽스처 단언으로 먼저 확인한다 —
// 그 단언이 실패하면 테스트가 아니라 조합(용도×금액)을 0건이 되는 값으로 다시 골라야 한다.

interface FixtureItem {
  category: string;
  minPrice: number;
}

const DATA_DIR = path.resolve(__dirname, "..", "..", "public", "data");

const allItems: FixtureItem[] = readdirSync(DATA_DIR)
  .filter((f) => f.endsWith(".json") && f !== "meta.json")
  .flatMap((f) => JSON.parse(readFileSync(path.join(DATA_DIR, f), "utf-8")) as FixtureItem[]);

/** b1 = 최저가 5천만 이하. 첫 구간만 하한 0을 포함한다(lib/data.ts inBand 규약). */
const B1_MAX = 50_000_000;
const landItems = allItems.filter((i) => i.category === "토지");

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

test("0건 조건(토지 + ~5천만): 홈 CTA가 없음을 알리고 리스트 완화 제안으로 잇는다", async ({
  page,
}) => {
  // 시나리오 전제(데이터 교체 시 여기서 먼저 깨진다)
  expect(
    landItems.filter((i) => i.minPrice <= B1_MAX),
    "토지 × ~5천만 교집합이 0건이어야 0건 상태를 만들 수 있다",
  ).toHaveLength(0);
  expect(
    landItems.length,
    "금액 조건 해제 후 결과가 되살아나려면 토지가 1건 이상이어야 한다",
  ).toBeGreaterThan(0);

  await suppressOnboarding(page);
  await page.goto("/");

  // 0건 조합 선택: 용도 토지 + 금액 ~5천만. 칩 상태는 aria-pressed로 판정한다.
  const priceChip = page.getByRole("button", { name: "~5천만", exact: true });
  const categoryChip = page.getByRole("button", { name: "토지", exact: true });
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
  expect(href).toContain("b=b1");
  expect(href).toContain("c=토지");

  // 검증 2: 탭 → /list 이동, 결과 0건 + 완화 제안 노출(홈에 별도 완화 UI를 두지 않는 전제)
  await cta.click();
  await expect(page).toHaveURL(/\/list\?/);
  const params = new URL(page.url()).searchParams;
  expect(params.get("b")).toBe("b1");
  expect(params.get("c")).toBe("토지");
  await expect(itemCards(page)).toHaveCount(0);

  // 라벨 문구는 구현 소유 — 금액 조건을 푸는 버튼임만 느슨하게 단언한다.
  const relax = page.getByRole("button", { name: /금액/ });
  await expect(relax).toBeVisible();

  // 검증 3: 완화 버튼 → 금액 조건 해제 → 토지 결과 복귀
  await relax.click();
  await expect(itemCards(page)).not.toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("b")).toBeNull();
});
