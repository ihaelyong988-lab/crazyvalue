"use client";

import { PRICE_BANDS, type PriceBandKey } from "@/lib/data";
import { FilterChip } from "@/components/FilterChip";

// 필터 2 금액(§4.3-① 3): 최저가 기준 구간 칩 5종, 복수 선택.
export function PriceFilter({
  value,
  onChange,
}: {
  value: PriceBandKey[];
  onChange: (v: PriceBandKey[]) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-semibold text-ink/70">
        {/* 보조 문구 ink/70 — Paper 위 대비 4.5:1 확보(감사 2차 71) */}
        금액(최저가) <span className="font-normal text-ink/70">— 복수 선택</span>
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {PRICE_BANDS.map((b) => (
          <FilterChip
            key={b.key}
            label={b.label}
            selected={value.includes(b.key)}
            onToggle={() =>
              onChange(
                value.includes(b.key)
                  ? value.filter((k) => k !== b.key)
                  : [...value, b.key],
              )
            }
          />
        ))}
      </div>
    </fieldset>
  );
}
