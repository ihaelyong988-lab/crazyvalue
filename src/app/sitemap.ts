import type { MetadataRoute } from "next";
import { buildMeta } from "@/lib/build-meta";
import { loadAllItems } from "@/lib/data-server";
import { SITE_URL } from "@/lib/site";

// /sitemap.xml — 크롤러가 이 앱의 페이지를 발견할 유일한 목록이다.
// 홈 HTML이 내보내는 링크는 /guide·/me·/watch 셋뿐이라(2026-08-23 실측) 목록도 상세도
// 링크를 따라가서는 닿지 않는다. 사이트맵이 없으면 홈 1페이지 말고는 색인 후보가 없다.
//
// 물건 상세를 전건 싣는다. 한 건이 법원·사건번호·소재지·감정가·최저가·유찰 횟수를 담은
// 한글 1,300자대 서버 렌더라, 이 앱에서 검색 유입이 걸릴 수 있는 문서는 사실상 이것뿐이다.
// (조사 초기에 상세가 404라고 판단해 제외했었다 — 측정 오류였다. 경위는 AGENTS §9.)
// 물건은 매일 물갈이되지만 사이트맵은 매 빌드에 다시 만들어지므로 목록과 어긋나지 않는다.
//
// lastModified 기준: 홈·목록·상세는 매일 갱신되는 수집 산출물이라 crawledAt이고, /guide는
// 손으로 쓴 문서라 그 문서를 고친 날짜다. 빌드 시각을 쓰면 내용이 그대로인 배포에도
// 갱신됐다고 말하게 된다.
const GUIDE_LAST_MODIFIED = "2026-08-05";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const dataLastModified = buildMeta.crawledAt;
  const items = await loadAllItems();

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
    ...items.map((item) => ({
      // canonical과 같은 형태로 적는다 — 사이트맵과 canonical이 다른 문자열이면
      // 크롤러가 둘을 다른 문서로 본다(id에 한글 "타경"이 들어간다).
      url: `${SITE_URL}/item/${encodeURIComponent(item.id)}`,
      lastModified: dataLastModified,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
