import { expect, test, type Page } from "@playwright/test";
import { pickRegion } from "./fixture";

// 이탈 확인 시트(src/components/ExitGuard.tsx) 회귀 — 3차 감사 J7에서 실브라우저로 재현된 결함 3건을 고정한다.
//   ① 주 CTA 무동작: setOpen(false)가 무장 effect를 재실행해 센티넬 pushState가 router.push를 취소했다(J7-H·K).
//   ② 뒤로가기 문서 재로드: 센티넬이 history.state를 통째로 교체해 Next의 복원 마커가 사라졌다(J7-F·M).
//   ③ 시트가 열린 채 화면 전환: 배경 inert·스크롤 잠금이 남아 착지 화면이 잠겼다(J7-L).
// 픽스처는 산출물에서 고른다(고정 id 금지 — 갱신마다 물건이 바뀐다, fixture.ts 규약).

const WATCH_KEY = "crazyvalue.watchlist.v1";
const RECENT_KEY = "crazyvalue.recent.v1";

const { items: fixtureItems } = pickRegion(10);
const recentIds = fixtureItems.slice(0, 3).map((i) => i.id);

interface Probe {
  /** 문서가 재로드되면 사라지는 표식 — SPA 복원 여부의 직접 증거다. */
  __cvMark?: string;
}

/** 손실 시나리오 주입: 관심함 0건(온보딩 완료) + 최근 본 물건 N건. */
async function seed(page: Page, recent: string[]) {
  await page.addInitScript(
    ([wk, rk, json]) => {
      window.localStorage.setItem(
        wk,
        JSON.stringify({ items: {}, prefs: { regions: [], priceBands: [] }, onboarded: true }),
      );
      window.localStorage.setItem(rk, json);
    },
    [WATCH_KEY, RECENT_KEY, JSON.stringify({ ids: recent })] as [string, string, string],
  );
}

const homeReady = (page: Page) => page.getByRole("heading", { level: 1, name: /유찰 2회 이상/ });
const listReady = (page: Page) => page.getByLabel("정렬");
const sheet = (page: Page) => page.getByRole("dialog").filter({ hasText: "저장 없이 나가기" });
const watchToggle = (page: Page) => page.getByRole("button", { name: /^관심등록(됨)?$/ });

async function goHome(page: Page) {
  await page.goto("/");
  await expect(homeReady(page)).toBeVisible();
}

/** 홈에서 뒤로가기 1회 = 센티넬 소진 → 확인 시트. */
async function openSheet(page: Page) {
  await page.evaluate(() => history.back());
  await expect(sheet(page)).toBeVisible();
}

const pathOf = (page: Page) => decodeURIComponent(new URL(page.url()).pathname);

test("① 저장 CTA — 최근 물건을 실제로 관심등록하고 그 상세로 이동한다", async ({ page }) => {
  await seed(page, recentIds);
  await goHome(page);
  await openSheet(page);

  await page.getByRole("button", { name: "가장 최근 물건 저장" }).click();

  // 이동: 센티넬 재push가 router.push를 취소하면 홈에 머무른다(감사 3차 재현 결과).
  await expect.poll(() => pathOf(page)).toBe(`/item/${recentIds[0]}`);
  await expect(sheet(page)).toHaveCount(0);

  // 저장: 라벨이 약속한 관심등록이 실제로 일어났는가 — 화면 상태와 저장소를 모두 본다.
  await expect(page.getByRole("button", { name: "관심등록됨", exact: true })).toBeVisible();
  const saved = await page.evaluate(
    ([wk, id]) => {
      const raw = window.localStorage.getItem(wk);
      const parsed = raw ? (JSON.parse(raw) as { items: Record<string, unknown> }) : null;
      return { count: parsed ? Object.keys(parsed.items).length : -1, has: !!parsed?.items[id] };
    },
    [WATCH_KEY, recentIds[0]] as [string, string],
  );
  expect(saved).toEqual({ count: 1, has: true });
});

