"use client";

import { useEffect, useRef, useState } from "react";
import { REGIONS } from "@/types/catalog";
import { PRICE_BANDS } from "@/lib/data";
import {
  getRecentIds,
  getWatchState,
  resetAll,
  setPrefs,
  subscribePrefs,
  subscribeWatchState,
  type Prefs,
} from "@/lib/watchlist";
import { FilterChip } from "@/components/FilterChip";

// 내 설정(/me, 신설 사양 N1)의 클라이언트 블록 — ① 내 관심조건 ② 내 저장 현황 ③ 내 데이터 초기화.
// ①은 신규 작성이 아니라 /guide(GlossarySheet)에서 이관했다(감사 2차 51): 안내=지식, 내 설정=나로
// 역할을 갈라 같은 기능이 두 화면에 뜨지 않게 한다.
// 세 블록이 한 파일인 이유: 초기화가 ①의 칩과 ②의 건수를 동시에 되돌려야 해 부모 하나가 상태를 들어야 한다.

/**
 * 비선택 칩 테두리 대비(감사 2차 80). 흰 카드 위 흰 칩이라 기본 --line(#E7E8E3)으로는 대비 1.23:1 —
 * 컨트롤 경계가 식별되지 않는다(WCAG 1.4.11 비텍스트 3:1). 공용 FilterChip은 그대로 두고
 * 이 칩 묶음에서만 토큰을 덮는다 — #81868E는 흰 칩 3.66:1·Paper 3.50:1.
 * 토큰 이름은 빌드 산출(`.border-line{border-color:var(--line)}`)을 따른다.
 */
const CHIP_BORDER = { "--line": "#81868E" } as React.CSSProperties;

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * 모달 계약(백로그 4·N2와 동일 규격): 초기 포커스·Tab 순환·배경 inert·배경 스크롤 잠금·Escape.
 * 초기화는 되돌릴 수 없으므로 확인 시트도 같은 계약을 지킨다 — 키보드 배경 이탈이 곧 오조작이다.
 */
function useDialogContract(
  open: boolean,
  dialogRef: React.RefObject<HTMLDivElement | null>,
  onEscape: () => void,
) {
  const escapeRef = useRef(onEscape);
  useEffect(() => {
    escapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const prevFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.focus(); // 제목·설명을 먼저 읽히고 조작은 Tab으로 들어간다

    const inerted: HTMLElement[] = [];
    let node: HTMLElement = dialog;
    while (node !== document.body) {
      const parent: HTMLElement | null = node.parentElement;
      if (!parent) break;
      for (const sib of Array.from(parent.children)) {
        if (sib !== node && sib instanceof HTMLElement && sib.tagName !== "SCRIPT" && !sib.inert) {
          sib.inert = true;
          inerted.push(sib);
        }
      }
      node = parent;
    }

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        escapeRef.current();
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
  }, [open, dialogRef]);
}

/** 저장값 로드 전 자리표시(감사 2차 88) — 실제 선택을 모르는 동안 "미선택 칩"을 그리지 않는다. */
function ChipPlaceholder({ label }: { label: string }) {
  return (
    <span className="flex min-h-11 items-center rounded-lg border border-line bg-paper px-3 text-[14px] text-transparent">
      {label}
    </span>
  );
}

// ① 내 관심조건 — 홈 필터 초기값. setPrefs로 선택 즉시 저장한다.
// 저장 실패 표면화(감사 2차 31): 실패하면 칩도 저장값으로 되돌려 화면과 저장소를 일치시킨다.
// 타 탭 반영(감사 2차 33): 다른 탭이 조건을 바꾸면 즉시 다시 읽어, 다음 저장이 타 탭 변경을 덮지 않게 한다.
type SaveState = "idle" | "saved" | "failed" | "synced";

