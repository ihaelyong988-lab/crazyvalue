import { expect, test, type Page } from "@playwright/test";
import type { AuctionItem, Meta } from "../../src/types/auction";
import { pickRegion } from "./fixture";

// 운영 JSON을 쓰지 않는다. 유효한 기존 물건의 계약만 재사용해 날짜·빈 지역 상태를 고정한다.
const specimen = pickRegion().items[0] as AuctionItem;
const makeItem = (saleDate: string, id = "period-seoul-1"): AuctionItem => ({
  ...specimen,
  id,
  region: "서울",
  district: "종로구",
  address: "서울특별시 종로구 기간 검증 물건",
  saleDate,
});
const legacy: Meta = {
  crawledAt: "2026-10-04T20:57:28Z",
  nextUpdateAt: "2026-10-05T18:00:00Z",
  totalCount: 1,
  countsByRegion: { seoul: 1, jeonbuk: 0 },
};

async function fixture(page: Page, meta: Meta, items: AuctionItem[]) {
  await page.addInitScript(() => {
    window.localStorage.setItem("crazyvalue.watchlist.v1", JSON.stringify({
      items: {}, prefs: { regions: [], priceBands: [] }, onboarded: true,
    }));
  });
  await page.route("**/data/*.json*", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    await route.fulfill({
      json: name === "meta.json" ? meta : name === "seoul.json" ? items : [],
    });
  });
}

const homeCta = (page: Page) => page.locator('div[aria-live="polite"][aria-atomic="true"] a');
const cards = (page: Page) => page.locator('a[href^="/item/"]');
test.use({ serviceWorkers: "block", viewport: { width: 375, height: 812 } });

test("옛 메타의 KST 7일 기간은 반복 필터·빈 전북·조건 해제에서도 유지된다", async ({ page }, testInfo) => {
  await fixture(page, legacy, [makeItem("2026-10-08")]);
  await page.goto("/");
  const period = page.getByTestId("output-period");
  await expect(period).toHaveText("제공 기간 2026-10-05~2026-10-11 · 매각기일 기준, 양 끝날 포함.");
  const jeonbuk = page.getByRole("button", { name: "전북", exact: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    await jeonbuk.click();
    await expect(jeonbuk).toHaveAttribute("aria-pressed", "true");
    await expect(homeCta(page)).toHaveText(/조건에 맞는 물건 없음/);
    await expect(period).toContainText("2026-10-05~2026-10-11");
    await jeonbuk.click();
    await expect(jeonbuk).toHaveAttribute("aria-pressed", "false");
    await expect(homeCta(page)).toHaveText(/1건/);
  }
  await jeonbuk.click();
  await homeCta(page).click();
  await expect(page).toHaveURL(/\/list\?/);
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByText("현재 제공 기간에 조건에 맞는 물건이 없다", { exact: true })).toBeVisible();
  await expect(period).toContainText("2026-10-05~2026-10-11");
  const screenshot = testInfo.outputPath("empty-jeonbuk-period.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach("빈 전북과 제공 기간", { path: screenshot, contentType: "image/png" });
  await page.getByRole("button", { name: "지역 조건 해제(전국 보기)", exact: true }).click();
  await expect(cards(page)).toHaveCount(1);
  await expect(period).toContainText("2026-10-05~2026-10-11");
  expect(new URL(page.url()).searchParams.get("r")).toBeNull();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("다음 수집의 10/6~12 기간에는 10/12 물건이 표시된다", async ({ page }) => {
  const meta: Meta = {
    ...legacy,
    crawledAt: "2026-10-05T20:57:28Z",
    outputWindow: { start: "2026-10-06", end: "2026-10-13", endInclusive: false },
    outputSaleDateRange: { first: "2026-10-12", last: "2026-10-12" },
  };
  await fixture(page, meta, [makeItem("2026-10-12")]);
  await page.goto("/list");
  await expect(page.getByTestId("output-period")).toHaveText("제공 기간 2026-10-06~2026-10-12 · 매각기일 기준, 양 끝날 포함.");
  await expect(cards(page)).toHaveCount(1);
  await expect(page.getByTestId("output-period")).not.toContainText("2026-10-13");
});

test("full 보충분은 우선 기간과 게시 기일을 구분하고 빈 안내도 게시 자료 기준으로 바뀐다", async ({ page }) => {
  const meta: Meta = {
    ...legacy,
    totalCount: 2,
    countsByRegion: { seoul: 2, jeonbuk: 0 },
    outputWindow: { start: "2026-10-05", end: "2026-10-12", endInclusive: false },
    outputSaleDateRange: { first: "2026-10-05", last: "2026-10-19" },
  };
  await fixture(page, meta, [makeItem("2026-10-05"), makeItem("2026-10-19", "period-seoul-2")]);
  await page.goto(`/list?r=${encodeURIComponent("전북")}`);
  const period = page.getByTestId("output-period");
  await expect(period).toHaveText("우선 제공 기간 2026-10-05~2026-10-11 · 게시 물건 기일 2026-10-05~2026-10-19 · 양 끝날 포함.");
  await expect(page.getByText("현재 게시 물건에 조건에 맞는 물건이 없다", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "전북 필터 해제", exact: true }).click();
  await expect(cards(page)).toHaveCount(2);
  await expect(period).toContainText("2026-10-05~2026-10-19");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
