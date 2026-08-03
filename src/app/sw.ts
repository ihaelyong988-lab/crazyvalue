import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { ExpirationPlugin, NetworkFirst, Serwist, StaleWhileRevalidate } from "serwist";
import { defaultCache } from "@serwist/next/worker";

// 서비스워커(기획안 §8 Phase 4.2) — 프리캐시(빌드 산출물·public 정적 자원) + 런타임 캐시.
// /data/*.json은 StaleWhileRevalidate: 온라인이면 캐시 응답 후 백그라운드 재검증,
// 오프라인이면 직전 데이터를 그대로 연다. next.config.ts의 globPublicPatterns가
// data/**를 프리캐시에서 제외하므로 이 런타임 규칙이 항상 담당한다.

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// 오프라인 폴백(감사 2차 65) — 캐시에 없는 상세로 이동하면 지금까지는 아무 반응 없이 실패했다.
// 별도 라우트 파일 없이 서비스워커가 직접 문서 응답을 만든다(설치 대상 자원 증가 없음).
// 온라인 복귀는 online 이벤트로 감지해 같은 자리에서 1문장으로 알린다.
const OFFLINE_DOC = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0F2A43">
<title>오프라인 — 미친가치</title>
<style>
:root{color-scheme:light}
body{margin:0;background:#FAFAF8;color:#1A2332;font-family:Pretendard,-apple-system,BlinkMacSystemFont,system-ui,"Segoe UI","Malgun Gothic",sans-serif;font-size:15px;line-height:1.6}
header{background:#0F2A43;color:#fff;padding:0 16px;height:48px;display:flex;align-items:center;gap:6px}
header b{font-size:18px;letter-spacing:-.02em}
header span{font-size:11px;color:rgba(255,255,255,.7)}
main{max-width:28rem;margin:0 auto;padding:16px}
h1{font-size:17px;margin:8px 0 0}
p{margin:4px 0 0;font-size:13px}
button{margin-top:16px;width:100%;min-height:52px;border:0;border-radius:12px;background:#2456A6;color:#fff;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer}
:focus-visible{outline:2px solid #2456A6;outline-offset:2px}
</style></head>
<body><header><b>미친가치</b><span>CrazyValue</span></header>
<main>
<h1>오프라인</h1>
<p id="cv-offline-status" role="status">저장되지 않은 화면은 네트워크가 연결돼야 열린다.</p>
<button id="cv-offline-retry" type="button">다시 시도</button>
</main>
<script>
document.getElementById("cv-offline-retry").addEventListener("click",function(){location.reload()});
addEventListener("online",function(){
  document.getElementById("cv-offline-status").textContent="연결이 복구됐다 — 다시 시도를 눌러라.";
});
</script>
</body></html>`;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      // meta.json은 "데이터 기준일"을 말하는 신뢰 장치다 — SWR로 두면 갱신 직후에도 첫 요청이
      // 옛 날짜를 돌려줘, 리프레쉬를 눌러 수집이 끝났는데도 화면은 그대로다(2026-08-02 주인님 지적:
      // 휴대폰처럼 앱을 띄워두는 환경에서 특히 오래 남는다). 수백 바이트라 매번 받아도 부담이 없고,
      // 오프라인·응답 지연 시에는 캐시로 떨어져 직전 기준일을 계속 보여준다.
      // 지역 데이터보다 먼저 등록해야 아래 SWR 규칙에 먹히지 않는다(등록 순서 = 매칭 우선순위).
      matcher: ({ sameOrigin, url: { pathname } }) => sameOrigin && pathname === "/data/meta.json",
      handler: new NetworkFirst({
        cacheName: "auction-data",
        networkTimeoutSeconds: 3,
      }),
    },
    {
      // 지역 데이터 17개. 등록 순서가 매칭 우선순위 — defaultCache의
      // json 일반 규칙(NetworkFirst, static-data-assets)보다 먼저 두어야 SWR이 적용된다.
      // 함수 matcher로 /_next/data/ 등 다른 json 경로는 제외한다.
      matcher: ({ sameOrigin, url: { pathname } }) =>
        sameOrigin && pathname.startsWith("/data/") && pathname.endsWith(".json"),
      handler: new StaleWhileRevalidate({
        cacheName: "auction-data",
        plugins: [
          new ExpirationPlugin({
            maxEntries: 24,
            maxAgeSeconds: 30 * 24 * 60 * 60,
            maxAgeFrom: "last-used",
          }),
        ],
      }),
    },
    ...defaultCache,
  ],
});

// 화면 이동(document) 요청이 캐시·네트워크 모두에서 실패하면 오프라인 화면을 돌려준다.
// 그 외 자원은 기존대로 실패시킨다 — 화면 단위 고지가 아니면 사용자가 알 길이 없다.
serwist.setCatchHandler(async ({ request }) => {
  if (request.destination !== "document") return Response.error();
  return new Response(OFFLINE_DOC, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
});

serwist.addEventListeners();
