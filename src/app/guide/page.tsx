import type { Metadata } from "next";
import { GlossarySheet } from "@/components/GlossarySheet";

export const metadata: Metadata = {
  title: "안내 — 용어·기준·법적 고지 | 미친가치",
  description:
    "미친가치 픽 기준 공개, 경매 용어 12개 풀이, 데이터 갱신 안내, 법적 고지 전문.",
};

// 시트 B(§4.1): 용어·고지 — 하단 탭 "안내".
export default function GuidePage() {
  return <GlossarySheet />;
}
