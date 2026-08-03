"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatDateKr, seoulDateTime } from "@/lib/format";
import { remainingText, type RefreshStatus } from "@/lib/refresh";
import { useMeta } from "@/lib/use-meta";
import { ErrorState } from "@/components/ErrorState";

// 리프레쉬 — 탭한 시점부터 다시 수집해 데이터를 갱신한다(주인님 지시 2026-08-02).
// 주간 자동 갱신은 그대로 유지되고, 이 화면은 그 사이에 한 번 더 당겨오는 수단이다.
// 수집은 외부 사이트를 도는 작업이라 즉시 끝나지 않는다 — 상태를 숨기지 않고 그대로 말한다.

/** 진행 중일 때 상태를 다시 묻는 간격. 수집이 분 단위라 초 단위 폴링은 낭비다. */
const POLL_MS = 20_000;

type Phase = "loading" | "ready" | "failed";

export default function RefreshPage() {
  const { meta } = useMeta();
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/refresh", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setStatus((await res.json()) as RefreshStatus);
      setPhase("ready");
    } catch {
      setPhase("failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 진행 중일 때만 폴링한다 — 끝난 상태에서 계속 묻지 않는다.
  useEffect(() => {
    if (status?.state !== "running") return;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [status?.state, load]);

  // 수집이 끝나면 데이터 캐시를 비우고 화면을 다시 읽는다.
  // 서비스워커가 직전 물건 목록을 들고 있으면 수집이 끝나도 화면은 옛 데이터 그대로다 —
  // 방문자에게는 "눌렀는데 아무것도 안 바뀌었다"로 남는다(2026-08-02 주인님 지적).
  const wasRunning = useRef(false);
  useEffect(() => {
    if (status?.state === "running") {
      wasRunning.current = true;
      return;
    }
    if (!wasRunning.current || status?.lastConclusion !== "success") return;
    wasRunning.current = false;
    void (async () => {
      if (typeof caches !== "undefined") {
        await caches.delete("auction-data").catch(() => undefined);
      }
      window.location.reload();
    })();
  }, [status?.state, status?.lastConclusion]);

  const start = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const body = (await res.json()) as RefreshStatus & { error?: string };
      if (res.ok || res.status === 202) {
        setStatus(body);
        setNotice("수집을 시작했다. 완료되면 화면의 데이터 기준이 바뀐다.");
      } else {
        setStatus((prev) => (body.state ? body : prev));
        setNotice(body.error ?? "지금은 실행할 수 없다.");
      }
    } catch {
      setNotice("요청을 보내지 못했다. 잠시 후 다시 시도한다.");
    } finally {
      setBusy(false);
    }
  };

  const stamp = meta ? seoulDateTime(meta.crawledAt) : null;
  const now = new Date();
  const waitText = status ? remainingText(status.cooldownUntil, now) : null;
  const running = status?.state === "running";
  const canStart = status?.state === "idle" && !busy;
  // success 외의 결론(failure·cancelled·timed_out)은 모두 "완료되지 못함"으로 본다.
  const failedLast = Boolean(status?.lastConclusion && status.lastConclusion !== "success");

  return (
    <div className="space-y-4 px-4 py-4">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-ink">리프레쉬</h1>
        <p className="text-[13px] leading-snug text-ink/75">
          지금 시점 기준으로 법원경매 목록을 다시 수집해 물건과 최저가를 갱신한다.
        </p>
      </header>

      <section className="rounded-lg border border-ink/15 p-4 text-[13px] leading-snug text-ink/80">
        <p>
          현재 데이터 기준{" "}
          <span className="font-semibold tabular-nums text-ink">
            {stamp ? `${formatDateKr(stamp.date)} ${stamp.time}` : "확인 중"}
          </span>
        </p>
        {/* 상태 변화는 낭독돼야 한다 — 버튼을 눌러도 화면이 그대로면 실패로 읽힌다. */}
        <p role="status" className="mt-2">
          {phase === "loading" && "수집 상태를 확인하는 중"}
          {phase === "ready" && running && "수집이 진행 중이다. 완료까지 10분 안팎 걸린다."}
          {phase === "ready" && status?.state === "cooldown" && waitText && (
            <>연달아 수집하면 법원 사이트가 접속을 차단한다. {waitText} 다시 실행할 수 있다.</>
          )}
          {phase === "ready" && status?.state === "unconfigured" && "실행 권한이 아직 설정되지 않았다."}
          {phase === "ready" && status?.state === "idle" && "지금 실행할 수 있다."}
        </p>
        {/* 직전 실행이 죽었으면 그 사실을 말한다 — 폴링은 running에서 idle로 조용히 되돌아갈 뿐이라
            방문자에게는 "눌렀는데 아무 일도 없었다"로 남는다(§13 규칙 5 조용한 실패 금지). */}
        {phase === "ready" && !running && failedLast && (
          <p role="status" className="mt-2 text-ink">
            직전 수집이 완료되지 못해 데이터는 이전 기준일 그대로다.
          </p>
        )}
        {notice && (
          <p role="status" className="mt-2 font-semibold text-ink">
            {notice}
          </p>
        )}
      </section>

      {phase === "failed" ? (
        <ErrorState message="수집 상태를 불러오지 못했다." onRetry={() => void load()} />
      ) : (
        <button
          type="button"
          onClick={() => void start()}
          disabled={!canStart}
          className="flex min-h-11 w-full items-center justify-center rounded-lg bg-navy px-4 font-semibold text-white transition-colors duration-200 disabled:bg-ink/25 disabled:text-white"
        >
          {running ? "수집 중" : busy ? "요청 중" : "지금 다시 수집"}
        </button>
      )}

      {status?.runUrl && (
        <p className="text-[13px] leading-snug text-ink/75">
          <a href={status.runUrl} target="_blank" rel="noreferrer" className="underline">
            실행 기록 보기
          </a>
        </p>
      )}

      <p className="text-[13px] leading-snug text-ink/75">
        주간 자동 갱신(일요일 03:00)은 이 기능과 무관하게 그대로 유지된다.
      </p>
    </div>
  );
}
