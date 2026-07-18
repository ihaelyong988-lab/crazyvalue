// PWA manifest — 기획안 §8 Phase 4.1 전문(값 변경 금지). §1.1 병용 표기 규범: name 병기·short_name 한글.
import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "미친가치 CrazyValue",
    short_name: "미친가치",
    description: "유찰 2회 이상, 가치 대비 가격이 내려간 법원경매 물건 큐레이션",
    start_url: "/",
    display: "standalone",
    background_color: "#FAFAF8",
    theme_color: "#0F2A43",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
