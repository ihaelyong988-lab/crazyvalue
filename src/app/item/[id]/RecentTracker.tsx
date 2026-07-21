"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { pushRecent } from "@/lib/watchlist";
import { hasAppNavigated } from "@/components/ExitGuard";

// 최근 본 물건 기록(§4.4-18) — 렌더 없음, 열람 사실만 저장.
export function RecentTracker({ id }: { id: string }) {
  useEffect(() => {
    pushRecent(id);
  }, [id]);
  return null;
}

// 상세 상단 가시적 뒤로가기(감사 #18) — standalone 실행에서 OS 제스처 없이 복귀 수단 제공.
// 앱 내 이동 이력이 있으면 그대로 복귀(리스트 스크롤·필터 맥락 보존), 직접 진입이면 /list 폴백.
// 판정은 앱 내 내비게이션 플래그로 한다(감사 2차 67) — history.length는 외부 유입 이력까지 세어
// 공유 링크 방문자를 폴백 대신 앱 밖으로 내보냈다.
export function BackButton() {
  const router = useRouter();
  function goBack() {
    if (hasAppNavigated()) router.back();
    else router.push("/list");
  }
  return (
    <button
      type="button"
      onClick={goBack}
      className="-ml-2 flex min-h-11 cursor-pointer items-center gap-1 rounded-lg px-2 text-[14px] font-medium text-ink/80 transition-colors duration-200 hover:bg-line/50"
    >
      <ArrowLeft size={18} aria-hidden /> 뒤로
    </button>
  );
}
