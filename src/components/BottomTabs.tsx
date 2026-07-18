"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Star, Info } from "lucide-react";

const TABS = [
  { href: "/", label: "홈", icon: Home },
  { href: "/watch", label: "관심함", icon: Star },
  { href: "/guide", label: "안내", icon: Info },
] as const;

// 하단 탭 3 — 한손 조작(§4.4-14). 활성 탭은 색+굵기+aria-current로 병행 전달.
export function BottomTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="주 메뉴"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md border-t border-white/10 bg-navy pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="flex">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${
                  active ? "font-semibold text-white" : "text-white/60"
                }`}
              >
                <Icon size={20} strokeWidth={active ? 2.4 : 1.8} aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
