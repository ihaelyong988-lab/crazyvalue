import type { Metadata } from "next";
import { GlossarySheet } from "@/components/GlossarySheet";

export const metadata: Metadata = {
  title: "안내 — 용어·기준·법적 고지 | 미친가치",
  description:
    "관심 지역·금액대 재설정, 미친가치 픽 기준 공개, 경매 용어 12개 풀이, 데이터 갱신 안내, 법적 고지 전문.",
};

// 시트 B(§4.1): 관심 조건 편집(감사 #19) + 용어·고지 — 하단 탭 "안내".
// 편집 UI는 클라이언트 훅이 필요해 GlossarySheet(소유 파일)에 두고, 이 페이지는 metadata를 유지한다.
export default function GuidePage() {
  return <GlossarySheet />;
}