function PrefsEditor({ reloadKey }: { reloadKey: number }) {
  const [prefs, setLocal] = useState<Prefs>({ regions: [], priceBands: [] });
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<SaveState>("idle");
  // 구독 콜백이 최신 화면 값을 보게 하는 거울 — 이펙트 클로저는 첫 렌더의 state에 묶인다.
  const shown = useRef<Prefs>({ regions: [], priceBands: [] });

  const show = (next: Prefs) => {
    shown.current = next;
    setLocal(next);
  };

  // reloadKey는 초기화 완료 신호다 — 저장소를 비운 뒤 이 화면의 칩도 같은 값으로 되돌린다.
  useEffect(() => {
    show(getWatchState().prefs);
    setState("idle");
    setReady(true);
    return subscribePrefs(
      () => shown.current,
      (next) => {
        show(next);
        setState("synced");
      },
    );
  }, [reloadKey]);

  const save = (next: Prefs) => {
    if (!ready) return; // 저장값 로드 전 토글이 기존 설정을 덮어쓰지 않게 막는다
    if (!setPrefs(next)) {
      show(getWatchState().prefs); // 저장 실패 = 화면도 저장값으로 되돌린다
      setState("failed");
      return;
    }
    show(next);
    setState("saved");
  };

  const toggleRegion = (name: string) =>
    save({
      ...prefs,
      regions: prefs.regions.includes(name)
        ? prefs.regions.filter((x) => x !== name)
        : [...prefs.regions, name],
    });

  const toggleBand = (key: string) =>
    save({
      ...prefs,
      priceBands: prefs.priceBands.includes(key)
        ? prefs.priceBands.filter((x) => x !== key)
        : [...prefs.priceBands, key],
    });

  return (
    <section className="rounded-xl border border-line bg-white p-4">
      <h2 className="font-bold">내 관심조건</h2>
      <p className="mt-1 text-[13px] leading-snug text-ink/70">
        홈 필터의 초기값 쓰임, 선택 즉시 저장.
      </p>

      {/* 칩 묶음은 fieldset+legend로 제목과 연결한다(감사 2차 81) — 홈 필터(RegionFilter)와 같은 패턴. */}
      <div style={CHIP_BORDER}>
        <fieldset className="mt-2">
          <legend className="text-[13px] font-semibold text-ink/70">관심 지역</legend>
          <div className="mt-1.5 grid grid-cols-4 gap-1.5">
            {ready
              ? REGIONS.map((r) => (
                  <FilterChip
                    key={r.key}
                    label={r.name}
                    selected={prefs.regions.includes(r.name)}
                    onToggle={() => toggleRegion(r.name)}
                  />
                ))
              : REGIONS.map((r) => <ChipPlaceholder key={r.key} label={r.name} />)}
          </div>
        </fieldset>

        <fieldset className="mt-3">
          <legend className="text-[13px] font-semibold text-ink/70">관심 금액대</legend>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ready
              ? PRICE_BANDS.map((b) => (
                  <FilterChip
                    key={b.key}
                    label={b.label}
                    selected={prefs.priceBands.includes(b.key)}
                    onToggle={() => toggleBand(b.key)}
                  />
                ))
              : PRICE_BANDS.map((b) => <ChipPlaceholder key={b.key} label={b.label} />)}
          </div>
        </fieldset>
      </div>

      {state === "failed" ? (
        <p role="alert" className="mt-2 text-[13px] leading-snug text-ink">
          이 기기에 저장하지 못했다 — 저장 공간을 확보한 뒤 다시 선택하라.
        </p>
      ) : (
        <p role="status" className="mt-2 text-[13px] leading-snug text-ink/70">
          {!ready
            ? "저장한 조건 불러오는 중."
            : state === "saved"
              ? "저장됨, 홈 필터에 바로 반영."
              : state === "synced"
                ? "다른 탭에서 바꾼 조건을 반영함."
                : ""}
        </p>
      )}
    </section>
  );
}

