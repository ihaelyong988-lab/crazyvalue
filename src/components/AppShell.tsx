import Link from "next/link";
import { DataDateBar } from "@/components/DataDateBar";
import { BottomTabs } from "@/components/BottomTabs";
import { InstallPrompt } from "@/components/InstallPrompt";
import { ExitGuard } from "@/components/ExitGuard";

// 전체 셸: 헤더 워드마크(미친가치 주 + CrazyValue 보조) + 기준일 바 + 하단 탭 3.
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-paper">
      {/* 본문 바로가기(감사 2차 78) — 필터 칩 36탭을 건너뛴다. 평소 화면 밖, 포커스 시에만 노출한다.
          display:none이 아니라 이동만 시켜 초점 순서 첫 자리를 지킨다. */}
      <a
        href="#main"
        className="fixed -top-24 left-2 z-50 flex min-h-11 items-center rounded-lg border border-line bg-white px-4 font-semibold text-ink transition-[top] duration-200 focus:top-2"
      >
        본문 바로가기
      </a>
      <header className="sticky top-0 z-30 bg-navy text-white">
        <div className="flex h-12 items-center justify-between px-4">
          {/* 워드마크 = 전 화면 유일한 홈 백링크(감사 2차 75): 헤더 행 높이(48px)를 그대로 히트영역으로
              쓴다 — 시각 크기·베이스라인 정렬은 안쪽 span이 유지하므로 세로 리듬 변화가 없다. */}
          <Link href="/" className="flex cursor-pointer items-center self-stretch">
            <span className="flex items-baseline gap-1.5">
              <span className="text-lg font-bold tracking-tight">미친가치</span>
              <span className="text-[11px] font-medium text-white/70">CrazyValue</span>
            </span>
          </Link>
          <span className="text-[11px] text-white/70">법원경매 초저가 큐레이션</span>
        </div>
        <DataDateBar />
      </header>
      {/* tabIndex -1: 바로가기 이동 시 초점이 실제로 본문에 놓이게 한다(앵커만으로는 초점이 남는다). */}
      {/* pb: 하단 탭 몫(6rem) + 설치 배너 실측 높이 — 배너는 fixed라 레이아웃을 밀지 않으므로
          이 여백이 없으면 스크롤 끝의 일반 콘텐츠(리스트 더보기 등)가 배너에 가려 탭이 가로채인다. */}
      <main id="main" tabIndex={-1} className="flex-1 pb-[calc(6rem+var(--cv-banner-h,0px))]">
        {children}
      </main>
      {/* PWA 설치 유도(Phase 4.3) — 상시 마운트 지점 1곳, 하단 탭 위에 고정 노출 */}
      <InstallPrompt />
      {/* 이탈 확인(N2) — 렌더는 확인 시트가 열릴 때뿐, 상시 마운트 지점 1곳 */}
      <ExitGuard />
      <BottomTabs />
    </div>
  );
}
