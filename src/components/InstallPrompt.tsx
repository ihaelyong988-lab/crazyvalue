"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

// PWA 설치 유도(기획안 §8 Phase 4.3) — Android/데스크톱은 beforeinstallprompt 배너, iOS Safari는 1회 안내.
// 노출 제한: localStorage "crazyvalue.install.v1" = {"dismissedAt": ISO} — 한 번 닫으면 다시 노출하지 않는다.
// 저장소 읽기 실패 시 조용히 미노출, 쓰기 실패는 기능 저하로만 흡수한다(§13 규칙 5 — 조용한 실패는 미노출 방향으로만).
// 이미 standalone(설치됨) 모드면 미노출. 통합 시 AppShell 등 상시 마운트 지점에 1곳만 배치한다.

const INSTALL_KEY = "crazyvalue.install.v1";

/** 배너 기본 오프셋 = 하단 탭 높이(3.5rem). 페이지 고정 CTA는 이 위로 더 올린다. */
const TABS_PX = 56;

/**
 * 페이지가 렌더한 하단 고정 요소(홈 결과 버튼)의 높이를 실측한다(감사 2차 93 · 오류 원장 2026-07-19).
 * 같은 하단 고정끼리 겹치면 배너가 주 CTA의 탭을 가로챈다. 소유가 다른 컴포넌트에 마커를 심지 않으려고
 * main 안에서 화면 하단에 걸친 요소만 골라 position을 확인한다(스타일 조회는 후보에만 건다).
 */
function measureLift(): number {
  const main = document.querySelector("main");
  if (main === null) return 0;
  const vh = window.innerHeight;
  let lift = 0;
  for (const el of main.querySelectorAll<HTMLElement>("*")) {
    const rect = el.getBoundingClientRect();
    if (rect.height === 0 || rect.bottom <= vh / 2 || rect.top >= vh) continue;
    if (window.getComputedStyle(el).position !== "fixed") continue;
    lift = Math.max(lift, vh - rect.top - TABS_PX);
  }
  return Math.max(0, Math.ceil(lift)); // 올림 — 소수점 잔차로 1px 겹치는 쪽으로 기울지 않게 한다
}

/**
 * 열려 있는 모달 존재 여부(감사 2차 70).
 * 배너는 effect로 늦게 마운트돼 온보딩 시트의 배경 inert 수집 시점에 없다 — 마운트 순서와 무관하게
 * 배너 스스로 모달 열림을 구독해 자기 자신에 inert 속성을 건다.
 */
function modalOpen(): boolean {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'),
  ).some((el) => el.getBoundingClientRect().height > 0);
}

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
  const pathname = usePathname();
  const [mode, setMode] = useState<"android" | "ios" | null>(null);
  const [lift, setLift] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (readDismissed() !== false) return; // 기해제(true)·저장소 실패(null) 모두 미노출

    // 오프셋·inert는 노출 결정과 같은 시점에 계산한다 — 첫 프레임부터 제자리에 그린다.
    const show = (next: "android" | "ios") => {
      setLift(measureLift());
      setBlocked(modalOpen());
      setMode(next);
    };

    if (isIos()) {
      show("ios");
      return;
    }

    const onBeforeInstallPrompt = (e: Event) => {
      if (doneRef.current) return;
      e.preventDefault(); // 브라우저 기본 미니 배너 대신 앱 배너로 안내
      promptRef.current = e as BeforeInstallPromptEvent;
      show("android");
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  // 화면 전환·회전으로 페이지 고정 CTA가 바뀌면 오프셋을 다시 잰다.
  // 동시에 배너가 차지한 높이를 --cv-banner-h로 알린다 — 배너는 fixed라 레이아웃을 밀지 않아서,
  // 이 값을 main 하단 여백에 더하지 않으면 스크롤 끝의 일반 콘텐츠(리스트 더보기 등)를 덮는다.
  useEffect(() => {
    if (mode === null) return;
    const remeasure = () => {
      setLift(measureLift());
      const h = boxRef.current?.getBoundingClientRect().height ?? 0;
      document.documentElement.style.setProperty("--cv-banner-h", `${Math.ceil(h)}px`);
    };
    remeasure();
    window.addEventListener("resize", remeasure);
    return () => {
      window.removeEventListener("resize", remeasure);
      document.documentElement.style.removeProperty("--cv-banner-h");
    };
  }, [mode, pathname]);

  // 모달 열림 구독(감사 2차 70) — 시트가 배경을 수집한 뒤에 마운트돼도 배경 비활성 계약을 지킨다.
  useEffect(() => {
    if (mode === null) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      setBlocked(modalOpen());
    };
    check();
    const observer = new MutationObserver(() => {
      if (frame === 0) frame = window.requestAnimationFrame(check);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [mode]);

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
    // z는 페이지 고정 CTA(z-30)보다 아래로 둔다 — 실측 오프셋이 0으로 떨어져도 주 CTA의 탭을 가로채지 않는다.
    <div
      role="region"
      aria-label="홈 화면 설치 안내"
      inert={blocked}
      style={
        lift > 0
          ? { bottom: `calc(3.5rem + env(safe-area-inset-bottom) + ${lift}px)` }
          : undefined
      }
      className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-20 mx-auto w-full max-w-md px-3 pb-2"
      ref={boxRef}
    >
      <div className="flex items-center gap-2 rounded-xl border border-line bg-white p-3 shadow-[0_8px_24px_rgba(15,42,67,0.14)]">
        {mode === "android" ? (
          <>
            <p className="flex-1 text-[14px] font-semibold leading-snug">미친가치를 홈 화면에 설치</p>
            <button
              type="button"
              onClick={install}
              className="min-h-11 shrink-0 cursor-pointer rounded-lg bg-accent px-4 text-[14px] font-semibold text-white transition-colors duration-200 hover:bg-accent/90"
            >
              설치하기
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="min-h-11 shrink-0 cursor-pointer rounded-lg border border-line px-4 text-[13px] font-medium text-ink/70 transition-colors duration-200 hover:bg-paper"
            >
              닫기
            </button>
          </>
        ) : (
          <>
            <p className="flex-1 text-[13px] leading-snug">
              {"공유 버튼에서 '홈 화면에 추가'를 선택하라."}
            </p>
            <button
              type="button"
              onClick={dismiss}
              className="min-h-11 shrink-0 cursor-pointer rounded-lg border border-line px-4 text-[13px] font-medium text-ink/70 transition-colors duration-200 hover:bg-paper"
            >
              닫기
            </button>
          </>
        )}
      </div>
    </div>
  );
}
