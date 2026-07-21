"use client";

import { CATEGORIES, type Category } from "@/types/catalog";
import { FilterChip } from "@/components/FilterChip";

// 필터 3 용도(§4.3-① 4): 8분류.
export function CategoryFilter({
  value,
  onChange,
}: {
  value: Category[];
  onChange: (v: Category[]) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-semibold text-ink/70">
        {/* 보조 문구 ink/70 — Paper 위 대비 4.5:1 확보(감사 2차 71) */}
        용도 <span className="font-normal text-ink/70">— 미선택 시 전체</span>
      </legend>
      <div className="grid grid-cols-4 gap-1.5">
        {CATEGORIES.map((c) => (
          <FilterChip
            key={c}
            label={c === "단독다가구" ? "단독" : c === "공장창고" ? "공장" : c}
            selected={value.includes(c)}
            onToggle={() =>
              onChange(
                value.includes(c) ? value.filter((x) => x !== c) : [...value, c],
              )
            }
          />
        ))}
      </div>
    </fieldset>
  );
}
