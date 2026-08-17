"use client";

import { useEffect, useRef, useState } from "react";
import { REGIONS } from "@/types/catalog";
import { PRICE_BANDS } from "@/lib/data";
import { getWatchState, isOnboarded, markOnboarded, setPrefs, type Prefs } from "@/lib/watchlist";
import { FilterChip } from "@/components/FilterChip";

// 온보딩(최초 1회, §4.1 시트 A): 관심 지역·금액 설정(건너뛰기 가능).
// SSR에 포함해 첫 방문 LCP를 앞당긴다. 완료자는 onboarding-flag.js + CSS가 페인트 전에 숨기고,
// 하이드레이션 후 여기서 실제로 내린다(깜빡임 0).
// 다이얼로그 접근성(감사 #4·#24): 열림 동안 포커스 이동 + Tab 순환 트랩 +
// 배경 inert + body 스크롤 잠금, Escape=건너뛰기. 닫힘 시 전부 원복한다.
// 레이아웃은 헤더/스크롤 본문/고정 푸터 3층이다(감사 2차 47) — 한 겹 스크롤 시트에서는 주 CTA 2개가
// 첫 페인트 가시 높이 0px였다(내용 746px·뷰포트 584px). 진행 수단은 스크롤과 무관하게 항상 보여야 한다.

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// 저장이 막힌 기기(용량 초과·프라이빗)에서 건너뛰기로 진행한 방문자 표시(감사 3차 J1).
// 완료가 localStorage에 남지 않으므로 이 플래그가 없으면 SPA 이동·뒤로가기마다 온보딩이 처음부터 다시 뜬다.
// 메모리에만 둔다 — 저장 실패를 저장 성공으로 위장하지 않고, 탭을 닫으면 사라진다.
let skippedUnsaved = false;

/** 이 세션에서 저장 없이 온보딩을 마쳤는가. 서버·하이드레이션 시점에는 항상 false다(마크업 불일치 0). */
export function isSkippedUnsaved(): boolean {
  return skippedUnsaved;
}

/** 종료 결과 — 시트 유지 · 정상 종료 · 기록 실패를 고지하고 종료. */
export type OnboardingExit = "save-failed" | "closed" | "closed-unsaved";

/**
 * 온보딩 종료 판정(감사 3차 J1). `markOnboarded`의 실패를 삼키면 완료가 기록되지 않은 채 시트만 닫혀
 * 재방문마다 온보딩이 처음부터 다시 뜬다 — 저장 경로와 건너뛰기 경로의 처방이 다르다.
 * - 저장 경로: 조건 저장이든 완료 기록이든 실패하면 시트를 유지하고 알린다(재시도 수단이 화면에 남는다).
 * - 건너뛰기 경로: 유일한 진행 수단이므로 닫되, 세션 플래그로 같은 세션 재노출만 막는다.
 */
export function resolveExit(save: boolean, prefs: Prefs): OnboardingExit {
  if (save && !setPrefs(prefs)) return "save-failed";
  if (markOnboarded()) return "closed";
  if (save) return "save-failed";
  skippedUnsaved = true;
  return "closed-unsaved";
}

