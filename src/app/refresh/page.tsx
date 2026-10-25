"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { remainingText, type RefreshStatus } from "@/lib/refresh";
import { ErrorState } from "@/components/ErrorState";

// 리프레쉬 — 탭한 시점부터 다시 수집해 데이터를 갱신한다(주인님 지시 2026-08-02).
// 자동 갱신(매일 03:00)은 그대로 유지되고, 이 화면은 그 사이에 한 번 더 당겨오는 수단이다.
// 수집은 외부 사이트를 도는 작업이라 즉시 끝나지 않는다 — 상태를 숨기지 않고 그대로 말한다.

/** 진행 중일 때 상태를 다시 묻는 간격. 수집이 분 단위라 초 단위 폴링은 낭비다. */
const POLL_MS = 20_000;
/** 실행 완료와 배포 반영 사이에는 최대 2분(6회)만 추가 상태 조회한다. */
const PUBLICATION_CHECKS = 6;

type Phase = "loading" | "ready" | "failed";

export default function RefreshPage() {
  const [status, setStatus] = useState<RefreshStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const publicationChecksLeft = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/refresh", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setStatus((await res.json()) as RefreshStatus);
      setNow(Date.now());
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
    publicationChecksLeft.current = PUBLICATION_CHECKS;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [status?.state, load]);

  // 남은 시간은 기기 시계로 갱신하고 해제 시점에 서버 상태를 다시 확인한다.
  // 로컬에서 idle로 바꾸면 미설정이나 다른 실행의 진행 상태를 놓친다.
  useEffect(() => {
    if (status?.state !== "cooldown" || !status.cooldownUntil) return;
    const until = Date.parse(status.cooldownUntil);
    if (!Number.isFinite(until)) return;
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const delay = until > Date.now() ? until - Date.now() : POLL_MS;
    const expiry = setTimeout(() => {
      setNow(Date.now());
      void load();
    }, delay);
    return () => {
      clearInterval(tick);
      clearTimeout(expiry);
    };
  }, [status, load]);

  // 더 새로운 게시가 확인되면 데이터 캐시를 비우고 화면을 다시 읽는다.
  // 서비스워커가 직전 물건 목록을 들고 있으면 수집이 끝나도 화면은 옛 데이터 그대로다 —
  // 방문자에게는 "눌렀는데 아무것도 안 바뀌었다"로 남는다(2026-08-02 주인님 지적).
  const wasRunning = useRef(false);
  const previousPublication = useRef<string | null>(null);
  useEffect(() => {
    if (status?.state === "running") {
      if (!wasRunning.current) previousPublication.current = status.publishedAt;
      wasRunning.current = true;
      return;
    }
    if (
      !wasRunning.current || !previousPublication.current || !status?.publishedAt ||
      Date.parse(status.publishedAt) <= Date.parse(previousPublication.current)
    ) return;
    wasRunning.current = false;
    void (async () => {
      if (typeof caches !== "undefined") {
        await caches.delete("auction-data").catch(() => undefined);
      }
      window.location.reload();
    })();
  }, [status?.state, status?.publishedAt]);

  // 실행이 먼저 끝나고 배포가 나중에 바뀔 수 있다 — 전체 결론과 무관하게 새 게시를 잠시 더 확인한다.
  // 공개 API 조회 예산을 지키도록 횟수를 제한하고, 새 게시·언마운트 때 바로 멈춘다.
  useEffect(() => {
    if (!status?.state || status.state === "running" || !wasRunning.current || publicationChecksLeft.current <= 0) return;
    const id = setInterval(() => {
      if (!wasRunning.current || publicationChecksLeft.current <= 0) {
        clearInterval(id);
        return;
      }
      publicationChecksLeft.current -= 1;
      void load();
      if (publicationChecksLeft.current === 0) clearInterval(id);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [status?.state, status?.publishedAt, load]);

  const start = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const body = (await res.json()) as RefreshStatus & { error?: string; outcome?: string };
      if (res.ok || res.status === 202) {
        setStatus(body);
        setNotice("수집을 시작했다. 완료되면 화면 상단의 수집 시각이 바뀐다.");
      } else {
        setStatus((prev) => (body.state ? body : prev));
        setNotice(body.error ?? "지금은 실행할 수 없다.");
        if (body.outcome === "unknown") await load();
      }
    } catch {
      setNotice("실행 요청 결과를 확인하지 못해 상태를 다시 확인한다.");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const waitText = status ? remainingText(status.cooldownUntil, new Date(now)) : null;
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

      {/* 현재 수집 시각은 다시 적지 않는다 — 화면 상단 기준일 바가 그 값을 말하는 유일한 자리다(1정보 1표시). */}
      <section className="rounded-lg border border-ink/15 p-4 text-[13px] leading-snug text-ink/80">
        {/* 상태 변화는 낭독돼야 한다 — 버튼을 눌러도 화면이 그대로면 실패로 읽힌다. */}
        <p role="status">
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
            직전 실행이 정상 완료되지 않았으며 게시된 데이터는 화면 상단의 수집 시각으로 확인한다.
          </p>
        )}
        {notice && (
          <p role="status" className="mt-2 font-semibold text-ink">
            {notice}
          </p>
        )}
      </section>

      {phase === "failed" ? (
        <ErrorState
          message="수집 상태를 불러오지 못했다."
          action="잠시 후 수집 상태를 다시 확인한다."
          onRetry={() => void load()}
        />
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
        자동 갱신(매일 03:00)은 이 기능과 무관하게 그대로 유지된다.
      </p>
    </div>
  );
}
