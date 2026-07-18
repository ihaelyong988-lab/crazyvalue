import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { formatKrw } from "../../src/lib/format";

// E2E 스모크 8종(기획안 §8 Phase 2.7). 시드 고정 목데이터(public/data/seoul.json)를
// node:fs로 읽어 실제 id·금액·기일을 기대값으로 쓴다. 각 테스트는 독립 컨텍스트다.

interface FixtureItem {
  id: string;
  address: string;
  category: string;
  region: string;
  district: string;
  minPrice: number;
  saleDate: string;
  failCount: number;
}

const seoulItems = JSON.parse(
  readFileSync(path.resolve(__dirname, "..", "..", "public", "data", "seoul.json"), "utf-8"),
) as FixtureItem[];
const first = seoulItems[0];
const firstItemPath = `/item/${encodeURIComponent(first.id)}`;

const WATCH_KEY = "crazyvalue.watchlist.v1";

/** /list·/watch의 물건 카드 = /item/{id} 링크 */
const itemCards = (page: Page) => page.locator('a[href^="/item/"]');

/** id로 특정 물건 카드를 찾는다 — href의 한글 인코딩 유무 양쪽을 허용 */
const cardById = (page: Page, id: string) =>
  page.locator(`a[href="/item/${id}"], a[href="/item/${encodeURIComponent(id)}"]`);

/** 온보딩 억제: onboarded 상태를 주입해 최초 방문 시트를 막는다 */
async function suppressOnboarding(page: Page) {
  await page.addInitScript(
    ([key, json]) => window.localStorage.setItem(key, json),
    [
      WATCH_KEY,
      JSON.stringify({ items: {}, prefs: { regions: [], priceBands: [] }, onboarded: true }),
    ] as [string, string],
  );
}

test("온보딩→필터 3탭→리스트 도달", async ({ page }) => {
  // 더보기 검증 전제: r=서울 단독 결과가 10건을 넘어야 한다(시드 데이터 14건).
  expect(seoulItems.length).toBeGreaterThan(10);

  await page.goto("/");

  // 새 컨텍스트 → 온보딩 시트 자동 노출 → 건너뛰기
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "건너뛰기" }).click();
  await expect(dialog).toBeHidden();

  // 필터 3탭: 지역 → 금액 → 용도. 칩 상태는 aria-pressed로 판정한다.
  const seoulChip = page.getByRole("button", { name: "서울", exact: true });
  const priceChip = page.getByRole("button", { name: "1~3억", exact: true });
  const categoryChip = page.getByRole("button", { name: "상가", exact: true });
  await seoulChip.click();
  await expect(seoulChip).toHaveAttribute("aria-pressed", "true");
  await priceChip.click();
  await expect(priceChip).toHaveAttribute("aria-pressed", "true");
  await categoryChip.click();
  await expect(categoryChip).toHaveAttribute("aria-pressed", "true");

  // 3축이 모두 결과 링크 쿼리(r·b·c)로 연결되는지 href로 검증
  const resultLink = page.getByRole("link", { name: /물건.*건 보기/ });
  const href = decodeURIComponent((await resultLink.getAttribute("href")) ?? "");
  expect(href).toContain("r=서울");
  expect(href).toContain("b=b3");
  expect(href).toContain("c=상가");

  // 시드 데이터에서 서울×금액×용도 3중 교집합은 최대 2건 — "더보기"(11건 이상 필요)가 뜰 수 없다.
  // 3축 반영은 위 href로 검증했으므로 금액·용도 칩을 해제하고 r=서울(전 14건)로 더보기를 검증한다.
  await priceChip.click();
  await categoryChip.click();
  await expect(priceChip).toHaveAttribute("aria-pressed", "false");
  await expect(categoryChip).toHaveAttribute("aria-pressed", "false");
  await expect(resultLink).toHaveText(new RegExp(`물건\\s*${seoulItems.length}\\s*건 보기`));

  await resultLink.click();
  await expect(page).toHaveURL(/\/list\?/);
  expect(new URL(page.url()).searchParams.get("r")).toBe("서울");

  // 첫 페이지는 10건 이하 노출 → 더보기 탭 → 카드 수 증가
  const cards = itemCards(page);
  await expect(cards).toHaveCount(10);
  const more = page.getByRole("button", { name: /더보기/ });
  await expect(more).toContainText(`(10/${seoulItems.length})`);
  await more.click();
  await expect(cards).toHaveCount(seoulItems.length);
});

