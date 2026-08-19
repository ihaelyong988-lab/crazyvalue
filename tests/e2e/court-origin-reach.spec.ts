import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { COURT_ORIGIN_URL, siteCourtLabel, splitCaseNo } from "../../src/lib/court-origin";
import { pickRegion } from "./fixture";

// 법원 원문 도달 3종 회귀(AGENTS §2-2 조문 6 · 감사 3차 J4에서 승격).
// 유닛(tests/unit/court-origin-reach.test.ts)이 "무엇이 렌더되는가"를 지키고,
// 여기서는 브라우저에서만 잴 수 있는 두 가지를 잰다:
//   ① 복사 버튼이 보이는 위치에서 법원 표기가 같은 화면에 있는가(감사 실측: 화면 밖 828px 위)
//   ② 클립보드에 실제로 담기는 문자열(번호 단독 — 목적지 입력칸이 받는 형태)
// 2026-08-20: href 단언을 데이터값 대조에서 **상수 대조 + 최상단 화면 규격**으로 바꿨다.
// 목적지가 실제로 열리는지(오류창 0)는 외부 네트워크가 필요해 라이브 게이트가 따로 잰다.

interface DetailItem {
  id: string;
  court: string;
  caseNo: string;
  itemNo: string;
  detailUrl: string;
}

const DATA_DIR = path.resolve(__dirname, "..", "..", "public", "data");
// 픽스처 지역은 산출물에서 고른다 — 특정 지역을 박으면 그 지역이 0건이 되는 주에 통째로 깨진다.
const region = pickRegion(0);
const item = (
  JSON.parse(readFileSync(path.join(DATA_DIR, `${region.key}.json`), "utf-8")) as DetailItem[]
)[0];
const detailPath = `/item/${encodeURIComponent(item.id)}`;
const parts = splitCaseNo(item.caseNo);
if (parts === null) throw new Error(`픽스처 사건번호 형식 밖: ${item.caseNo}`);
const { year: caseYear, no: caseNumber } = parts;

const WATCH_KEY = "crazyvalue.watchlist.v1";

/** 온보딩 억제(smoke.spec.ts와 동일 규약) */
async function suppressOnboarding(page: Page) {
  await page.addInitScript(
    ([key, json]) => window.localStorage.setItem(key, json),
    [
      WATCH_KEY,
      JSON.stringify({ items: {}, prefs: { regions: [], priceBands: [] }, onboarded: true }),
    ] as [string, string],
  );
}

const section = (page: Page) => page.locator('section[aria-label="법원 원문 확인"]');

test("상세: 법원 원문 도달 3종이 한 화면에서 완결된다", async ({ page }) => {
  await suppressOnboarding(page);
  await page.goto(detailPath);

  // ① 원문 화면 링크 — 단독 진입이 되는 최상단 화면(`…F00`/`…M00`)이어야 한다.
  const link = section(page).getByRole("link", { name: /법원경매정보에서 사건 조회/ });
  await expect(link).toHaveAttribute("href", COURT_ORIGIN_URL);
  await expect(link).toHaveAttribute("target", "_blank");
  expect(new URL(COURT_ORIGIN_URL).searchParams.get("w2xPath")).toMatch(/PGJ\w{3}(F|M)00\.xml$/);

  // ② 번호 복사 — 클립보드에 담기는 값은 번호 단독이다(입력칸이 maxlength 7에 한글을 지운다).
  const copyBtn = page.getByRole("button", { name: /번호 복사/ });
  await copyBtn.click();
  await expect(page.getByRole("button", { name: "복사됨" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(caseNumber);
  await expect(copyBtn).toBeVisible({ timeout: 4000 }); // 성공 라벨은 2초 뒤 복귀

  // ③ 찾는 방법 안내 — 선택 목록에 있는 법원 표기와 연도를 지목한다
  const howto = section(page).locator("p");
  await expect(howto).toContainText(siteCourtLabel(item.court));
  await expect(howto).toContainText(caseYear);

  // 복사 시점에 법원명이 같은 화면에 있는가 — 안내가 지시하는 값을 확인하러 위로 되돌아가지 않는다.
  // 복사 버튼을 화면 중앙에 두고 잰다(scrollIntoViewIfNeeded는 버튼을 화면 끝에 붙일 수 있어 판정이 흔들린다).
  await copyBtn.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const vp = page.viewportSize()!;
  const copyBox = (await copyBtn.boundingBox())!;
  const howtoBox = (await howto.boundingBox())!;
  expect(copyBox.y).toBeGreaterThanOrEqual(0);
  expect(howtoBox.y).toBeGreaterThanOrEqual(0);
  expect(howtoBox.y + howtoBox.height).toBeLessThanOrEqual(vp.height);
});

test("클립보드 차단: 폴백이 통지되고 실패 상태가 유지된다", async ({ page }) => {
  await suppressOnboarding(page);
  // 권한 거부 환경 모사 — Chrome이 실제로 던지는 NotAllowedError
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "clipboard", {
      configurable: true,
      get: () => ({
        writeText: () =>
          Promise.reject(new DOMException("Write permission denied.", "NotAllowedError")),
      }),
    });
  });
  await page.goto(detailPath);

  await page.getByRole("button", { name: /번호 복사/ }).click();
  const failLabel = page.getByRole("button", { name: "복사 실패" });
  await expect(failLabel).toBeVisible();

  // 실제 복구 수단(번호 문단)은 스크린리더에 통지돼야 한다 — 손으로 옮겨 적는 값도 입력칸 규격이다.
  const fallback = section(page).locator('p[role="alert"]');
  await expect(fallback).toBeVisible();
  await expect(fallback).toContainText(caseNumber);
  await expect(fallback).not.toContainText(item.caseNo);

  // 성공 라벨과 달리 실패 라벨은 복귀하지 않는다 — 한 화면이 두 상태를 말하면 안 된다.
  await page.waitForTimeout(2500);
  await expect(failLabel).toBeVisible();
  await expect(fallback).toBeVisible();
});
