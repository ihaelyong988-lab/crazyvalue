import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { formatMonthDayKr, seoulDateTime } from "../../src/lib/format";

// 기준일 고착 회귀 가드(2026-08-09).
//
// 같은 결함을 다섯 번 고치고도 재발했다. 이유는 단순하다 — "화면이 말하는 날짜가 산출물의 날짜와
// 같은가"를 단언하는 테스트가 하나도 없었다. smoke.spec의 기준일 바 가드는 표기 형식만 본다
// (\d{2}-\d{2} 패턴). 일주일 묵은 날짜도 그 정규식을 통과한다. 형식이 아니라 값을 건다.

const META = JSON.parse(
  readFileSync(path.resolve(__dirname, "..", "..", "public", "data", "meta.json"), "utf-8"),
) as { crawledAt: string; newCount?: number };

const stamp = seoulDateTime(META.crawledAt);
if (!stamp) {
  throw new Error(`E2E 가드: meta.json crawledAt을 읽지 못했다 — ${META.crawledAt}`);
}
/** 산출물이 말하는 기준일을 화면 표기 규약 그대로 조립한 기대값 */
const EXPECTED = `새로 갱신 ${formatMonthDayKr(stamp.date)} ${stamp.time}${
  META.newCount ? ` · 신규 ${META.newCount}건` : ""
}`;

/** 기준일 바 = 헤더(banner) 첫 문단. 알림(형식 오류·새 배포)은 그 아래 role=status가 따로 맡는다. */
const dateBar = (page: Page) => page.getByRole("banner").locator("p").first();

test("헤더 기준일이 산출물의 수집 시각과 값까지 일치한다", async ({ page }) => {
  await page.goto("/");
  await expect(dateBar(page)).toHaveText(EXPECTED);
});

test("데이터 요청이 전부 실패해도 헤더 기준일은 흔들리지 않는다", async ({ page }) => {
  // 고착이 만들어지던 조건 그대로다 — 망이 죽으면 예전 화면은 캐시된 옛 날짜를 띄우고 그대로 굳었다.
  // 이제 날짜는 HTML에 구워져 있어 네트워크와 무관해야 한다. 이 단언이 그 불변식이다.
  await page.route("**/data/*.json", (route) => route.abort());
  await page.goto("/");
  await expect(dateBar(page)).toHaveText(EXPECTED);
});

test("서비스워커 캐시에 옛 기준일이 남아 있어도 화면은 산출물 날짜를 말한다", async ({ page }) => {
  // 주인님 폰에서 실제로 벌어진 상태를 심는다: auction-data 캐시에 일주일 묵은 meta를 넣고 들어간다.
  await page.goto("/");
  await page.evaluate(async () => {
    const old = {
      crawledAt: "2026-08-02T17:35:22+09:00",
      totalCount: 1000,
      countsByRegion: { seoul: 1 },
      nextUpdateAt: "2026-08-03T03:00:00+09:00",
    };
    const cache = await caches.open("auction-data");
    await cache.put(
      "/data/meta.json",
      new Response(JSON.stringify(old), { headers: { "Content-Type": "application/json" } }),
    );
  });

  await page.reload();
  await expect(dateBar(page)).toHaveText(EXPECTED);
  // 옛 값이 "새 배포"로 오인돼 새로고침 안내가 뜨지도 않아야 한다 — 판정은 "다르다"가 아니라 "더 새롭다"다.
  await expect(page.getByRole("button", { name: /새로고침/ })).toHaveCount(0);
});