test("상세: 가격·이력·원문·고지", async ({ page }) => {
  await suppressOnboarding(page);
  await page.goto(firstItemPath);

  // 픽스처 물건이 그대로 렌더되는지: 주소(h1) + 최저가 전체 자리 금액(가격 구조 섹션)
  await expect(page.getByRole("heading", { level: 1, name: first.address })).toBeVisible();
  await expect(page.locator('section[aria-label="가격 구조"]')).toContainText(
    `${first.minPrice.toLocaleString("ko-KR")}원`,
  );

  await expect(page.getByRole("button", { name: "관심등록", exact: true })).toBeVisible();
  await expect(page.locator('section[aria-label="기일 이력"]')).toBeVisible();

  const original = page.getByRole("link", { name: "법원경매정보에서 원문 보기" });
  await expect(original).toBeVisible();
  await expect(original).toHaveAttribute("href", /^https:\/\//);

  await expect(page.getByText(/법원 공고가 우선/)).toBeVisible();
});

test("관심등록→관심함 반영", async ({ page }) => {
  await page.goto(firstItemPath);

  await page.getByRole("button", { name: "관심등록", exact: true }).click();
  const watched = page.getByRole("button", { name: "관심등록됨", exact: true });
  await expect(watched).toBeVisible();
  await expect(watched).toHaveAttribute("aria-pressed", "true");

  await page.goto("/watch");
  await expect(cardById(page, first.id)).toBeVisible();
  await expect(page.getByText("관심 물건이 아직 없습니다")).toHaveCount(0);
});

test("관심함 재유찰 배지", async ({ page }) => {
  // 스냅샷 최저가를 실제보다 1천만 원 크게 주입 → 현재가가 더 낮음 = 재유찰 판정(§5.5).
  // saleDate는 실제와 동일하게 유지해 "기일 변경" 판정과 겹치지 않게 한다.
  const state = {
    items: {
      [first.id]: {
        addedAt: "2026-07-01T00:00:00.000Z",
        snapshot: {
          minPrice: first.minPrice + 10_000_000,
          saleDate: first.saleDate,
          failCount: first.failCount,
        },
      },
    },
    prefs: { regions: [], priceBands: [] },
    onboarded: true,
  };
  await page.addInitScript(
    ([key, json]) => window.localStorage.setItem(key, json),
    [WATCH_KEY, JSON.stringify(state)] as [string, string],
  );

  await page.goto("/watch");
  // 변화 카드는 오버레이 링크가 추가돼 같은 href의 a가 2개다(내부 ItemCard 링크는 inert — 감사 #11)
  const links = cardById(page, first.id);
  await expect(links).toHaveCount(2);
  await expect(links.first()).toBeVisible();

  // 배지는 이전→현재 최저가를 병기한다(감사 #17). 정확 일치 → 더 긴 오버레이 sr-only 텍스트는 제외.
  const badge = `재유찰 · ${formatKrw(first.minPrice + 10_000_000)}→${formatKrw(first.minPrice)}`;
  await expect(page.getByText(badge, { exact: true })).toBeVisible();

  // 접근 트리·탭 순서는 상태를 포함한 접근 이름의 오버레이 링크 1개가 대표한다(감사 #11)
  await expect(
    page.getByRole("link", {
      name: new RegExp(
        `^${badge} · ${first.category} · ${first.region} ${first.district} · 최저가 ${formatKrw(first.minPrice)} · 유찰 ${first.failCount}회 · (D-\\d+|D-day|기일 경과)$`,
      ),
    }),
  ).toBeVisible();
});

test("공유 URL 복사", async ({ page }) => {
  // Web Share API가 있으면 OS 공유 시트 경로로 빠져 복사가 실행되지 않는다 → 제거해 클립보드 폴백을 강제
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "share", {
      value: undefined,
      configurable: true,
    });
  });

  await page.goto(firstItemPath);
  await page.getByRole("button", { name: "공유", exact: true }).click();

  // 복사 완료 안내(2초 한시 노출) + 클립보드 실제 내용(권한은 config에서 부여)
  await expect(page.getByText("링크 복사됨")).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("/item/");
});

test("오류 상태 렌더", async ({ page }) => {
  await suppressOnboarding(page);
  await page.route("**/data/meta.json", (route) => route.abort());

  await page.goto("/");
  // Next.js 라우트 어나운서도 role="alert"를 가지므로 텍스트로 한정한다
  const alert = page.getByRole("alert").filter({ hasText: "불러오지 못했다" });
  await expect(alert).toBeVisible();
  await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
});

test("딥링크 복원(§13-11)", async ({ page }) => {
  const cheapest = [...seoulItems].sort((a, b) => a.minPrice - b.minPrice)[0];
  const assertRestored = async () => {
    await expect(page.getByLabel("정렬")).toHaveValue("price");
    const cards = itemCards(page);
    await expect(cards).toHaveCount(seoulItems.length); // n=20 ≥ 서울 전체 14건 → 전량 노출
    await expect(cards.filter({ hasText: "서울" })).toHaveCount(seoulItems.length);
    // "최저가 낮은순" 정렬이 실제 적용됐는지 첫 카드로 확인
    const firstHref = decodeURIComponent((await cards.first().getAttribute("href")) ?? "");
    expect(firstHref).toBe(`/item/${cheapest.id}`);
  };

  await page.goto("/list?r=서울&sort=price&n=20");
  await assertRestored();

  // 새로고침 후에도 URL 쿼리에서 동일 상태 복원
  await page.reload();
  await assertRestored();
});

test("안내 페이지", async ({ page }) => {
  await page.goto("/guide");

  // 용어 사전 항목(dt): "유찰"·"감정가"
  await expect(page.locator("dt").filter({ hasText: /^유찰$/ })).toBeVisible();
  await expect(page.locator("dt").filter({ hasText: /^감정가$/ })).toBeVisible();

  // 미친가치 픽 기준 공개
  await expect(page.getByRole("heading", { name: /기준 공개/ })).toBeVisible();
  await expect(page.getByText(/50% 이하/).first()).toBeVisible();

  // 법적 고지
  await expect(page.getByText(/법원 공고가 우선/)).toBeVisible();
});
