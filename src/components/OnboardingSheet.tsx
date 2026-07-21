"use client";

import { useEffect, useRef, useState } from "react";
import { REGIONS } from "@/types/catalog";
import { PRICE_BANDS } from "@/lib/data";
import { getWatchState, isOnboarded, markOnboarded, setPrefs } from "@/lib/watchlist";
import { FilterChip } from "@/components/FilterChip";
import { PickBadge } from "@/components/PickBadge";

// 온보딩(최초 1회, §4.1 시트 A): 브랜드 설명 1장 + 관심 지역·금액 설정(건너뛰기 가능).
// SSR에 포함해 첫 방문 LCP를 앞당긴다. 완료자는 onboarding-flag.js + CSS가 페인트 전에 숨기고,
// 하이드레이션 후 여기서 실제로 내린다(깜빡임 0).
// 다이얼로그 접근성(감사 #4·#24): 열림 동안 포커스 이동 + Tab 순환 트랩 +
// 배경 inert + body 스크롤 잠금, Escape=건너뛰기. 닫힘 시 전부 원복한다.
// 레이아웃은 헤더/스크롤 본문/고정 푸터 3층이다(감사 2차 47) — 한 겹 스크롤 시트에서는 주 CTA 2개가
// 첫 페인트 가시 높이 0px였다(내용 746px·뷰포트 584px). 진행 수단은 스크롤과 무관하게 항상 보여야 한다.

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function OnboardingSheet({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(true);
  const [regions, setRegions] = useState<string[]>([]);
  const [bands, setBands] = useState<string[]>([]);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const skipRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (isOnboarded()) {
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
    if (save && !setPrefs({ regions, priceBands: bands })) {
      setConfirmSkip(false);
      setSaveFailed(true);
      return;
    }
    markOnboarded();
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
    // 초기 포커스는 제목(감사 2차 79) — 첫 지역 칩에 두면 브랜드·픽 기준 설명 3문단을 낭독 없이 건너뛴다.
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

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cv-onboarding-title"
      aria-describedby="cv-onboarding-desc"
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
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-4">
          {/* 설명 3문단 = 다이얼로그 description(감사 2차 79). 각 문단 1문장 압축(감사 2차 49). */}
          <div id="cv-onboarding-desc">
            <p className="text-[14px] leading-relaxed text-ink/85">
              전국 법원경매에서 <b>2회 이상 유찰돼</b> 가격만 내려간 물건을 모아 보여준다.
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[14px] text-ink/85">
              <PickBadge />
              <span>= 현재 최저가가 감정가의 50% 이하인 물건.</span>
            </p>
            <p className="mt-2 text-[13px] leading-snug text-ink/70">
              무료·무가입, 데이터는 매주 일요일 03:00 갱신.
            </p>
          </div>

          <h3 className="mt-5 text-[13px] font-semibold text-ink/70">관심 지역 (선택)</h3>
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
