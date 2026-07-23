import { expect, test } from "@playwright/test";

// 가로 오버플로 회귀 가드(2026-07-23 · §9 원장).
// 증상: 최근 본 물건 카드가 있는 홈에서 문서 scrollWidth가 뷰포트를 넘어(631 vs 397)
//       모바일 레이아웃 뷰포트가 넓어지고, position:fixed인 하단 CTA·탭바가 밀려 잘렸다.
// 원인: ItemCard 내부 sr-only가 position:absolute인데 카드에 기준 블록(relative)이 없어
//       가로 캐러셀(overflow-x-auto) 밖으로 탈출 → 문서를 가로로 늘림.
// 이 테스트는 "최근 본 물건이 있는 상태"를 반드시 포함한다 — 빈 상태만 보면 증상이 숨는다.
test("홈: 최근 본 물건 있을 때 가로 오버플로 0 · 하단 고정요소 정위치", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "crazyvalue.watchlist.v1",
      JSON.stringify({ items: {}, prefs: { regions: [], priceBands: [] }, onboarded: true }),
    );
    localStorage.setItem(
      "crazyvalue.recent.v1",
      JSON.stringify({
        ids: [
          "seoul-2025타경36267-2",
          "seoul-2025타경53446-2",
          "seoul-2025타경11700-3",
        ],
      }),
    );
  });
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
