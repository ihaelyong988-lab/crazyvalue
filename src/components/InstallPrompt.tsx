"use client";

import { useEffect, useRef, useState } from "react";

// PWA 설치 유도(기획안 §8 Phase 4.3) — Android/데스크톱은 beforeinstallprompt 배너, iOS Safari는 1회 안내.
// 노출 제한: localStorage "crazyvalue.install.v1" = {"dismissedAt": ISO} — 한 번 닫으면 다시 노출하지 않는다.
// 저장소 읽기 실패 시 조용히 미노출, 쓰기 실패는 기능 저하로만 흡수한다(§13 규칙 5 — 조용한 실패는 미노출 방향으로만).
// 이미 standalone(설치됨) 모드면 미노출. 통합 시 AppShell 등 상시 마운트 지점에 1곳만 배치한다.

const INSTALL_KEY = "crazyvalue.install.v1";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isStandalone(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true; // iOS Safari 전용 속성
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/** 반환 의미 — false: 미해제(노출 가능) · true: 기해제 · null: 저장소 접근 실패(미노출 처리). */
function readDismissed(): boolean | null {
  try {
    const raw = window.localStorage.getItem(INSTALL_KEY);
    if (raw === null) return false;
    const parsed: unknown = JSON.parse(raw);
    const dismissedAt =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { dismissedAt?: unknown }).dismissedAt
        : undefined;
    return typeof dismissedAt === "string";
  } catch {
    return null;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(
      INSTALL_KEY,
      JSON.stringify({ dismissedAt: new Date().toISOString() }),
    );
  } catch {
    // 저장 실패(용량·프라이빗 모드)는 무시 — 다음 방문에 다시 보일 뿐이다.
  }
}

export function InstallPrompt() {
  const [mode, setMode] = useState<"android" | "ios" | null>(null);
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (readDismissed() !== false) return; // 기해제(true)·저장소 실패(null) 모두 미노출

    if (isIos()) {
      setMode("ios");
      return;
    }

    const onBeforeInstallPrompt = (e: Event) => {
      if (doneRef.current) return;
      e.preventDefault(); // 브라우저 기본 미니 배너 대신 앱 배너로 안내
      promptRef.current = e as BeforeInstallPromptEvent;
      setMode("android");
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  if (mode === null) return null;

  const dismiss = () => {
    doneRef.current = true;
    writeDismissed();
    setMode(null);
  };

  const install = async () => {
    const ev = promptRef.current;
    promptRef.current = null;
    try {
      if (ev) await ev.prompt();
    } catch {
      // 프롬프트 실패도 종료로만 처리한다.
    } finally {
      dismiss(); // 결과 무관 배너 닫기
    }
  };

  return (
    <div
      role="region"
      aria-label="홈 화면 설치 안내"
      className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 mx-auto w-full max-w-md px-3 pb-2"
    >
      <div className="rounded-xl border border-line bg-white p-4 shadow-[0_8px_24px_rgba(15,42,67,0.14)]">
        {mode === "android" ? (
          <>
            <p className="text-[14px] font-semibold">미친가치를 홈 화면에 설치</p>
            <p className="mt-0.5 text-[13px] text-ink/70">앱처럼 전체 화면으로 바로 열립니다.</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={install}
                className="min-h-11 flex-1 cursor-pointer rounded-lg bg-accent px-4 text-[14px] font-semibold text-white transition-colors duration-200 hover:bg-accent/90"
              >
                홈 화면에 설치
              </button>
              <button
                type="button"
                onClick={dismiss}
                className="min-h-11 shrink-0 cursor-pointer rounded-lg border border-line px-4 text-[13px] font-medium text-ink/70 transition-colors duration-200 hover:bg-paper"
              >
                닫기
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[13px] leading-relaxed">
              {"공유 버튼을 눌러 '홈 화면에 추가'를 선택하세요"}
            </p>
            <div className="mt-3 flex">
              <button
                type="button"
                onClick={dismiss}
                className="min-h-11 flex-1 cursor-pointer rounded-lg border border-line text-[13px] font-medium text-ink/70 transition-colors duration-200 hover:bg-paper"
              >
                닫기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
