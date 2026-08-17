import { expect, test, type Page } from "@playwright/test";
import { pickAxes, pickRegion } from "./fixture";

// /me 관심조건 ↔ 홈 필터 동기화 회귀(감사 3차 32·초기화 2건). audit3-prefs 임시 스펙에서 승격했다.
// 지키는 계약 3가지:
//   ① /me에서 바꾼 조건이 홈 복귀·재진입에 열린다("저장됨, 홈 필터에 바로 반영."이 단언한 그대로)
//   ② 초기화 실패 시 표시 건수 = 실제 저장 건수
//   ③ 초기화는 확인 문구가 예고한 것만 지운다(설치 배너 해제 기록 보존)

const WATCH_KEY = "crazyvalue.watchlist.v1";
const RECENT_KEY = "crazyvalue.recent.v1";
const INSTALL_KEY = "crazyvalue.install.v1";

const { name: fixtureRegion, items: fixtureItems } = pickRegion(2);
const axes = pickAxes(fixtureItems);
const OTHER_REGION = fixtureRegion === "경기" ? "서울" : "경기";

const snap = (i: (typeof fixtureItems)[number]) => ({
  addedAt: "2026-08-01T00:00:00.000Z",
  snapshot: {
    minPrice: i.minPrice,
    saleDate: i.saleDate,
    failCount: i.failCount,
    address: i.address,
    category: i.category,
  },
});

/** 저장소 선주입 — 키가 이미 있으면 덮지 않는다(재내비게이션이 실측 상태를 지우지 않게). */
async function seed(
  page: Page,
  s: { watchItems?: number; recent?: number; installDismissed?: boolean },
) {
  const items: Record<string, unknown> = {};
  for (const i of fixtureItems.slice(0, s.watchItems ?? 0)) items[i.id] = snap(i);
  const payload = {
    watch: JSON.stringify({
      items,
      prefs: { regions: [], priceBands: [] },
      onboarded: true,
    }),
    recent: JSON.stringify({ ids: fixtureItems.slice(0, s.recent ?? 0).map((i) => i.id) }),
    install: s.installDismissed ? JSON.stringify({ dismissedAt: "2026-08-01T00:00:00.000Z" }) : null,
    keys: [WATCH_KEY, RECENT_KEY, INSTALL_KEY],
  };
  await page.addInitScript((d) => {
    const [w, r, inst] = d.keys;
    if (window.localStorage.getItem(w) === null) window.localStorage.setItem(w, d.watch);
    if (window.localStorage.getItem(r) === null) window.localStorage.setItem(r, d.recent);
    if (d.install !== null && window.localStorage.getItem(inst) === null)
      window.localStorage.setItem(inst, d.install);
  }, payload);
}

/** localStorage의 한 메서드만 던지게 만든다 — sessionStorage는 건드리지 않는다. */
async function breakLocalStorage(page: Page, method: "removeItem" | "setItem") {
  await page.addInitScript((m) => {
    const proto = Storage.prototype as unknown as Record<string, (k: string, v?: string) => void>;
    const orig = proto[m];
    proto[m] = function (this: Storage, k: string, v?: string) {
      if (this === window.localStorage) throw new DOMException("blocked by test", "SecurityError");
      return orig.call(this, k, v);
    };
  }, method);
}

const chip = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const countCell = (page: Page, label: string) => page.locator(`dt:text-is("${label}") + dd`);
const banner = (page: Page) => page.getByRole("region", { name: "홈 화면 설치 안내" });
const homeH1 = (page: Page) => page.getByRole("heading", { level: 1, name: /유찰 2회 이상/ });

// ───────────────────────────────────────────── ① 관심조건 → 홈

test("관심조건 저장 — 칩·저장소·안내 문구", async ({ page }) => {
  await seed(page, { installDismissed: true });
  await page.goto("/me");

  const region = chip(page, fixtureRegion);
  const band = chip(page, axes.band);
  await expect(region).toHaveAttribute("aria-pressed", "false");
  await region.click();
  await band.click();
  await expect(region).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("저장됨, 홈 필터에 바로 반영.")).toBeVisible();

  const prefs = await page.evaluate(
    (k) =>
      (JSON.parse(window.localStorage.getItem(k) ?? "{}") as { prefs: Record<string, unknown> })
        .prefs,
    WATCH_KEY,
  );
  console.log(`[저장] prefs=${JSON.stringify(prefs)}`);
  expect(prefs.regions).toEqual([fixtureRegion]);
  expect(prefs.priceBands).toEqual([axes.bandKey]);
  expect(typeof prefs.savedAt).toBe("number"); // 저장 시각 = 홈 복원이 미러와 나이를 겨루는 값
});

