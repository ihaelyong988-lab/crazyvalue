// 금액·기일 표기 유틸 — 기일 계산은 Asia/Seoul date-only로 이 파일만 경유한다(§13 규칙 12).
// 금액은 원 단위 정수로 저장하고, 축약은 표시 단계에서만 한다.

const DOW_KR = ["일", "월", "화", "수", "목", "금", "토"] as const;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const SEOUL_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const SEOUL_HM = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Asia/Seoul 기준 오늘 날짜 문자열(YYYY-MM-DD). 서버 UTC·빌드 시각에 오염되지 않는다. */
export function todaySeoul(now: Date = new Date()): string {
  return SEOUL_DATE.format(now);
}

/**
 * date-only 문자열 → UTC 자정 ms. 존재하지 않는 날짜(2026-02-30·2025-02-29)는 null이다.
 * Date.UTC가 초과 일자를 다음 달로 조용히 이월하는 탓에 무효 기일이 유효한 D-day로 표기됐다(감사 37) —
 * 파싱 결과를 되돌려 비교해 이월분을 무효로 판정한다.
 */
export function parseDateOnly(dateOnly: string): number | null {
  if (!DATE_ONLY.test(dateOnly)) return null;
  const [y, m, d] = dateOnly.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return ms;
}

/** 실재하는 date-only 값인지 — 손상 데이터 폐기 판정에 쓴다(감사 36·37). */
export function isValidDateOnly(value: unknown): value is string {
  return typeof value === "string" && parseDateOnly(value) !== null;
}

/** date-only 기준 n일 이동한 날짜 문자열. 무효 입력은 null(직접 Date 연산 금지 — §13 규칙 12). */
export function shiftDays(dateOnly: string, days: number): string | null {
  const ms = parseDateOnly(dateOnly);
  if (ms === null) return null;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/** 매각기일까지 남은 일수. 0 = 오늘(D-day), 음수 = 기일 경과, NaN = 무효 기일. base 미지정 시 서울 오늘. */
export function dday(saleDate: string, base: string = todaySeoul()): number {
  const target = parseDateOnly(saleDate);
  const from = parseDateOnly(base);
  if (target === null || from === null) return Number.NaN;
  return Math.round((target - from) / 86_400_000);
}

/** D-day 표기: D-7 · D-day · 기일 경과 · 기일 미상(무효 기일은 남은 일수를 단정하지 않는다) */
export function formatDday(days: number): string {
  if (!Number.isFinite(days)) return "기일 미상";
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

/** 날짜 표기: 2026-07-13 → "2026-07-13(일)". 무효 날짜는 요일을 붙이지 않고 원값 그대로 둔다(추정 표기 금지). */
export function formatDateKr(dateOnly: string): string {
  const ms = parseDateOnly(dateOnly);
  if (ms === null) return dateOnly;
  return `${dateOnly}(${DOW_KR[new Date(ms).getUTCDay()]})`;
}

/**
 * ISO 시각 → Asia/Seoul 날짜·시각("2026-07-12", "03:00"). 파싱 불가면 null.
 * 기준일 바가 수집 시각을 리터럴 03:00이 아니라 실제 값으로 표기하는 근거다(감사 38).
 */
export function seoulDateTime(iso: string): { date: string; time: string } | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const at = new Date(t);
  return { date: todaySeoul(at), time: SEOUL_HM.format(at) };
}

/**
 * 예정 갱신 시각 대비 지연. overdue=false면 지연 아님, days는 지난 만 일수(내림).
 * 파싱 불가면 null — 지연 여부를 단정하지 않는다(감사 92).
 */
export function updateDelay(
  nextUpdateAt: string,
  now: Date = new Date(),
): { overdue: boolean; days: number } | null {
  const due = Date.parse(nextUpdateAt);
  if (!Number.isFinite(due)) return null;
  const elapsed = now.getTime() - due;
  if (elapsed <= 0) return { overdue: false, days: 0 };
  return { overdue: true, days: Math.floor(elapsed / 86_400_000) };
}

/** 면적: ㎡ + 평 병기. null이면 "-" */
export function formatArea(m2: number | null): string {
  if (m2 === null) return "-";
  const pyeong = m2 / 3.305785;
  return `${m2.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}㎡ (${pyeong.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}평)`;
}
