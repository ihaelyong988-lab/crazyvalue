import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PickBadge } from "@/components/PickBadge";

// 미친가치 픽 진입 카드(§4.3-① 6) — 탭 시 픽 필터 적용 리스트로.
export function PickEntry({ count }: { count: number }) {
  return (
    <Link
      href="/list?pick=1"
      className="flex cursor-pointer items-center justify-between rounded-xl border border-accent/30 bg-white p-4 transition-colors duration-200 hover:bg-paper"
    >
      <div>
        <div className="flex items-center gap-2">
          <PickBadge />
          <span className="font-bold tabular-nums">
            {count.toLocaleString("ko-KR")}건
          </span>
        </div>
        <p className="mt-1 text-[13px] text-ink/70">
          현재 최저가가 감정가의 50% 이하인 물건
        </p>
      </div>
      <ChevronRight size={20} className="shrink-0 text-ink/40" aria-hidden />
    </Link>
  );
}
