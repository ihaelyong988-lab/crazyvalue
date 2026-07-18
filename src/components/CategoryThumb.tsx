/* eslint-disable @next/next/no-img-element */
import type { Category } from "@/types/auction";
import {
  Building2,
  Home,
  Hotel,
  Store,
  Warehouse,
  LandPlot,
  Boxes,
} from "lucide-react";

const ICONS: Record<Category, React.ComponentType<{ size?: number; className?: string }>> = {
  아파트: Building2,
  다세대: Home,
  단독다가구: Home,
  오피스텔: Hotel,
  상가: Store,
  토지: LandPlot,
  공장창고: Warehouse,
  기타: Boxes,
};

// 사진 요소 — photoUrl 부재 시 용도별 플레이스홀더(라인 아이콘)로 대체(R5 대비).
export function CategoryThumb({
  category,
  photoUrl,
}: {
  category: Category;
  photoUrl: string | null;
}) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={`${category} 물건 사진`}
        loading="lazy"
        className="h-16 w-16 shrink-0 rounded-lg border border-line object-cover"
      />
    );
  }
  const Icon = ICONS[category];
  return (
    <div
      aria-hidden
      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-line bg-paper text-ink/40"
    >
      <Icon size={26} />
    </div>
  );
}
