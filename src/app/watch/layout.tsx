import type { Metadata } from "next";

// 화면 제목(감사 3차 100) — 탭 5종 중 관심함만 h1도 document.title도 없어, 제목 개요에 정체성이
// 없고 브라우저 히스토리·공유·홈화면 바로가기에 "관심함"이라는 이름이 남지 않았다.
// page.tsx가 "use client"라 metadata를 둘 수 없어 레이아웃이 소유한다. h1도 여기 두는 이유는
// 로딩·오류·빈 상태·목록 네 갈래 반환 전부에서 제목이 보장돼야 하기 때문이다(한 갈래만 고치면 절반 처방이다).
export const metadata: Metadata = {
  title: "관심함 — 기일·재유찰 추적 | 미친가치",
};

export default function WatchLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <h1 className="px-4 pt-4 text-lg font-bold">관심함</h1>
      {children}
    </>
  );
}
