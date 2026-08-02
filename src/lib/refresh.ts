// 수동 재수집(리셋) 상태 판정 — 화면과 API가 같은 규칙을 쓴다.
// 크롤 1회는 약 1,030 요청·60분이고 로봇탐지 임계는 실측 1,030~2,160 요청이다(AGENTS.md §9).
// 그래서 "누르면 곧바로 돈다"가 아니라 진행 중·쿨다운을 먼저 판정하고 넘긴다.

/**
 * 직전 실행 시각 기준 재실행 금지 시간(2026-08-02 주인님 확정 1시간).
 *
 * 실측 근거: 전량 크롤(1,030요청·60분) 직후에는 세션 취득부터 거부당했으나,
 * 그로부터 13분 뒤 경량 크롤(162요청)은 정상 완주했다. 경량 모드는 요청이 1/6이라 회복이 빠르다.
 * 직전 설계값 6시간은 실측이 아니라 보수적 추정이었고 "간단히 갱신"이라는 목적을 해쳤다.
 */
export const COOLDOWN_HOURS = 1;

export type RefreshState = "idle" | "running" | "cooldown" | "unconfigured";

/** GitHub Actions 런 요약 — API 응답에서 판정에 필요한 필드만 남긴다. */
export interface RunSummary {
  /** queued · in_progress · completed */
  status: string;
  /** success · failure · cancelled … 진행 중이면 null */
  conclusion?: string | null;
  /** ISO 시각 */
  createdAt: string;
  htmlUrl: string;
}

export interface RefreshStatus {
  state: RefreshState;
  /** 가장 최근 실행 시각(진행 중이면 그 런의 시각) */
  lastRunAt: string | null;
  cooldownUntil: string | null;
  runUrl: string | null;
  /**
   * 직전 완료 런의 결과. 실패를 말하지 않으면 방문자는 "눌렀는데 아무 일도 없었다"로 읽는다 —
   * 폴링은 running에서 idle로 조용히 되돌아갈 뿐이다(2026-08-02 실측: 세션 거부로 런이 죽었다).
   */
  lastConclusion: string | null;
}

/**
 * 런 목록 → 상태. now를 주입받아 결정적으로 판정한다(테스트·서버 양쪽 동일).
 *
 * 우선순위: 진행 중 > 쿨다운 > 미설정 > 실행 가능.
 * 미설정(토큰 없음)을 쿨다운보다 뒤에 두는 이유 — 쿨다운 중에는 토큰이 있든 없든 못 돌린다.
 * 그 구간에서 "설정이 필요하다"고 말하면 방문자가 할 수 없는 행동을 요구받는다.
 */
export function deriveStatus(runs: RunSummary[], now: Date, configured: boolean): RefreshStatus {
  const active = runs.find((r) => r.status === "queued" || r.status === "in_progress");
  if (active) {
    return {
      state: "running",
      lastRunAt: active.createdAt,
      cooldownUntil: null,
      runUrl: active.htmlUrl,
      lastConclusion: null,
    };
  }
  const sorted = [...runs]
    .filter((r) => Number.isFinite(Date.parse(r.createdAt)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const latest = sorted[0];
  const base = {
    lastRunAt: latest?.createdAt ?? null,
    runUrl: latest?.htmlUrl ?? null,
    lastConclusion: latest?.conclusion ?? null,
  };
  // 쿨다운 기준은 "성공한" 실행이다 — 세션 단계에서 죽은 런은 요청을 4회밖에 하지 않아
  // 사이트에 부담을 주지 않았는데, 그것 때문에 한 시간을 잠그면 방문자만 손해다.
  // (로봇탐지로 중간에 끊긴 런은 부분 산출·커밋 후 exit 0이라 success로 잡히고, 그 경우는 잠긴다.)
  const lastSuccess = sorted.find((r) => r.conclusion === "success");
  if (lastSuccess) {
    const until = Date.parse(lastSuccess.createdAt) + COOLDOWN_HOURS * 3_600_000;
    if (until > now.getTime()) {
      return { ...base, state: "cooldown", cooldownUntil: new Date(until).toISOString() };
    }
  }
  if (!configured) return { ...base, state: "unconfigured", cooldownUntil: null };
  return { ...base, state: "idle", cooldownUntil: null };
}

/** 쿨다운 잔여 표기: "3시간 20분 후" · "12분 후". 이미 지났으면 null(남은 시간을 0으로 단정하지 않는다). */
export function remainingText(cooldownUntil: string | null, now: Date): string | null {
  if (!cooldownUntil) return null;
  const ms = Date.parse(cooldownUntil) - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const mins = Math.ceil(ms / 60_000);
  const hours = Math.floor(mins / 60);
  return hours > 0 ? `${hours}시간 ${mins % 60}분 후` : `${mins}분 후`;
}
