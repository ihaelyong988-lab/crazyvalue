import type { Metadata, Viewport } from "next";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  // metadataBase: OG·트위터 이미지 상대 경로의 절대화 기준(빌드 경고 해소).
  metadataBase: new URL(SITE_URL),
  title: "미친가치 CrazyValue",
  description:
    "유찰 2회 이상, 가치 대비 가격이 내려간 법원경매 물건 큐레이션. 데이터는 매일 03:00 갱신되며 법적 효력은 법원 공고 원문이 우선한다.",
  // iOS 홈 화면 추가 아이콘(감사 2차 66) — 매니페스트 아이콘을 쓰지 않는 경로를 덮는다.
  // 파비콘은 src/app/favicon.ico 파일 규약이 그대로 담당한다.
  icons: {
    apple: [{ url: "/icons/apple-touch-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  // 홈의 대표 주소. metadata는 루트에서 잎으로 필드 단위 상속이라 이 값을 자식이 덮지 않으면
  // 모든 페이지가 "홈이 원본"이라고 말하게 된다 — 목록·안내·상세가 각자 canonical을 갖는 이유다.
  alternates: {
    canonical: "/",
  },
  // openGraph.title/description은 두지 않는다 — 각 페이지의 title/description이
  // og:title/og:description으로 자동 폴백되어 상세 generateMetadata와 충돌하지 않는다.
  openGraph: {
    type: "website",
    siteName: "미친가치 CrazyValue",
    locale: "ko_KR",
    images: [
      {
        url: "/og-default.png",
        width: 1200,
        height: 630,
        alt: "미친가치 CrazyValue — 법원경매 초저가 큐레이션",
      },
    ],
  },
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
