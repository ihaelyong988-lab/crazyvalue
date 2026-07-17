import type { Metadata, Viewport } from "next";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";

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
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
