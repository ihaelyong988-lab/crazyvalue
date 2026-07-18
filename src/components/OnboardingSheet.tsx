"use client";

import { useEffect, useState } from "react";
import { REGIONS } from "@/types/catalog";
import { PRICE_BANDS } from "@/lib/data";
import { isOnboarded, markOnboarded, setPrefs } from "@/lib/watchlist";
import { FilterChip } from "@/components/FilterChip";
import { PickBadge } from "@/components/PickBadge";

// 온보딩(최초 1회, §4.1 시트 A): 브랜드 설명 1장 + 관심 지역·금액 설정(건너뛰기 가능).
// SSR에 포함해 첫 방문 LCP를 앞당긴다. 완료자는 onboarding-flag.js + CSS가 페인트 전에 숨기고,
// 하이드레이션 후 여기서 실제로 내린다(깜빡임 0).
export function OnboardingSheet({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(true);
  const [regions, setRegions] = useState<string[]>([]);
  const [bands, setBands] = useState<string[]>([]);

  useEffect(() => {
    if (isOnboarded()) setOpen(false);
  }, []);
  if (!open) return null;

  const close = (save: boolean) => {
    if (save) setPrefs({ regions, priceBands: bands });
    else markOnboarded();
    setOpen(false);
    onDone();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="미친가치 소개와 관심 조건 설정"
      data-cv-onboarding
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy/60"
    >
      <div className="max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-paper p-5 pb-8">
        <h2 className="text-lg font-bold">
          미친가치 <span className="text-[13px] font-medium text-ink/60">CrazyValue</span>
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ink/85">
          전국 법원경매에서 <b>2회 이상 유찰된 물건만</b> 모아 보여준다. 물건의 가치는
          그대로인데 가격만 내려간 목록이다.
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[14px] text-ink/85">
          <PickBadge />
          <span>= 현재 최저가가 감정가의 50% 이하인 물건. 기준은 공개되어 있다.</span>
        </p>
        <p className="mt-2 text-[13px] text-ink/60">
          무료·무가입. 데이터는 매주 일요일 03:00에 갱신된다.
        </p>

        <h3 className="mt-5 text-[13px] font-semibold text-ink/70">관심 지역 (선택)</h3>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {REGIONS.map((r) => (
            <FilterChip
              key={r.key}
              label={r.name}
              selected={regions.includes(r.name)}
              onToggle={() =>
                setRegions((prev) =>
                  prev.includes(r.name)
                    ? prev.filter((x) => x !== r.name)
                    : [...prev, r.name],
                )
              }
            />
          ))}
        </div>

        <h3 className="mt-4 text-[13px] font-semibold text-ink/70">관심 금액대 (선택)</h3>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {PRICE_BANDS.map((b) => (
            <FilterChip
              key={b.key}
              label={b.label}
              selected={bands.includes(b.key)}
              onToggle={() =>
                setBands((prev) =>
                  prev.includes(b.key)
                    ? prev.filter((x) => x !== b.key)
                    : [...prev, b.key],
                )
              }
            />
          ))}
        </div>

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            onClick={() => close(false)}
            className="min-h-12 flex-1 cursor-pointer rounded-xl border border-line bg-white font-semibold text-ink transition-colors duration-200 hover:bg-paper"
          >
            건너뛰기
          </button>
          <button
            type="button"
            onClick={() => close(true)}
            className="min-h-12 flex-1 cursor-pointer rounded-xl bg-accent font-semibold text-white transition-colors duration-200 hover:bg-accent/90"
          >
            저장하고 시작
          </button>
        </div>
      </div>
    </div>
  );
}
