import type { Metadata } from "next";

// 화면 제목(감사 3차 100) — /list는 h1도 document.title도 없어 제목 개요에 이름이 없고,
// 히스토리·공유·홈화면 바로가기에 "미친가치 CrazyValue"만 남았다(홈과 구분되지 않는다).
// page.tsx가 "use client"라 metadata를 둘 수 없어 레이아웃이 소유한다. h1도 여기 두는 이유는
// 로딩·오류·빈 상태·목록 네 갈래 반환 전부에서 제목이 보장돼야 하기 때문이다.
export const metadata: Metadata = {
  title: "물건 목록 — 지역·금액·용도 필터 | 미친가치",
};

export default function ListLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* sr-only — 화면 상단은 이미 적용 중 필터 칩과 "총 N건"이 이 목록의 정체를 말한다.
          시각적 제목 줄을 얹으면 같은 정보가 두 번 뜨고(중복 표시 금지) 첫 화면 카드가
          그만큼 밀린다(세로 리듬). 제목 개요·보조기술 경로는 이 h1과 metadata로 성립한다. */}
      <h1 className="sr-only">물건 목록</h1>
      {children}
    </>
  );
}
