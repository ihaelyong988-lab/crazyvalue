import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// /robots.txt — 수집 규칙. 이 파일이 없어서 검색엔진이 규칙과 사이트맵 위치를 물어볼 곳이 없었다.
//
// 색인에서 빼는 것들:
//   /api/·/refresh — 화면이 아니거나(수집 트리거) 사람이 읽을 문서가 아니다.
//   /me·/watch     — 본문이 전부 이 기기 localStorage에서 나온다. 크롤러가 받으면 빈 화면이라
//                    수집해도 담을 내용이 없고, 그 빈 문서가 검색결과에 남는다.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/refresh", "/me", "/watch"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
