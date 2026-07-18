"use client";

import { REGIONS } from "@/types/catalog";
import type { AuctionItem } from "@/types/auction";
import { FilterChip } from "@/components/FilterChip";

// 필터 1 지역(§4.3-① 2): 시·도 17 그리드 → 선택 시 시·군·구 칩(다중, 기본 전체).
export function RegionFilter({
  items,
  regions,
  districts,
  onChange,
}: {
  items: AuctionItem[];
  regions: string[];
  districts: string[];
  onChange: (regions: string[], districts: string[]) => void;
}) {
  const toggleRegion = (name: string) => {
    const next = regions.includes(name)
      ? regions.filter((r) => r !== name)
      : [...regions, name];
    // 지역 해제 시 그 지역의 시·군·구 선택도 함께 해제
    const validDistricts = new Set(
      items.filter((i) => next.includes(i.region)).map((i) => i.district),
    );
    onChange(next, districts.filter((d) => validDistricts.has(d)));
  };

  const districtOptions = [...new Set(
    items.filter((i) => regions.includes(i.region)).map((i) => i.district),
  )].sort((a, b) => a.localeCompare(b, "ko"));

  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-semibold text-ink/70">
        지역 <span className="font-normal text-ink/50">— 미선택 시 전체</span>
      </legend>
      <div className="grid grid-cols-4 gap-1.5">
        {REGIONS.map((r) => (
          <FilterChip
            key={r.key}
            label={r.name}
            selected={regions.includes(r.name)}
            onToggle={() => toggleRegion(r.name)}
          />
        ))}
      </div>
      {districtOptions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {districtOptions.map((d) => (
            <FilterChip
              key={d}
              label={d}
              selected={districts.includes(d)}
              onToggle={() =>
                onChange(
                  regions,
                  districts.includes(d)
                    ? districts.filter((x) => x !== d)
                    : [...districts, d],
                )
              }
            />
          ))}
        </div>
      )}
    </fieldset>
  );
}
