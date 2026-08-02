import { defineConfig, devices } from "@playwright/test";

// Playwright E2E 스모크 설정(기획안 §8 Phase 2.7).
// webServer가 직접 빌드한다 — `npm run start`만 띄우면 옛 .next를 서빙해 새 라우트가 404가 되고,
// 원인이 코드로 보인다(2026-08-02: 리프레쉬 5건이 전부 그렇게 실패했다).
// 서버가 이미 떠 있으면 재사용하므로, 라우트를 추가한 뒤에는 서버를 내리고 다시 돌려야 한다.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3000",
    // 공유 버튼의 클립보드 폴백 검증용(스모크 5) — chromium 권한명
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: [
    {
      // 모바일 온리 PWA 전제 — iPhone 13 뷰포트, 브라우저는 chromium 1개 프로젝트만.
      // 디바이스 기본값 defaultBrowserType(webkit)은 browserName 명시로 덮어쓴다.
      name: "mobile-chromium",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    // 빌드가 포함된 시간이다 — /item/[id] 정적 생성이 1,000건이라 기동만 잡은 120초로는 모자란다.
    timeout: 420_000,
  },
});
