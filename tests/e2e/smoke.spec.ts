import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
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

// 지역별 산출 건수는 갱신마다 바뀐다 — 특정 지역 고정 참조는 그 지역이 0건이 되는 주에 통째로 깨진다
// (2026-08-02: 서울 0건으로 이 파일이 로드 단계에서 실패했다). meta에서 결정적으로 고른다.
const DATA_DIR = path.resolve(__dirname, "..", "..", "public", "data");
const counts = (
  JSON.parse(readFileSync(path.join(DATA_DIR, "meta.json"), "utf-8")) as {
    countsByRegion: Record<string, number>;
  }
).countsByRegion;
/** 리스트 1페이지 노출 수(ItemList 페이지 크기) */
const PAGE_SIZE = 10;
// 더보기 검증 전제(1페이지 초과)를 만족하는 시도 중 사전순 첫 번째 — 실행마다 같은 지역을 고른다.
const fixtureKey = Object.keys(counts)
  .filter((k) => counts[k] > PAGE_SIZE)
  .sort()[0];
if (!fixtureKey) {
  throw new Error(`E2E 픽스처: ${PAGE_SIZE}건 초과 시도가 없다 — 산출물을 먼저 확인하라`);
}
const fixtureItems = JSON.parse(
  readFileSync(path.join(DATA_DIR, `${fixtureKey}.json`), "utf-8"),
) as FixtureItem[];
const first = fixtureItems[0];
/** 한글 시도명 — 필터 칩 이름·URL r 파라미터·카드 텍스트 대조에 함께 쓴다 */
const fixtureRegion = first.region;
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
  // 더보기 검증 전제: 픽스처 시도 단독 결과가 1페이지를 넘어야 한다(픽스처 선정 조건과 동일).
  expect(fixtureItems.length).toBeGreaterThan(PAGE_SIZE);

  await page.goto("/");

  // 새 컨텍스트 → 온보딩 시트 자동 노출 → 건너뛰기
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "건너뛰기" }).click();
  await expect(dialog).toBeHidden();

  // 필터 3탭: 지역 → 금액 → 용도. 칩 상태는 aria-pressed로 판정한다.
  const regionChip = page.getByRole("button", { name: fixtureRegion, exact: true });
  const priceChip = page.getByRole("button", { name: "1~3억", exact: true });
  const categoryChip = page.getByRole("button", { name: "상가", exact: true });
  await regionChip.click();
  await expect(regionChip).toHaveAttribute("aria-pressed", "true");
  await priceChip.click();
  await expect(priceChip).toHaveAttribute("aria-pressed", "true");
  await categoryChip.click();
  await expect(categoryChip).toHaveAttribute("aria-pressed", "true");

  // 3축이 모두 결과 링크 쿼리(r·b·c)로 연결되는지 href로 검증
  const resultLink = page.getByRole("link", { name: /물건.*건 보기/ });
  const href = decodeURIComponent((await resultLink.getAttribute("href")) ?? "");
  expect(href).toContain(`r=${fixtureRegion}`);
  expect(href).toContain("b=b3");
  expect(href).toContain("c=상가");

  // 3중 교집합은 지역·주차에 따라 1페이지 미만일 수 있어 "더보기"가 뜬다고 보장할 수 없다.
  // 3축 반영은 위 href로 검증했으므로 금액·용도를 해제하고 시도 단독 결과로 더보기를 검증한다.
  await priceChip.click();
  await categoryChip.click();
  await expect(priceChip).toHaveAttribute("aria-pressed", "false");
  await expect(categoryChip).toHaveAttribute("aria-pressed", "false");
  await expect(resultLink).toHaveText(new RegExp(`물건\\s*${fixtureItems.length}\\s*건 보기`));

  await resultLink.click();
  await expect(page).toHaveURL(/\/list\?/);
  expect(new URL(page.url()).searchParams.get("r")).toBe(fixtureRegion);

  // 첫 페이지는 1페이지분 노출 → 더보기 탭 → 다음 페이지분만큼 증가(전량 노출이 아니다)
  const cards = itemCards(page);
  await expect(cards).toHaveCount(PAGE_SIZE);
  const more = page.getByRole("button", { name: /더보기/ });
  await expect(more).toContainText(`(${PAGE_SIZE}/${fixtureItems.length})`);
  await more.click();
  await expect(cards).toHaveCount(Math.min(PAGE_SIZE * 2, fixtureItems.length));
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