export function OnboardingSheet({ onDone }: { onDone: () => void }) {
  // 세션 플래그는 하이드레이션 시점에 항상 false라 서버 마크업과 어긋나지 않는다.
  // 저장소 조회(isOnboarded)는 여기서 하지 않는다 — 완료자 깜빡임 처리는 아래 효과가 맡는다.
  const [open, setOpen] = useState(() => !isSkippedUnsaved());
  const [unsaved, setUnsaved] = useState(false);
  const [regions, setRegions] = useState<string[]>([]);
  const [bands, setBands] = useState<string[]>([]);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const skipRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (isSkippedUnsaved() || isOnboarded()) {
      setOpen(false);
      return;
    }
    // 저장된 관심조건을 칩에 싣는다(감사 2차 34 동반) — 완료 플래그를 setPrefs와 분리한 뒤로는
    // /me에서 조건을 먼저 저장한 방문자에게도 이 시트가 열리므로, 빈 선택 저장이 그 조건을 지운다.
    const { prefs } = getWatchState();
    if (prefs.regions.length > 0) setRegions(prefs.regions);
    if (prefs.priceBands.length > 0) setBands(prefs.priceBands);
  }, []);

  // 온보딩 완료 플래그는 이 시트에서만 기록한다(감사 2차 34) — 관심조건 저장(setPrefs)과 분리해,
  // 내 설정에서 칩을 한 번 누른 방문자에게 브랜드 소개가 영구 미노출되는 결합을 끊는다.
  // 저장 실패 시(감사 2차 31)에는 시트를 닫지 않고 실패를 알린다 — 건너뛰기가 진행 수단이다.
  const close = (save: boolean) => {
    const exit = resolveExit(save, { regions, priceBands: bands });
    if (exit === "save-failed") {
      setConfirmSkip(false);
      setSaveFailed(true);
      return;
    }
    setUnsaved(exit === "closed-unsaved");
    setOpen(false);
    onDone();
  };

  const picked = regions.length + bands.length;

  // 건너뛰기(감사 #23): 선택이 있으면 폐기 확인 1줄을 먼저 보여주고, 한 번 더 누르면 진행한다.
  const skip = () => {
    if (picked > 0 && !confirmSkip) {
      setSaveFailed(false); // 안내는 한 번에 하나만 — 1정보 1표시
      setConfirmSkip(true);
      return;
    }
    close(false);
  };
  // Escape 핸들러(문서 리스너)가 최신 선택·확인 상태를 보도록 매 렌더 갱신한다.
  useEffect(() => {
    skipRef.current = skip;
  });

  const toggleRegion = (name: string) => {
    setConfirmSkip(false); // 선택을 이어가면 폐기 확인을 철회한다
    setSaveFailed(false); // 선택이 바뀌면 지난 저장 실패 안내도 철회한다
    setRegions((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name],
    );
  };
  const toggleBand = (key: string) => {
    setConfirmSkip(false);
    setSaveFailed(false);
    setBands((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key],
    );
  };

  // 열림 동안 다이얼로그 패턴 적용, 클린업에서 원복(감사 #4·#24).
  useEffect(() => {
    if (!open || isOnboarded()) return; // 완료자 하이드레이션 커밋(닫히기 직전 1회)에는 미적용
    const dialog = dialogRef.current;
    if (!dialog) return;

    const prevFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // 초기 포커스는 제목(감사 2차 79) — 다이얼로그 관례상 제목에 둔다.
    titleRef.current?.focus();

    // 배경 inert: 다이얼로그 조상 경로의 형제 요소만 비활성화한다(다이얼로그 자신은 유지).
    const inerted: HTMLElement[] = [];
    let node: HTMLElement = dialog;
    while (node !== document.body) {
      const parent: HTMLElement | null = node.parentElement;
      if (!parent) break;
      const siblings: Element[] = Array.from(parent.children);
      for (const sib of siblings) {
        if (sib !== node && sib instanceof HTMLElement && sib.tagName !== "SCRIPT" && !sib.inert) {
          sib.inert = true;
          inerted.push(sib);
        }
      }
      node = parent;
    }

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // 배경 스크롤 잠금(감사 #24)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        skipRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      for (const el of inerted) el.inert = false;
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus();
    };
  }, [open]);

  // 건너뛰기로 닫혔지만 완료를 기록하지 못한 경우에만 사실을 1문장으로 남긴다(감사 3차 J1).
  // 시트를 다시 세우지는 않는다 — 진행을 막지 않으면서 재노출의 이유를 미리 알린다.
  if (!open) {
    return unsaved ? (
      <p
        role="alert"
        className="rounded-xl border border-line bg-white px-4 py-3 text-[13px] font-medium leading-snug text-ink"
      >
        이 기기에 저장하지 못해 다음 방문에 관심조건 설정이 다시 열린다.
      </p>
    ) : null;
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cv-onboarding-title"
      data-cv-onboarding
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy/60"
    >
      <div className="flex max-h-[88dvh] w-full max-w-md flex-col rounded-t-2xl bg-paper shadow-[0_8px_24px_rgba(15,42,67,0.14)]">
        <h2
          ref={titleRef}
          id="cv-onboarding-title"
          tabIndex={-1}
          className="shrink-0 px-5 pt-5 text-lg font-bold"
        >
          미친가치 <span className="text-[13px] font-medium text-ink/70">CrazyValue</span>
        </h2>

        {/* 스크롤 본문 — min-h-0이 있어야 flex 자식이 푸터를 밀어내지 않고 자기 안에서 스크롤한다. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-4">
          <h3 className="text-[13px] font-semibold text-ink/70">관심 지역 (선택)</h3>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {REGIONS.map((r) => (
              <FilterChip
                key={r.key}
                label={r.name}
                selected={regions.includes(r.name)}
                onToggle={() => toggleRegion(r.name)}
              />
            ))}
          </div>

          <h3 className="mt-4 text-[13px] font-semibold text-ink/70">관심 금액대 (선택)</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRICE_BANDS.map((b) => (
              <FilterChip
                key={b.key}
                label={b.label}
                selected={bands.includes(b.key)}
                onToggle={() => toggleBand(b.key)}
              />
            ))}
          </div>
        </div>

        {/* 고정 푸터 — 진행 수단(CTA 2개)과 선택 개수는 스크롤 위치와 무관하게 항상 보인다. */}
        <div className="shrink-0 border-t border-line px-5 pt-3 pb-8">
          {saveFailed ? (
            <p role="alert" className="mb-2 text-[13px] font-medium leading-snug text-ink">
              이 기기에 저장하지 못했다 — 저장 공간을 확보한 뒤 다시 누르거나 건너뛰기로 시작하라.
            </p>
          ) : (
            confirmSkip && (
              <p role="alert" className="mb-2 text-[13px] font-medium leading-snug text-ink">
                한 번 더 누르면 선택을 저장하지 않고 시작한다.
              </p>
            )
          )}
          {/* 선택 개수 상시 표시 + 재설정 위치 1줄(감사 2차 48) — 건너뛴 방문자도 되돌아올 곳을 안다.
              라이브 영역은 숫자 부분뿐이다: 문장 전체를 읽히면 칩을 누를 때마다 안내가 반복된다. */}
          <p className="text-[13px] leading-snug text-ink/70">
            <span role="status" className="tabular-nums">
              선택 {picked}개
            </span>{" "}
            · 나중에 내 설정 탭에서 변경.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={skip}
              className="min-h-12 flex-1 cursor-pointer rounded-xl border border-line bg-white font-semibold text-ink transition-colors duration-200 hover:bg-paper"
            >
              건너뛰기
            </button>
            <button
              type="button"
              onClick={() => close(true)}
              className="min-h-12 flex-1 cursor-pointer rounded-xl bg-accent font-semibold text-white transition-colors duration-200 hover:bg-accent/90"
            >
              저장하고 시작
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
