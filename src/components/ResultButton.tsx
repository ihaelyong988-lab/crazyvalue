"use client";

import Link from "next/link";

// 결과 버튼(§4.3-① 5): 실시간 건수, 높이 52px, 하단 고정(탭 바 위).
// 상시 마운트되는 컨테이너가 aria-live 영역(감사 백로그 5) — 필터 조작에 따른 건수 갱신과
// 로딩 전환을 스크린리더에 공지한다. 분기 내부에 두면 요소 교체 시 공지가 유실된다.
export function ResultButton({
  count,
  href,
  loading = false,
}: {
  count: number;
  href: string;
  loading?: boolean;
}) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed inset-x-0 bottom-14 z-30 mx-auto w-full max-w-md px-4 pb-3"
    >
      {loading ? (
        <div className="flex h-[52px] w-full items-center justify-center rounded-xl bg-accent/90 font-semibold text-white">
          물건 확인 중
        </div>
      ) : (
        <Link
          href={href}
          className="flex h-[52px] w-full cursor-pointer items-center justify-center rounded-xl bg-accent font-semibold text-white transition-colors duration-200 hover:bg-accent/90"
        >
          물건 <span className="mx-1 tabular-nums">{count.toLocaleString("ko-KR")}</span>건 보기
        </Link>
      )}
    </div>
  );
}