// 기준일 바는 AppShell 헤더에 있어 모든 화면 상단에 상시 뜬다(§4.4-8) — 가드도 화면 단위여야 한다.
// 홈에만 걸었던 앞선 가드는 /guide 본문에 남아 있던 "다음 갱신일까지의 매각기일"을 통과시켰다.
// 화면을 배열로 두어 화면이 늘어도 같은 단언이 따라간다. ready는 그 화면이 실제로 렌더됐다는 표식이다 —
// 없으면 404·옛 번들을 서빙해도 부정 단언이 조용히 통과한다(§9 원장 2026-08-02).
const BAR_SCREENS: { name: string; path: string; ready: (page: Page) => Locator }[] = [
  {
    name: "홈",
    path: "/",
    ready: (page) => page.getByRole("heading", { level: 1, name: /유찰 2회 이상/ }),
  },
  { name: "리스트", path: "/list", ready: (page) => page.getByLabel("정렬") },
  {
    name: "안내",
    path: "/guide",
    ready: (page) => page.getByRole("heading", { name: /기준 공개/ }),
  },
];

for (const screen of BAR_SCREENS) {
  test(`기준일 바 — ${screen.name}: 새로 갱신 배지 상시 · 수집 시각만 표기`, async ({ page }) => {
    await suppressOnboarding(page);
    await page.goto(screen.path);
    await expect(screen.ready(page)).toBeVisible();

    // 배지는 조건부가 아니다 — 매일 03:00 갱신이라 "갱신 직후인가"를 따로 판정하지 않는다.
    const bar = page.getByRole("banner").locator("p").first();
    await expect(bar.getByText("새로 갱신", { exact: true })).toBeVisible();

    // 수집 날짜·시각은 갱신마다 바뀌므로 값을 고정하지 않고 표기 형식으로 단언한다(고정 픽스처 금지).
    // 신규 건수는 직전 산출물과 비교할 수 있을 때만 붙는다 — 비교 대상이 없거나 0이면 감추므로 선택 항이되,
    // 붙는다면 1 이상이다("신규 0건"이 새면 여기서 걸린다).
    await expect(bar).toHaveText(
      /^새로 갱신 \d{2}-\d{2}\([일월화수목금토]\) \d{2}:\d{2}( · 신규 [1-9][\d,]*건)?$/,
    );

    // 회귀 가드(2026-08-05 지시 2): 바에는 수집 날짜·시각·신규 건수만 두고,
    // 화면 어디에도 "다음 갱신" 예고·지연 문구를 남기지 않는다.
    await expect(page.getByText(/다음 갱신/)).toHaveCount(0);
    await expect(page.getByText(/데이터 기준:/)).toHaveCount(0);
  });
}

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
  const cheapest = [...fixtureItems].sort((a, b) => a.minPrice - b.minPrice)[0];
  const shown = Math.min(20, fixtureItems.length); // n=20 요청분과 실제 보유분 중 작은 쪽
  const assertRestored = async () => {
    await expect(page.getByLabel("정렬")).toHaveValue("price");
    const cards = itemCards(page);
    await expect(cards).toHaveCount(shown);
    await expect(cards.filter({ hasText: fixtureRegion })).toHaveCount(shown);
    // "최저가 낮은순" 정렬이 실제 적용됐는지 첫 카드로 확인
    const firstHref = decodeURIComponent((await cards.first().getAttribute("href")) ?? "");
    expect(firstHref).toBe(`/item/${cheapest.id}`);
  };

  await page.goto(`/list?r=${encodeURIComponent(fixtureRegion)}&sort=price&n=20`);
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
