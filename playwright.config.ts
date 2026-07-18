import { defineConfig, devices } from "@playwright/test";

// Playwright E2E 스모크 설정(기획안 §8 Phase 2.7).
// 실행 전제: `npm run build` 선행 — webServer는 프로덕션 서버(next start)를 띄우거나 재사용한다.
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
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
