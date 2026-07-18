import type { Metadata, Viewport } from "next";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "미친가치 CrazyValue",
  description:
    "유찰 2회 이상, 가치 대비 가격이 내려간 법원경매 물건 큐레이션. 데이터는 매주 일요일 갱신되며 법적 효력은 법원 공고 원문이 우선한다.",
};

export const viewport: Viewport = {
  themeColor: "#0F2A43",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: onboarding-flag.js가 하이드레이션 전에 html 속성
    // (data-cv-onboarded)을 설정한다 — 이 요소의 속성 차이만 예외 처리(1단계 한정).
    <html lang="ko" suppressHydrationWarning>
      <body className="antialiased">
        {/* 온보딩 완료 플래그(감사 #28): 파서 차단 동기 스크립트 — 뒤따르는 온보딩 마크업이
            파싱되기 전에 실행이 보장되어 재방문 플래시가 구조적으로 없다.
            (next/script beforeInteractive는 페인트 전 실행 미보장 — 233ms 플래시 실측)
            의도된 파서 차단이므로 no-sync-scripts 규칙을 이 줄만 예외 처리한다. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/onboarding-flag.js" />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
