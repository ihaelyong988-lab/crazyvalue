// 런타임 상수 카탈로그 — zod 무의존(클라이언트 번들 경량 유지, §13 규칙 4).
// 스키마(auction.ts)는 이 상수를 가져와 검증에 사용하고 재수출한다. 값 변경은 이 파일에서만.

export const CATEGORIES = [
  "아파트",
  "다세대",
  "단독다가구",
  "오피스텔",
  "상가",
  "토지",
  "공장창고",
  "기타",
] as const;
export type Category = (typeof CATEGORIES)[number];

// 시·도 17개 — 데이터 파일 분할 키(public/data/{key}.json)
export const REGIONS: { key: string; name: string }[] = [
  { key: "seoul", name: "서울" },
  { key: "busan", name: "부산" },
  { key: "daegu", name: "대구" },
  { key: "incheon", name: "인천" },
  { key: "gwangju", name: "광주" },
  { key: "daejeon", name: "대전" },
  { key: "ulsan", name: "울산" },
  { key: "sejong", name: "세종" },
  { key: "gyeonggi", name: "경기" },
  { key: "gangwon", name: "강원" },
  { key: "chungbuk", name: "충북" },
  { key: "chungnam", name: "충남" },
  { key: "jeonbuk", name: "전북" },
  { key: "jeonnam", name: "전남" },
  { key: "gyeongbuk", name: "경북" },
  { key: "gyeongnam", name: "경남" },
  { key: "jeju", name: "제주" },
];
export const regionNameByKey = Object.fromEntries(REGIONS.map((r) => [r.key, r.name]));
export const regionKeyByName = Object.fromEntries(REGIONS.map((r) => [r.name, r.key]));
