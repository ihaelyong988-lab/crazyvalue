"use client";

import { useEffect, useRef, useState } from "react";
import { REGIONS } from "@/types/catalog";
import { PRICE_BANDS } from "@/lib/data";
import { isOnboarded, markOnboarded, setPrefs } from "@/lib/watchlist";
import { FilterChip } from "@/components/FilterChip";
import { PickBadge } from "@/components/PickBadge";

// 온보딩(최초 1회, §4.1 시트 A): 브랜드 설명 1장 + 관심 지역·금액 설정(건너뛰기 가능).
// SSR에 포함해 첫 방문 LCP를 앞당긴다. 완료자는 onboarding-flag.js + CSS가 페인트 전에 숨기고,
// 하이드레이션 후 여기서 실제로 내린다(깜빡임 0).
// 다이얼로그 접근성(감사 #4·#24): 열림 동안 첫 포커서블 포커스 이동 + Tab 순환 트랩 +
// 배경 inert + body 스크롤 잠금, Escape=건너뛰기. 닫힘 시 전부 원복한다.

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function OnboardingSheet({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(true);
  const [regions, setRegions] = useState<string[]>([]);
  const [bands, setBands] = useState<string[]>([]);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (isOnboarded()) setOpen(false);
  }, []);

  const close = (save: boolean) => {
    if (save) setPrefs({ regions, priceBands: bands });
    else markOnboarded();
    setOpen(false);
    onDone();
  };

  const picked = regions.length + bands.length;

  // 건너뛰기(감사 #23): 선택이 있으면 폐기 확인 1줄을 먼저 보여주고, 한 번 더 누르면 진행한다.
  const skip = () => {
    if (picked > 0 && !confirmSkip) {
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
    setRegions((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name],
    );
  };
  const toggleBand = (key: string) => {
    setConfirmSkip(false);
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
    dialog.querySelector<HTMLElement>(FOCUSABLE)?.focus();

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
      aria-label="미친가치 소개와 관심 조건 설정"
      data-cv-onboarding
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy/60"
    >
      <div className="max-h-[88dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-2xl bg-paper p-5 pb-8">
        <h2 className="text-lg font-bold">
          미친가치 <span className="text-[13px] font-medium text-ink/60">CrazyValue</span>
        </h2>
        <p className="mt-2 text-[14px] leading-relaxed text-ink/85">
          전국 법원경매에서 <b>2회 이상 유찰된 물건만</b> 모아 보여준다. 물건의 가치는
          그대로인데 가격만 내려간 목록이다.
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[14px] text-ink/85">
          <PickBadge />
          <span>= 현재 최저가가 감정가의 50% 이하인 물건. 기준은 공개되어 있다.</span>
        </p>
        <p className="mt-2 text-[13px] text-ink/60">
          무료·무가입. 데이터는 매주 일요일 03:00에 갱신된다.
        </p>

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

        {confirmSkip && (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-line bg-white px-3 py-2 text-[13px] font-medium text-ink"
          >
            선택한 관심 조건 <b className="tabular-nums">{picked}개</b>는 저장되지 않습니다.
            한 번 더 누르면 저장 없이 시작합니다.
          </p>
        )}

        <div className="mt-6 flex gap-2">
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
  );
}
