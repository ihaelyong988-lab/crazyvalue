// 재방문자(온보딩 완료) 플래그를 첫 페인트 전에 문서에 표시한다.
// 목적: 온보딩 시트를 SSR HTML에 포함(첫 방문 LCP 단축)하면서, 완료자에게는 깜빡임 없이 숨긴다.
try {
  var raw = localStorage.getItem("crazyvalue.watchlist.v1");
  if (raw && JSON.parse(raw).onboarded === true) {
    document.documentElement.setAttribute("data-cv-onboarded", "1");
  }
} catch (e) {
  // localStorage 접근 불가(프라이빗 모드 등) — 온보딩을 그대로 보여준다.
}
