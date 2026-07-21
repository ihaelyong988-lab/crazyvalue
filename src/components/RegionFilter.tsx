"use client";

import { REGIONS } from "@/types/catalog";
import type { AuctionItem } from "@/types/auction";
import { districtKey, parseDistrictKey } from "@/lib/data";
import { FilterChip } from "@/components/FilterChip";

// 필터 1 지역(§4.3-① 2): 시·도 17 그리드 → 선택 시 시·군·구 칩(다중, 기본 전체).
// 시·군·구 값은 "시도:시군구" 결합 키(감사 14) — 동명 시군구(대구 북구·광주 북구)가 병합되지 않고,
// 복수 시·도 선택 시 칩 라벨에 시·도를 병기한다.
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
  // 선택된 시·도의 시·군·구 옵션 — 결합 키로 동명을 구분한다.
  const byKey = new Map<string, { region: string; district: string }>();
  for (const i of items) {
    if (regions.includes(i.region)) {
      byKey.set(districtKey(i.region, i.district), { region: i.region, district: i.district });
    }
  }
  const districtOptions = [...byKey.entries()]
    .map(([key, v]) => ({
      key,
      district: v.district,
      label: regions.length > 1 ? `${v.region} ${v.district}` : v.district,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));

  // 구 URL의 시도 없는 값("북구")은 현재 옵션에서 이름이 일치하는 결합 키 전부로 정규화한다(하위호환).
  const normalizeDistricts = (): string[] => [
    ...new Set(
      districts.flatMap((d) =>
        parseDistrictKey(d).region === null
          ? districtOptions.filter((o) => o.district === d).map((o) => o.key)
          : [d],
      ),
    ),
  ];

  const toggleRegion = (name: string) => {
    const next = regions.includes(name)
      ? regions.filter((r) => r !== name)
      : [...regions, name];
    // 지역 해제 시 그 지역의 시·군·구 선택도 함께 해제 — 결합 키의 시·도 부분으로 판정하므로
    // 지역 추가만으로 동명 시·군·구가 선택에 편입되지 않는다.
    const validKeys = new Set(
      items
        .filter((i) => next.includes(i.region))
        .map((i) => districtKey(i.region, i.district)),
    );
    onChange(next, normalizeDistricts().filter((k) => validKeys.has(k)));
  };

  const toggleDistrict = (key: string) => {
    const norm = normalizeDistricts();
    onChange(
      regions,
      norm.includes(key) ? norm.filter((k) => k !== key) : [...norm, key],
    );
  };

  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-semibold text-ink/70">
        {/* 보조 문구 ink/70 — Paper 위 대비 4.5:1 확보(감사 2차 71, 1차 9·10과 동일 처방) */}
        지역 <span className="font-normal text-ink/70">— 미선택 시 전체</span>
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
      {/* 시·군·구 칩 등장 공지(감사 6) — 상시 마운트된 status 영역의 텍스트 갱신으로 보조기술에 알린다. */}
      <p role="status" className="sr-only">
        {districtOptions.length > 0
          ? `시·군·구 선택 항목 ${districtOptions.length}개가 표시되었습니다.`
          : ""}
      </p>
      {districtOptions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="시·군·구 선택">
          {districtOptions.map((o) => (
            <FilterChip
              key={o.key}
              label={o.label}
              selected={districts.includes(o.key) || districts.includes(o.district)}
              onToggle={() => toggleDistrict(o.key)}
            />
          ))}
        </div>
      )}
    </fieldset>
  );
}
