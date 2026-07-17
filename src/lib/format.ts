// 금액·기일 표기 유틸 — 기일 계산은 Asia/Seoul date-only로 이 파일만 경유한다(§13 규칙 12).
// 금액은 원 단위 정수로 저장하고, 축약은 표시 단계에서만 한다.

const DOW_KR = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** Asia/Seoul 기준 오늘 날짜 문자열(YYYY-MM-DD). 서버 UTC·빌드 시각에 오염되지 않는다. */
export function todaySeoul(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function toUtcMidnight(dateOnly: string): number {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** 매각기일까지 남은 일수. 0 = 오늘(D-day), 음수 = 기일 경과. base 미지정 시 서울 오늘. */
export function dday(saleDate: string, base: string = todaySeoul()): number {
  return Math.round((toUtcMidnight(saleDate) - toUtcMidnight(base)) / 86_400_000);
}

/** D-day 표기: D-7 · D-day · 기일 경과 */
export function formatDday(days: number): string {
  if (days < 0) return "기일 경과";
  if (days === 0) return "D-day";
  return `D-${days}`;
}

/** 한국식 금액 축약(만 단위 미만 내림): 320,000,000 → "3억 2,000만" */
export function formatKrw(won: number): string {
  if (won < 10_000) return `${won.toLocaleString("ko-KR")}원`;
  const man = Math.floor(won / 10_000);
  const eok = Math.floor(man / 10_000);
  const rem = man % 10_000;
  if (eok === 0) return `${rem.toLocaleString("ko-KR")}만`;
  if (rem === 0) return `${eok.toLocaleString("ko-KR")}억`;
  return `${eok.toLocaleString("ko-KR")}억 ${rem.toLocaleString("ko-KR")}만`;
}

/** 전체 자리 금액: 152,880,000원 */
export function formatWon(won: number): string {
  return `${won.toLocaleString("ko-KR")}원`;
}

/** 할인율(%) = (1 − priceRatio) × 100, 정수 반올림. 표시 예: "-51%" */
export function discountPct(priceRatio: number): number {
  return Math.round((1 - priceRatio) * 100);
}

/** 날짜 표기: 2026-07-13 → "2026-07-13(일)" */
export function formatDateKr(dateOnly: string): string {
  const dow = DOW_KR[new Date(toUtcMidnight(dateOnly)).getUTCDay()];
  return `${dateOnly}(${dow})`;
}

/** 면적: ㎡ + 평 병기. null이면 "-" */
export function formatArea(m2: number | null): string {
  if (m2 === null) return "-";
  const pyeong = m2 / 3.305785;
  return `${m2.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}㎡ (${pyeong.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}평)`;
}