test("저장 실패(setItem 차단) — 알림 + 칩 원복", async ({ page }) => {
  await seed(page, { installDismissed: true });
  await breakLocalStorage(page, "setItem");
  await page.goto("/me");

  await chip(page, fixtureRegion).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "이 기기에 저장하지 못했다" }),
  ).toBeVisible();
  await expect(chip(page, fixtureRegion)).toHaveAttribute("aria-pressed", "false");
});

/** 홈 필터를 한 번 만지고 → /me에서 관심조건을 다른 지역으로 저장한다(복귀 시나리오 공통 전제). */
async function touchHomeThenSavePrefs(page: Page) {
  await page.goto("/");
  await chip(page, fixtureRegion).click();
  await expect(chip(page, fixtureRegion)).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("link", { name: "내 설정" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "내 설정" })).toBeVisible();
  await chip(page, OTHER_REGION).click();
  await expect(page.getByText("저장됨, 홈 필터에 바로 반영.")).toBeVisible();
}

const homeCondition = async (page: Page) => ({
  url: decodeURIComponent(page.url()),
  old: await chip(page, fixtureRegion).getAttribute("aria-pressed"),
  neo: await chip(page, OTHER_REGION).getAttribute("aria-pressed"),
  mirror: await page.evaluate(() =>
    window.sessionStorage.getItem("crazyvalue.home-filters.v1"),
  ),
});

test("조건 변경 후 하단탭 홈 — 새 조건이 열린다", async ({ page }) => {
  await seed(page, { installDismissed: true });
  await touchHomeThenSavePrefs(page);

  await page.getByRole("link", { name: "홈", exact: true }).click();
  await expect(homeH1(page)).toBeVisible();
  const s = await homeCondition(page);
  console.log(`[하단탭 홈] url=${s.url} · 옛=${s.old} · 새=${s.neo} · 미러=${s.mirror}`);
  expect(s.neo).toBe("true");
  expect(s.old).toBe("false");
});

test("조건 변경 후 뒤로가기 홈 — 새 조건이 열리고 이후 진입에도 유지된다", async ({ page }) => {
  await seed(page, { installDismissed: true });
  await touchHomeThenSavePrefs(page);

  await page.goBack(); // 방문자의 가장 흔한 복귀 수단
  await expect(homeH1(page)).toBeVisible();
  const back = await homeCondition(page);
  console.log(`[뒤로가기 홈] url=${back.url} · 옛=${back.old} · 새=${back.neo} · 미러=${back.mirror}`);

  // 회귀 지점: 옛 URL이 미러로 되살아나면 이 탭에서는 다시는 새 조건이 열리지 않는다.
  await page.getByRole("link", { name: "내 설정" }).click();
  await page.getByRole("link", { name: "홈", exact: true }).click();
  await expect(homeH1(page)).toBeVisible();
  const again = await homeCondition(page);
  console.log(`[재진입 홈] url=${again.url} · 옛=${again.old} · 새=${again.neo} · 미러=${again.mirror}`);

  expect(back.neo).toBe("true");
  expect(again.neo).toBe("true");
});

test("탭 닫고 재방문 — 홈이 저장한 관심조건으로 열린다", async ({ context }) => {
  const p1 = await context.newPage();
  await p1.goto("/");
  await p1.getByRole("dialog").getByRole("button", { name: "건너뛰기" }).click();
  await p1.getByRole("link", { name: "내 설정" }).click();
  await chip(p1, fixtureRegion).click();
  await chip(p1, axes.band).click();
  await expect(p1.getByText("저장됨, 홈 필터에 바로 반영.")).toBeVisible();
  await p1.close(); // 탭 닫기 → sessionStorage 소멸, localStorage 잔존

  const p2 = await context.newPage();
  await p2.goto("/");
  await expect(homeH1(p2)).toBeVisible();
  await expect(chip(p2, fixtureRegion)).toHaveAttribute("aria-pressed", "true");
  await expect(chip(p2, axes.band)).toHaveAttribute("aria-pressed", "true");
});

