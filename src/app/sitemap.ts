import type { MetadataRoute } from "next";
import { buildMeta } from "@/lib/build-meta";
import { SITE_URL } from "@/lib/site";

// /sitemap.xml — 크롤러가 이 앱의 페이지를 발견할 유일한 목록이다.
// 홈 HTML이 내보내는 링크는 /guide·/me·/watch 셋뿐이라(2026-08-23 실측) 목록 화면조차
// 링크를 따라가서는 닿지 않는다. 사이트맵이 없으면 홈 1페이지 말고는 색인 후보가 없다.
//
// 물건 상세(/item/[id])는 아직 넣지 않는다. 같은 날 실측에서 프로덕션 상세가 전량 404였다
// (X-Matched-Path: /404). 404를 사이트맵에 실으면 검색엔진에 없는 문서를 제출하는 것이고,
// 그 상태가 도메인 전체의 수집 신뢰도를 깎는다. 상세가 실제로 열리는 것을 확인한 커밋에서
// 여기에 추가한다.
//
// lastModified 기준: 홈·목록은 매일 갱신되는 수집 산출물이라 crawledAt이고, /guide는 손으로 쓴
// 문서라 그 문서를 고친 날짜다. 빌드 시각을 쓰면 내용이 그대로인 배포에도 갱신됐다고 말하게 된다.
const GUIDE_LAST_MODIFIED = "2026-08-05";

export default function sitemap(): MetadataRoute.Sitemap {
  const dataLastModified = buildMeta.crawledAt;
  return [
    {
      url: SITE_URL,
      lastModified: dataLastModified,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${SITE_URL}/list`,
      lastModified: dataLastModified,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/guide`,
      lastModified: GUIDE_LAST_MODIFIED,
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];
}
