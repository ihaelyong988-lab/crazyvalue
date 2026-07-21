"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Star, Info, Settings } from "lucide-react";
import { readDiffCache } from "@/lib/watchlist";

// 탭 4개(감사 2차 51) — "내 설정"이 없어 관심조건 편집 화면에 도달할 단서가 앱 어디에도 없었다.
// 375px 기준 탭 폭 93px·높이 56px로 4개에서도 터치 타깃 44px 플로어를 유지한다.
const TABS = [
  { href: "/", label: "홈", icon: Home },
  { href: "/watch", label: "관심함", icon: Star },
  { href: "/guide", label: "안내", icon: Info },
  { href: "/me", label: "내 설정", icon: Settings },
] as const;

/**
 * 관심함 밖에서 알릴 변화 건수(감사 64) — 관심함 화면이 기록한 세션 판정 캐시를 그대로 읽는다.
 * 여기서 데이터를 다시 받아 재판정하지 않는다: 전 화면 공통 셸이라 지역 파일 로드가 모든 화면에 붙는다(§13 규칙 4).
 * 관심함 화면에서는 0이다 — 카드 배지가 같은 사실을 이미 말한다(중복 표시 금지).
 * 값은 초기 렌더 이후에만 읽는다 — 서버 렌더에는 세션 저장소가 없어 하이드레이션이 어긋난다.
 */
function useWatchChangeCount(pathname: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    // 화면이 바뀔 때마다 다시 읽는다 — 관심함 방문이 판정을 기록하고, 관심 해제가 캐시에서 항목을 지운다.
    setCount(pathname.startsWith("/watch") ? 0 : Object.keys(readDiffCache()).length);
  }, [pathname]);
  return count;
}

// 하단 탭 — 한손 조작(§4.4-14). 활성 탭은 색+굵기+aria-current로 병행 전달.
// 홈 흐름 경로(/ → /list → /item/…)는 홈 탭 활성으로 판정한다(감사 #16 현재 위치 신호).
export function BottomTabs() {
  const pathname = usePathname();
  const changeCount = useWatchChangeCount(pathname);
  return (
    <nav
      aria-label="주 메뉴"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md border-t border-white/10 bg-navy pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="flex">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/"
              ? pathname === "/" ||
                pathname.startsWith("/list") ||
                pathname.startsWith("/item")
              : pathname.startsWith(href);
          const badge = href === "/watch" ? changeCount : 0;
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${
                  active ? "font-semibold text-white" : "text-white/60"
                }`}
              >
                {/* flex — 아이콘을 텍스트 베이스라인에서 떼어 배지 추가로 탭 높이가 밀리지 않게 한다. */}
                <span className="relative flex">
                  <Icon size={20} strokeWidth={active ? 2.4 : 1.8} aria-hidden />
                  {badge > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute -top-1.5 -right-2.5 min-w-[18px] rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-[18px] tabular-nums text-white"
                    >
                      {badge}
                    </span>
                  )}
                </span>
                {label}
                {badge > 0 && <span className="sr-only">변화 {badge}건</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
