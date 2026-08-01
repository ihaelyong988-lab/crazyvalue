import { expect, test } from "@playwright/test";
import { pickRegion } from "./fixture";

// 가로 오버플로 회귀 가드(2026-07-23 · §9 원장).
// 증상: 최근 본 물건 카드가 있는 홈에서 문서 scrollWidth가 뷰포트를 넘어(631 vs 397)
//       모바일 레이아웃 뷰포트가 넓어지고, position:fixed인 하단 CTA·탭바가 밀려 잘렸다.
// 원인: ItemCard 내부 sr-only가 position:absolute인데 카드에 기준 블록(relative)이 없어
//       가로 캐러셀(overflow-x-auto) 밖으로 탈출 → 문서를 가로로 늘림.
// 이 테스트는 "최근 본 물건이 있는 상태"를 반드시 포함한다 — 빈 상태만 보면 증상이 숨는다.
test("홈: 최근 본 물건 있을 때 가로 오버플로 0 · 하단 고정요소 정위치", async ({ page }) => {
  // 최근 본 물건 id는 산출물에서 결정적으로 뽑는다 — 고정 id는 그 지역이 0건인 주에 섹션이
  // 아예 안 떠서 회귀 가드가 조용히 무력화된다(2026-08-02: 서울 0건으로 여기서 실패했다).
  const recentIds = pickRegion(2).items.slice(0, 3).map((i) => i.id);
  await page.addInitScript((ids: string[]) => {
    localStorage.setItem(
      "crazyvalue.watchlist.v1",
      JSON.stringify({ items: {}, prefs: { regions: [], priceBands: [] }, onboarded: true }),
    );
    localStorage.setItem("crazyvalue.recent.v1", JSON.stringify({ ids }));
  }, recentIds);
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "최근 본 물건" })).toBeVisible();

  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const rect = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) };
    };
    return {
      viewportW: de.clientWidth,
      docScrollW: de.scrollWidth,
      resultBtn: rect('div[aria-live="polite"]'),
      tabs: rect("nav"),
    };
  });

  expect(m.docScrollW, "문서 가로 스크롤 폭이 뷰포트를 넘으면 안 된다").toBeLessThanOrEqual(
    m.viewportW,
  );
  expect(m.resultBtn?.r, "하단 결과 버튼이 뷰포트 밖으로 나가면 안 된다").toBeLessThanOrEqual(
    m.viewportW,
  );
  expect(m.tabs?.r, "하단 탭바가 뷰포트 밖으로 나가면 안 된다").toBeLessThanOrEqual(m.viewportW);
});
