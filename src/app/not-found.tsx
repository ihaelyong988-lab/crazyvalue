import Link from "next/link";

// 전역 404(감사 #13) — 공유 링크 유입의 막다른 길 방지. 상세는 dynamicParams=false라
// 만료·오류 물건 URL도 전부 이 화면으로 수렴하며, 앱 셸(헤더·하단 탭)은 유지된다.
export default function NotFound() {
  return (
    <div className="m-4 rounded-xl border border-line bg-white p-4 text-center">
      <p className="text-[12px] font-semibold tabular-nums text-ink/70">404</p>
      <h1 className="mt-1 font-bold text-ink">페이지를 찾을 수 없습니다</h1>
      <p className="mt-2 text-[13px] leading-snug text-ink/70">
        주소가 바뀌었거나 없는 페이지 — 찾으시는 물건이라면 매각·취하 등으로 주간
        갱신 목록에서 내려갔을 수 있습니다.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <Link
          href="/"
          className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-accent px-4 font-semibold text-white transition-colors duration-200 hover:bg-accent/90"
        >
          홈으로 이동
        </Link>
        <Link
          href="/list"
          className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-line bg-paper px-4 font-medium text-ink transition-colors duration-200 hover:bg-line/50"
        >
          진행 중 물건 전체 보기
        </Link>
      </div>
    </div>
  );
}
