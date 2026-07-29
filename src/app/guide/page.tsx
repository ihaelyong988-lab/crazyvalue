import type { Metadata } from "next";
import { GlossarySheet } from "@/components/GlossarySheet";

export const metadata: Metadata = {
  title: "안내 — 용어·기준·법적 고지 | 미친가치",
  description:
    "미친가치 픽 기준 공개, 경매 용어 12개 풀이, 데이터 갱신 안내, 법적 고지 전문. 관심 조건 편집은 내 설정에 있다.",
};

// 시트 B(§4.1): 용어·기준·고지 — 하단 탭 "안내". 관심 조건 편집은 /me로 이관했다(감사 2차 51).
export default function GuidePage() {
  return (
    <>
      <GlossarySheet />
      {/* 데이터 범위 기준(산출물 기준 공개) — 갱신 주기·수집 대상은 위 데이터 안내가 이미 말한다:
          여기는 건수 상한·정렬 기준만 더한다(1정보 1표시). 파일 소유권이 src/app/guide/** 한정이라
          GlossarySheet(픽 기준 공개 섹션) 내부가 아닌 페이지 말미에 둔다. */}
      <p className="px-4 text-[13px] leading-snug text-ink/75">
        갱신마다 매각기일이 가까운 순으로 최대 1,000건을 제공한다.
      </p>
    </>
  );
}
