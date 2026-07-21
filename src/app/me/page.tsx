import type { Metadata } from "next";
import { MeSettings } from "@/components/PrefsEditor";

export const metadata: Metadata = {
  title: "내 설정 — 관심조건·저장 현황 | 미친가치",
  description:
    "관심 지역·금액대 편집, 관심함·최근 본 물건 저장 현황, 이 기기 데이터 초기화. 무가입·기기 저장.",
};

// 내 설정(§4.1 신설 사양 N1, 감사 2차 51·52·53) — 하단 탭 4번째.
// h1은 서버 HTML에 둔다(감사 2차 74): 화면 정체성이 하이드레이션 전에도 접근 트리에 있어야 한다.
// 편집·현황·초기화는 클라이언트 훅이 필요해 PrefsEditor(소유 파일)에 두고, 이 페이지는 metadata를 유지한다.
export default function MePage() {
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-lg font-bold">내 설정</h1>
      <MeSettings />
    </div>
  );
}
