import { describe, expect, it } from "vitest";
import { COOLDOWN_HOURS, deriveStatus, remainingText, type RunSummary } from "@/lib/refresh";

// 리프레쉬 상태 판정 — 화면과 API가 같은 규칙을 쓴다. now를 주입해 시각 의존을 없앤다.

const run = (status: string, createdAt: string, id = "1"): RunSummary => ({
  status,
  createdAt,
  htmlUrl: `https://github.com/o/r/actions/runs/${id}`,
});

describe("deriveStatus — 진행 중 > 쿨다운 > 미설정 > 실행 가능", () => {
  const now = new Date("2026-08-02T12:00:00Z");

  it("진행 중 런이 있으면 running — 쿨다운보다 우선한다", () => {
    const s = deriveStatus(
      [run("in_progress", "2026-08-02T11:50:00Z"), run("completed", "2026-08-01T00:00:00Z", "2")],
      now,
      true,
    );
    expect(s.state).toBe("running");
    expect(s.runUrl).toContain("/runs/1");
    expect(s.cooldownUntil).toBeNull();
  });

  it("queued도 진행 중으로 본다 — 대기열도 이미 실행 요청된 상태다", () => {
    expect(deriveStatus([run("queued", "2026-08-02T11:59:00Z")], now, true).state).toBe("running");
  });

  it(`직전 실행이 ${COOLDOWN_HOURS}시간 이내면 cooldown + 해제 시각`, () => {
    const s = deriveStatus([run("completed", "2026-08-02T09:00:00Z")], now, true);
    expect(s.state).toBe("cooldown");
    expect(s.cooldownUntil).toBe("2026-08-02T15:00:00.000Z");
  });

  it(`${COOLDOWN_HOURS}시간을 넘겼고 토큰이 있으면 idle`, () => {
    const s = deriveStatus([run("completed", "2026-08-02T05:59:00Z")], now, true);
    expect(s.state).toBe("idle");
    expect(s.cooldownUntil).toBeNull();
    expect(s.lastRunAt).toBe("2026-08-02T05:59:00Z");
  });

  it("토큰이 없으면 unconfigured — 단 쿨다운 중에는 쿨다운을 말한다(할 수 없는 행동을 요구하지 않는다)", () => {
    expect(deriveStatus([run("completed", "2026-08-02T05:00:00Z")], now, false).state).toBe(
      "unconfigured",
    );
    expect(deriveStatus([run("completed", "2026-08-02T09:00:00Z")], now, false).state).toBe(
      "cooldown",
    );
  });

  it("런 이력이 없으면 쿨다운 없이 판정한다", () => {
    expect(deriveStatus([], now, true).state).toBe("idle");
    expect(deriveStatus([], now, false).state).toBe("unconfigured");
    expect(deriveStatus([], now, true).lastRunAt).toBeNull();
  });

  it("가장 최근 런을 기준으로 삼는다(입력 순서 무관)", () => {
    const s = deriveStatus(
      [run("completed", "2026-08-01T00:00:00Z", "old"), run("completed", "2026-08-02T09:00:00Z", "new")],
      now,
      true,
    );
    expect(s.state).toBe("cooldown");
    expect(s.runUrl).toContain("/runs/new");
  });

  it("파싱 불가 시각은 기준에서 제외한다 — 쿨다운을 거짓으로 풀지 않는다", () => {
    const s = deriveStatus(
      [run("completed", "미상", "bad"), run("completed", "2026-08-02T09:00:00Z", "good")],
      now,
      true,
    );
    expect(s.state).toBe("cooldown");
    expect(s.runUrl).toContain("/runs/good");
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
