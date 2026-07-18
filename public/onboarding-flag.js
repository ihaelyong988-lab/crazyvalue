// 재방문자(온보딩 완료) 플래그를 첫 페인트 전에 문서에 표시한다.
// 목적: 온보딩 시트를 SSR HTML에 포함(첫 방문 LCP 단축)하면서, 완료자에게는 깜빡임 없이 숨긴다.
// 로드 계약(감사 #28): layout.tsx <body> 최상단의 동기 <script src>로만 로드한다(async·defer 금지)
// — 파서가 이 스크립트 실행 전에는 뒤따르는 온보딩 마크업을 파싱하지 않는다.
try {
  var raw = localStorage.getItem("crazyvalue.watchlist.v1");
  if (raw && JSON.parse(raw).onboarded === true) {
    document.documentElement.setAttribute("data-cv-onboarded", "1");
  }
} catch {
  // localStorage 접근 불가(프라이빗 모드 등) — 온보딩을 그대로 보여준다.
}