test("② 뒤로가기 — 홈 복원이 SPA다(문서 재로드 0 · 페이지 상태 생존)", async ({ page }) => {
  const docs: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "document") docs.push(r.url());
  });

  await seed(page, [recentIds[0]]);
  await goHome(page);
  await page.getByRole("link", { name: /물건.*건 보기/ }).click();
  await expect(listReady(page)).toBeVisible();

  const docsBefore = docs.length;
  await page.evaluate(() => {
    (window as unknown as Probe).__cvMark = "alive";
    history.back();
  });
  await expect(homeReady(page)).toBeVisible();

  // 표식 소멸 = 문서가 통째로 다시 로드됐다는 뜻이다(측정치: 복원 275ms·문서 요청 +1).
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Probe).__cvMark ?? "GONE"))
    .toBe("alive");
  expect(docs.length - docsBefore).toBe(0);
});

test("③ 시트 열림 중 뒤로 — 시트가 닫히고 착지 화면이 조작된다", async ({ page }) => {
  await seed(page, [recentIds[0]]);
  await goHome(page);
  await page.getByRole("link", { name: /물건.*건 보기/ }).click();
  await expect(listReady(page)).toBeVisible();
  await page.locator('a[href^="/item/"]').first().click();
  await expect(watchToggle(page)).toBeVisible();
  const detailPath = pathOf(page);

  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "홈" }).click();
  await expect(homeReady(page)).toBeVisible();
  await openSheet(page);

  await page.evaluate(() => history.back()); // 시트가 떠 있는 채로 한 번 더 뒤로
  await expect.poll(() => pathOf(page)).toBe(detailPath);
  await expect(sheet(page)).toHaveCount(0);

  // 잠금 해제는 클릭으로 잰다 — inert·스크롤 잠금이 남으면 여기서 타임아웃한다(감사 3차 2500ms 실패).
  await watchToggle(page).click({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: "관심등록됨", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  expect(
    await page.evaluate(() => (document.querySelector("main") as HTMLElement | null)?.inert),
  ).toBe(false);
});

test("④ 센티넬 — 홈 이력의 라우터 상태를 보존한 채 쌓는다", async ({ page }) => {
  await seed(page, [recentIds[0]]);
  await goHome(page);
  const sentinelKeys = await page.evaluate(() => Object.keys((history.state ?? {}) as object));
  expect(sentinelKeys).toContain("cvExitGuard");

  await openSheet(page); // 뒤로 1칸 = 센티넬 아래의 실제 홈 이력
  const homeKeys = await page.evaluate(() => Object.keys((history.state ?? {}) as object));

  // 센티넬이 state를 통째로 교체하면 여기서 라우터 마커가 통째로 빠진다 — ②의 문서 재로드가 그 결과다.
  expect(homeKeys.length).toBeGreaterThan(0);
  expect(sentinelKeys).toEqual(expect.arrayContaining(homeKeys));
});

test("⑤ 무장 조건 — 관심함에 1건이라도 있으면 가드하지 않는다", async ({ page }) => {
  await page.addInitScript(
    ([wk, rk, id]) => {
      window.localStorage.setItem(
        wk,
        JSON.stringify({
          items: {
            [id]: {
              addedAt: "2026-08-01T00:00:00.000Z",
              snapshot: { minPrice: 1, saleDate: "2026-08-20", failCount: 2 },
            },
          },
          prefs: { regions: [], priceBands: [] },
          onboarded: true,
        }),
      );
      window.localStorage.setItem(rk, JSON.stringify({ ids: [id] }));
    },
    [WATCH_KEY, RECENT_KEY, recentIds[0]] as [string, string, string],
  );

  await goHome(page);
  await page.waitForTimeout(500); // 무장은 마운트 직후 effect다 — 부재 판정에는 관측 창이 필요하다
  expect(
    await page.evaluate(() => ((history.state ?? {}) as { cvExitGuard?: boolean }).cvExitGuard),
  ).toBeUndefined();
});

test("⑥ 저장 실패 — 갱신에서 내려간 물건은 성공한 척하지 않는다", async ({ page }) => {
  await seed(page, [`${recentIds[0].split("-")[0]}-2024타경999999-9`]);
  await goHome(page);
  await openSheet(page);

  await page.getByRole("button", { name: "가장 최근 물건 저장" }).click();

  // 저장 못 한 채 상세로 보내면 404다(감사 3차 J7-I) — 실패를 시트에서 알리고 화면을 지킨다.
  await expect(page.getByRole("alert").filter({ hasText: "저장할 수 없다" })).toBeVisible();
  await expect(sheet(page)).toBeVisible();
  expect(pathOf(page)).toBe("/");
});
