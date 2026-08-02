import { describe, expect, it } from "vitest";
import { COOLDOWN_HOURS, deriveStatus, remainingText, type RunSummary } from "@/lib/refresh";

// 리프레쉬 상태 판정 — 화면과 API가 같은 규칙을 쓴다. now를 주입해 시각 의존을 없앤다.

const run = (
  status: string,
  createdAt: string,
  id = "1",
  conclusion: string | null = "success",
): RunSummary => ({
  status,
  conclusion: status === "completed" ? conclusion : null,
  createdAt,
  htmlUrl: `https://github.com/o/r/actions/runs/${id}`,
});

// 시각은 COOLDOWN_HOURS에서 유도한다 — 상수를 바꿔도 테스트가 깨지지 않아야 한다
// (6→1시간 조정 때 하드코딩 시각들이 한꺼번에 무효가 됐다).
const HOUR_MS = 3_600_000;
const NOW = new Date("2026-08-02T12:00:00Z");
const iso = (msAgo: number) => new Date(NOW.getTime() - msAgo).toISOString();
/** 쿨다운이 아직 남아 있는 시각(절반 경과) */
const DURING_COOLDOWN = iso((COOLDOWN_HOURS * HOUR_MS) / 2);
/** 쿨다운이 지난 시각 */
const AFTER_COOLDOWN = iso((COOLDOWN_HOURS + 1) * HOUR_MS);
const COOLDOWN_ENDS_AT = new Date(
  Date.parse(DURING_COOLDOWN) + COOLDOWN_HOURS * HOUR_MS,
).toISOString();

describe("deriveStatus — 진행 중 > 쿨다운 > 미설정 > 실행 가능", () => {
  const now = NOW;

  it("진행 중 런이 있으면 running — 쿨다운보다 우선한다", () => {
    const s = deriveStatus(
      [run("in_progress", iso(10 * 60_000)), run("completed", AFTER_COOLDOWN, "2")],
      now,
      true,
    );
    expect(s.state).toBe("running");
    expect(s.runUrl).toContain("/runs/1");
    expect(s.cooldownUntil).toBeNull();
  });

  it("queued도 진행 중으로 본다 — 대기열도 이미 실행 요청된 상태다", () => {
    expect(deriveStatus([run("queued", iso(60_000))], now, true).state).toBe("running");
  });

  it(`직전 실행이 ${COOLDOWN_HOURS}시간 이내면 cooldown + 해제 시각`, () => {
    const s = deriveStatus([run("completed", DURING_COOLDOWN)], now, true);
    expect(s.state).toBe("cooldown");
    expect(s.cooldownUntil).toBe(COOLDOWN_ENDS_AT);
  });

  it(`${COOLDOWN_HOURS}시간을 넘겼고 토큰이 있으면 idle`, () => {
    const s = deriveStatus([run("completed", AFTER_COOLDOWN)], now, true);
    expect(s.state).toBe("idle");
    expect(s.cooldownUntil).toBeNull();
    expect(s.lastRunAt).toBe(AFTER_COOLDOWN);
  });

  it("토큰이 없으면 unconfigured — 단 쿨다운 중에는 쿨다운을 말한다(할 수 없는 행동을 요구하지 않는다)", () => {
    expect(deriveStatus([run("completed", AFTER_COOLDOWN)], now, false).state).toBe("unconfigured");
    expect(deriveStatus([run("completed", DURING_COOLDOWN)], now, false).state).toBe("cooldown");
  });

  it("런 이력이 없으면 쿨다운 없이 판정한다", () => {
    expect(deriveStatus([], now, true).state).toBe("idle");
    expect(deriveStatus([], now, false).state).toBe("unconfigured");
    expect(deriveStatus([], now, true).lastRunAt).toBeNull();
  });

  it("가장 최근 런을 기준으로 삼는다(입력 순서 무관)", () => {
    const s = deriveStatus(
      [run("completed", AFTER_COOLDOWN, "old"), run("completed", DURING_COOLDOWN, "new")],
      now,
      true,
    );
    expect(s.state).toBe("cooldown");
    expect(s.runUrl).toContain("/runs/new");
  });

  it("파싱 불가 시각은 기준에서 제외한다 — 쿨다운을 거짓으로 풀지 않는다", () => {
    const s = deriveStatus(
      [run("completed", "미상", "bad"), run("completed", DURING_COOLDOWN, "good")],
      now,
      true,
    );
    expect(s.state).toBe("cooldown");
    expect(s.runUrl).toContain("/runs/good");
  });
});

describe("lastConclusion — 조용한 실패 금지(2026-08-02 세션 거부로 런이 죽은 사례)", () => {
  const now = NOW;

  it("직전 완료 런의 결론을 그대로 싣는다 — 화면이 실패를 말할 근거다", () => {
    const s = deriveStatus([run("completed", DURING_COOLDOWN, "1", "failure")], now, true);
    expect(s.lastConclusion).toBe("failure");
    expect(s.state).toBe("cooldown"); // 실패해도 재실행 간격은 지킨다(차단이 원인일 수 있다)
  });

  it("성공이면 success", () => {
    expect(deriveStatus([run("completed", AFTER_COOLDOWN)], now, true).lastConclusion).toBe(
      "success",
    );
  });

  it("진행 중에는 결론이 없다 — 아직 판정할 수 없는 것을 단정하지 않는다", () => {
    expect(deriveStatus([run("in_progress", iso(60_000))], now, true).lastConclusion).toBeNull();
  });

  it("런 이력이 없으면 null", () => {
    expect(deriveStatus([], now, true).lastConclusion).toBeNull();
  });
});

describe("remainingText — 쿨다운 잔여 표기", () => {
  const now = new Date("2026-08-02T12:00:00Z");
  it("시간+분 · 분 단위 올림", () => {
    expect(remainingText("2026-08-02T15:20:00Z", now)).toBe("3시간 20분 후");
    expect(remainingText("2026-08-02T12:00:30Z", now)).toBe("1분 후");
  });
  it("1시간 미만은 분만", () => {
    expect(remainingText("2026-08-02T12:45:00Z", now)).toBe("45분 후");
  });
  it("이미 지났거나 값이 없으면 null — 남은 시간을 0으로 단정하지 않는다", () => {
    expect(remainingText("2026-08-02T11:59:00Z", now)).toBeNull();
    expect(remainingText(null, now)).toBeNull();
    expect(remainingText("미상", now)).toBeNull();
  });
});