// ②③ 내 저장 현황 + 내 데이터 초기화(감사 2차 52·53).
// 건수는 기존 저장소를 그대로 읽는다 — 자기인식 지표용 새 키를 만들지 않는다.
function MyDataPanel({ onCleared }: { onCleared: () => void }) {
  const [counts, setCounts] = useState<{ watch: number; recent: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cleared, setCleared] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const read = () =>
      setCounts({
        watch: Object.keys(getWatchState().items).length,
        recent: getRecentIds().length,
      });
    read();
    return subscribeWatchState(read); // 타 탭의 관심등록·해제도 이 화면에 반영한다(감사 2차 33)
  }, []);

  const close = () => setConfirming(false);

  const run = () => {
    const ok = resetAll();
    setConfirming(false);
    setFailed(!ok);
    setCleared(ok);
    setCounts({ watch: 0, recent: 0 });
    if (ok) onCleared();
  };

  useDialogContract(confirming, dialogRef, close);

  return (
    <>
      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="font-bold">내 저장 현황</h2>
        <dl className="mt-2 flex gap-8">
          <div>
            <dt className="text-[13px] text-ink/70">관심함</dt>
            <dd className="text-[15px] font-semibold tabular-nums">
              {counts === null ? "—" : `${counts.watch}건`}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-ink/70">최근 본 물건</dt>
            <dd className="text-[15px] font-semibold tabular-nums">
              {counts === null ? "—" : `${counts.recent}건`}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-[13px] leading-snug text-ink/70">
          이 기기에만 저장, 기기 변경 시 이전되지 않음.
        </p>
      </section>

      {/* 지우는 범위·불가역성은 확인 시트에서만 말한다 — 이 카드에 미리 쓰면 같은 문장이 두 번 뜬다. */}
      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="font-bold">내 데이터 초기화</h2>
        <button
          type="button"
          onClick={() => {
            setCleared(false);
            setFailed(false);
            setConfirming(true);
          }}
          className="mt-2 min-h-11 w-full cursor-pointer rounded-lg border border-line bg-paper text-[14px] font-semibold text-ink transition-colors duration-200 hover:bg-line/50"
        >
          초기화
        </button>
        {failed ? (
          <p role="alert" className="mt-2 text-[13px] leading-snug text-ink">
            이 기기에서 지우지 못했다 — 브라우저 저장소 설정을 확인한 뒤 다시 시도하라.
          </p>
        ) : (
          <p role="status" className="mt-2 text-[13px] leading-snug text-ink/70">
            {cleared ? "초기화됨." : ""}
          </p>
        )}
      </section>

      {confirming && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cv-reset-title"
          aria-describedby="cv-reset-desc"
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-end justify-center bg-navy/60"
        >
          <div className="w-full max-w-md rounded-t-2xl bg-paper p-5 pb-8 shadow-[0_8px_24px_rgba(15,42,67,0.14)]">
            <h2 id="cv-reset-title" className="text-lg font-bold">
              초기화 확인
            </h2>
            <p id="cv-reset-desc" className="mt-1 text-[13px] leading-snug text-ink/70">
              관심함·최근 본 물건·관심조건이 사라지고 복구할 수 없다.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={close}
                className="min-h-12 flex-1 cursor-pointer rounded-xl border border-line bg-white font-semibold text-ink transition-colors duration-200 hover:bg-paper"
              >
                취소
              </button>
              {/* 확정 버튼은 "지우기" — 여는 버튼과 같은 라벨을 쓰면 두 버튼이 한 화면에 겹쳐 보인다. */}
              <button
                type="button"
                onClick={run}
                className="min-h-12 flex-1 cursor-pointer rounded-xl bg-accent font-semibold text-white transition-colors duration-200 hover:bg-accent/90"
              >
                지우기
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** /me 본문 3블록. 초기화 성공 신호(reloadKey)로 관심조건 칩까지 한 번에 되돌린다. */
export function MeSettings() {
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <>
      <PrefsEditor reloadKey={reloadKey} />
      <MyDataPanel onCleared={() => setReloadKey((k) => k + 1)} />
    </>
  );
}
