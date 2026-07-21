import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

// 서비스워커 빌드(기획안 §8 Phase 4.2) — webpack 빌드에서 src/app/sw.ts를 public/sw.js로 번들.
// 개발 모드는 비활성(캐시 간섭 방지). globPublicPatterns는 public 전체를 프리캐시하되
// data/**만 제외한다 — /data/*.json은 sw.ts의 StaleWhileRevalidate 규칙이 담당(오프라인 직전 데이터 열람).
const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  globPublicPatterns: ["*", "!(data)/**/*"],
});

const nextConfig: NextConfig = {};

export default withSerwist(nextConfig);
