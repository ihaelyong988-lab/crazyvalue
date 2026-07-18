import Link from "next/link";
import { DataDateBar } from "@/components/DataDateBar";
import { BottomTabs } from "@/components/BottomTabs";

// 전체 셸: 헤더 워드마크(미친가치 주 + CrazyValue 보조) + 기준일 바 + 하단 탭 3.
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-paper">
      <header className="sticky top-0 z-30 bg-navy text-white">
        <div className="flex h-12 items-center justify-between px-4">
          <Link href="/" className="flex items-baseline gap-1.5">
            <span className="text-lg font-bold tracking-tight">미친가치</span>
            <span className="text-[11px] font-medium text-white/70">CrazyValue</span>
          </Link>
          <span className="text-[11px] text-white/70">법원경매 초저가 큐레이션</span>
        </div>
        <DataDateBar />
      </header>
      <main className="flex-1 pb-24">{children}</main>
      <BottomTabs />
    </div>
  );
}
