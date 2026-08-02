import { expect, test, type Page } from "@playwright/test";

// 리프레쉬 탭 — 외부 GitHub API를 실제로 치지 않도록 /api/refresh를 가로챈다.
// 계약은 "상태별로 화면이 무엇을 말하고 버튼이 눌리는가"다. 상태를 숨기면 방문자는
// 버튼을 눌러도 아무 일도 안 일어난 것으로 읽는다.

const WATCH_KEY = "crazyvalue.watchlist.v1";

async function suppressOnboarding(page: Page) {
  await page.addInitScript(
    ([key, json]) => window.localStorage.setItem(key, json),
    [
      WATCH_KEY,
      JSON.stringify({ items: {}, prefs: { regions: [], priceBands: [] }, onboarded: true }),
    ] as [string, string],
  );
}

async function mockRefresh(page: Page, body: Record<string, unknown>, postStatus = 202) {
  await page.route("**/api/refresh", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: postStatus,
        contentType: "application/json",
        body: JSON.stringify({ ...body, state: postStatus === 202 ? "running" : body.state }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

const idle = { state: "idle", lastRunAt: "2026-08-01T00:00:00Z", cooldownUntil: null, runUrl: null };

test("홈 옆 리프레쉬 탭으로 이동한다", async ({ page }) => {
  await suppressOnboarding(page);
  await mockRefresh(page, idle);
  await page.goto("/");

  const tab = page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "리프레쉬" });
  await expect(tab).toBeVisible();
  await tab.click();

  await expect(page).toHaveURL(/\/refresh$/);
  await expect(page.getByRole("heading", { name: "리프레쉬" })).toBeVisible();
  // 현재 탭 표시가 리프레쉬로 옮겨간다(색만이 아니라 aria-current로 병행 전달).
  await expect(tab).toHaveAttribute("aria-current", "page");
});

test("실행 가능 상태 — 버튼이 눌리고 시작 사실을 알린다", async ({ page }) => {
  await suppressOnboarding(page);
  await mockRefresh(page, idle);
  await page.goto("/refresh");

  const button = page.getByRole("button", { name: "지금 다시 수집" });
  await expect(button).toBeEnabled();
  await button.click();

  // 시작 사실은 낭독 영역에서 말한다 — 화면이 그대로면 방문자는 실패로 읽는다.
  await expect(page.getByText("수집을 시작했다.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "수집 중" })).toBeDisabled();
});

test("쿨다운 — 버튼이 잠기고 남은 시간을 말한다", async ({ page }) => {
  await suppressOnboarding(page);
  // 해제 시각을 넉넉히 미래로 둬 실행 시각에 관계없이 잔여가 남게 한다.
  const future = new Date(Date.now() + 3 * 3_600_000).toISOString();
  await mockRefresh(page, {
    state: "cooldown",
    lastRunAt: "2026-08-02T00:00:00Z",
    cooldownUntil: future,
    runUrl: "https://github.com/o/r/actions/runs/1",
  });
  await page.goto("/refresh");

  await expect(page.getByRole("button", { name: "지금 다시 수집" })).toBeDisabled();
  await expect(page.getByText(/다시 실행할 수 있다/)).toBeVisible();
  await expect(page.getByRole("link", { name: "실행 기록 보기" })).toBeVisible();
});

test("진행 중 — 남은 소요를 말하고 중복 실행을 막는다", async ({ page }) => {
  await suppressOnboarding(page);
  await mockRefresh(page, {
    state: "running",
    lastRunAt: "2026-08-02T00:00:00Z",
    cooldownUntil: null,
    runUrl: "https://github.com/o/r/actions/runs/2",
  });
  await page.goto("/refresh");

  await expect(page.getByText(/수집이 진행 중이다/)).toBeVisible();
  await expect(page.getByRole("button", { name: "수집 중" })).toBeDisabled();
});

test("직전 실행 실패 — 조용히 넘어가지 않는다", async ({ page }) => {
  await suppressOnboarding(page);
  // 실측 사례: 세션 GET 거부로 런이 죽었고, 폴링은 running에서 idle로 돌아갈 뿐이었다.
  await mockRefresh(page, {
    state: "idle",
    lastRunAt: "2026-08-02T00:10:00Z",
    cooldownUntil: null,
    runUrl: "https://github.com/o/r/actions/runs/3",
    lastConclusion: "failure",
  });
  await page.goto("/refresh");

  await expect(page.getByText(/직전 수집이 완료되지 못해/)).toBeVisible();
  await expect(page.getByRole("button", { name: "지금 다시 수집" })).toBeEnabled();
});

test("권한 미설정 — 할 수 없는 이유를 숨기지 않는다", async ({ page }) => {
  await suppressOnboarding(page);
  await mockRefresh(page, {
    state: "unconfigured",
    lastRunAt: null,
    cooldownUntil: null,
    runUrl: null,
  });
  await page.goto("/refresh");

  await expect(page.getByText(/실행 권한이 아직 설정되지 않았다/)).toBeVisible();
  await expect(page.getByRole("button", { name: "지금 다시 수집" })).toBeDisabled();
});