// ───────────────────────────────────────────── ②③ 초기화

test("초기화 실패 — 표시 건수가 실제 저장 건수와 같다", async ({ page }) => {
  await seed(page, { watchItems: 3, recent: 4, installDismissed: true });
  await breakLocalStorage(page, "removeItem");
  await page.goto("/me");

  await expect(countCell(page, "관심함")).toHaveText("3건");
  await page.getByRole("button", { name: "초기화" }).click();
  await page.getByRole("button", { name: "지우기" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "지우지 못했다" })).toBeVisible();
  const stored = await page.evaluate(
    (keys) => {
      const w = JSON.parse(window.localStorage.getItem(keys[0]) ?? "{}") as {
        items: Record<string, unknown>;
      };
      const r = JSON.parse(window.localStorage.getItem(keys[1]) ?? "{}") as { ids: string[] };
      return { watch: Object.keys(w.items).length, recent: r.ids.length };
    },
    [WATCH_KEY, RECENT_KEY],
  );
  console.log(`[초기화 실패] 저장소=관심 ${stored.watch}건/최근 ${stored.recent}건`);
  await expect(countCell(page, "관심함")).toHaveText(`${stored.watch}건`);
  await expect(countCell(page, "최근 본 물건")).toHaveText(`${stored.recent}건`);
  expect(stored.watch).toBe(3);
});

test("초기화 성공 — 건수·칩·저장값 소거(예고한 범위만)", async ({ page }) => {
  await seed(page, { watchItems: 3, recent: 4, installDismissed: true });
  await page.goto("/me");
  await chip(page, fixtureRegion).click();
  await expect(chip(page, fixtureRegion)).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "초기화" }).click();
  await page.getByRole("button", { name: "지우기" }).click();

  await expect(page.getByText("초기화됨.")).toBeVisible();
  await expect(countCell(page, "관심함")).toHaveText("0건");
  await expect(countCell(page, "최근 본 물건")).toHaveText("0건");
  await expect(chip(page, fixtureRegion)).toHaveAttribute("aria-pressed", "false");
  const left = await page.evaluate(() =>
    Object.keys(window.localStorage).filter((k) => k.startsWith("crazyvalue.")),
  );
  console.log(`[초기화 성공] 잔존 crazyvalue.* = ${JSON.stringify(left)}`);
  expect(left).toEqual([INSTALL_KEY]); // 확인 문구가 예고한 셋만 사라진다
});

test("초기화해도 닫은 설치 배너는 되살아나지 않는다", async ({ context }) => {
  const p1 = await context.newPage();
  await p1.goto("/");
  await p1.getByRole("dialog").getByRole("button", { name: "건너뛰기" }).click();

  // 배너는 /me에서 오프셋을 다시 재 제자리로 온다 — 방문자 동선 그대로 거기서 닫는다.
  await p1.getByRole("link", { name: "내 설정" }).click();
  await expect(p1.getByRole("heading", { level: 1, name: "내 설정" })).toBeVisible();
  await banner(p1).getByRole("button", { name: "닫기" }).click();
  await expect(banner(p1)).toHaveCount(0);

  await p1.getByRole("button", { name: "초기화" }).click();
  const confirmText = (await p1.locator("#cv-reset-desc").innerText()).trim();
  await p1.getByRole("button", { name: "지우기" }).click();
  await expect(p1.getByText("초기화됨.")).toBeVisible();
  const afterReset = await p1.evaluate((k) => window.localStorage.getItem(k), INSTALL_KEY);
  console.log(`[초기화 후] 확인 문구="${confirmText}" · ${INSTALL_KEY}=${afterReset}`);
  expect(confirmText).not.toMatch(/설치|배너/); // 예고에 없는 것은 지우지 않는다
  expect(afterReset).not.toBeNull();
  await p1.close();

  const p2 = await context.newPage(); // 재방문(주입 없음 — 실제 저장소 그대로)
  await p2.goto("/");
  await expect(homeH1(p2)).toBeVisible();
  // 배너는 하이드레이션 후 마운트된다 — 온보딩 시트 판정이 끝날 시간을 준 뒤 부재를 단언한다.
  await p2.waitForTimeout(1_000);
  const bannerBack = await banner(p2).count();
  console.log(`[재방문] 설치 배너=${bannerBack}개`);
  expect(bannerBack).toBe(0);
});
