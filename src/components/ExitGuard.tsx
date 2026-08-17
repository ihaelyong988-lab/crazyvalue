"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { AuctionItem } from "@/types/auction";
import { REGIONS } from "@/types/catalog";
import { isValidAuctionItem } from "@/lib/data";
import { getRecentIds, getWatchState, isWatched, toggleWatch } from "@/lib/watchlist";

// 이탈 확인(감사 2차 69 · 신설 사양 N2) — 앱 전체에 이탈·종료 확인 수단이 없어,
// 관심함에 아무것도 저장하지 않은 방문자는 떠나는 순간 탐색 결과를 잃는다.
// 손실 시나리오 = 관심함 0건 + 최근 본 물건 1건 이상. 이 조건에서만 가드한다(넓히면 이탈 방해가 된다).
//   ① 홈 뒤로가기: 홈에서 센티넬 이력 1개를 쌓아 두고, 뒤로가기가 그것을 소진하면 확인 시트를 연다.
//   ② 탭 닫기: 같은 조건에서만 beforeunload를 1개 등록한다(브라우저 표준상 문구 지정 불가).
// "그대로 나가기"를 고르면 가드를 끄고 실제로 뒤로 보낸다 — 영구 가로채기는 금지다.
// "가장 최근 물건 저장"은 그 물건을 실제로 관심등록한 뒤 상세로 보낸다 — 라벨이 약속한 저장을
// 화면 이동으로 대신하면 저장 0건이 된다(감사 3차 J7-H: 저장도 이동도 일어나지 않았다).
// AppShell에 1곳만 마운트한다.

const NAV_KEY = "crazyvalue.nav.v1";
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** 이 탭에서 앱 내 클라이언트 라우팅이 1회 이상 일어났음을 기록한다. */
export function markAppNavigated(): void {
  try {
    window.sessionStorage.setItem(NAV_KEY, "1");
  } catch {
    // 세션 저장 불가(프라이빗 모드)는 판정 false로 흡수한다 — 폴백 경로가 기본값이다.
  }
}

/**
 * 뒤로가기가 앱 안으로 돌아가는지 판정한다(감사 2차 67).
 * `history.length`는 외부 유입 이력까지 세어 공유 링크 방문자에게도 1을 넘으므로 폴백을 무력화한다.
 * 이 플래그는 앱이 실제로 만든 이동만 센다 — 직접 진입자는 false, 앱 내 이동자는 true다.
 */
export function hasAppNavigated(): boolean {
  try {
    return window.sessionStorage.getItem(NAV_KEY) === "1";
  } catch {
    return false;
  }
}

/** 손실 시나리오 판정 + 시트 문구에 쓸 최근 본 물건 목록. */
function readLoss(): { at: boolean; recent: string[] } {
  const recent = getRecentIds();
  const at = recent.length > 0 && Object.keys(getWatchState().items).length === 0;
  return { at, recent };
}

/**
 * 최근 본 물건 id로 산출물에서 그 물건을 찾는다 — 관심함 저장에는 스냅샷(최저가·기일·유찰 수)이 필요하다.
 * id 접두가 지역 키("{regionKey}-…")라 파일 1개만 읽는다(data-server.findItem과 같은 규약).
 * 갱신에서 내려간 id는 null이다 — 호출부가 실패를 표면화한다(성공한 척 금지, §13 규칙 5).
 */
async function findItemById(id: string): Promise<AuctionItem | null> {
  const prefix = id.split("-")[0];
  if (!REGIONS.some((r) => r.key === prefix)) return null;
  try {
    const res = await fetch(`/data/${prefix}.json`);
    if (!res.ok) return null;
    const raw: unknown = await res.json();
    if (!Array.isArray(raw)) return null;
    for (const entry of raw) if (isValidAuctionItem(entry) && entry.id === id) return entry;
    return null;
  } catch {
    return null;
  }
}

export function ExitGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const armedRef = useRef(false);
  const bypassRef = useRef(false);
  const leavingRef = useRef(false);
  const pathRef = useRef(pathname);
  const navPathRef = useRef<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 앱 내 내비게이션 플래그(감사 2차 67) — 최초 진입은 이동이 아니다.
  useEffect(() => {
    pathRef.current = pathname;
    leavingRef.current = false; // 이동이 끝났다 — 다음 손실 시나리오에서는 다시 무장한다
    if (navPathRef.current === null || navPathRef.current === pathname) {
      navPathRef.current = pathname;
      return;
    }
    navPathRef.current = pathname;
    markAppNavigated();
  }, [pathname]);

  // 가드 무장 — 손실 시나리오에서만, 시트가 닫혀 있고 이탈·이동 확정 전일 때만 건다.
  useEffect(() => {
    if (open || bypassRef.current || leavingRef.current) return;
    const { at, recent: ids } = readLoss();
    if (!at) return;
    setRecent(ids);

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!readLoss().at) return; // 등록 뒤 관심함에 저장했으면 확인창을 띄우지 않는다
      e.preventDefault();
      e.returnValue = ""; // 일부 브라우저는 이 값이 있어야 종료 확인창을 띄운다
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    // 센티넬은 홈에서만 쌓는다. 이미 센티넬 위에 서 있으면 다시 쌓지 않는다(이력 누적 방지).
    // 기존 state를 반드시 보존한다 — 통째로 교체하면 Next app-router의 `__NA` 마커가 사라지고,
    // popstate에서 마커가 없으면 라우터가 window.location.reload()로 떨어져 뒤로가기가
    // SPA 복원이 아니라 문서 전체 재로드가 된다(감사 3차: 복원 275ms vs 정상 58ms · 페이지 상태 소멸).
    if (pathname === "/") {
      const state = (window.history.state ?? {}) as Record<string, unknown>;
      if (state.cvExitGuard !== true)
        window.history.pushState({ ...state, cvExitGuard: true }, "", window.location.href);
      armedRef.current = true;
    }
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      armedRef.current = false;
    };
  }, [open, pathname]);

  // 뒤로가기 가로채기는 1회뿐 — 홈에서 홈 센티넬을 소진한 경우에만 시트를 연다.
  // 앱 내 이동(상세→홈 복귀 등)은 출발지·도착지 판정으로 걸러 그대로 통과시킨다.
  useEffect(() => {
    const onPopState = () => {
      if (!armedRef.current) return;
      if (pathRef.current !== "/" || window.location.pathname !== "/") return;
      armedRef.current = false;
      setOpen(true);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // 시트는 홈의 이탈 확인 수단이다 — 열린 채 화면이 바뀌면 배경 inert·스크롤 잠금이 착지 화면을 잠근다
  // (감사 3차 J7-L: 상세에 착지하고도 관심등록·하단 탭이 눌리지 않았다). 화면이 바뀌면 닫는다.
  useEffect(() => {
    if (open && pathname !== "/") setOpen(false);
  }, [open, pathname]);

  const stay = useCallback(() => setOpen(false), []);

  // 저장 동선: 가장 최근에 본 물건을 실제로 관심등록한 뒤 그 상세로 보낸다.
  // 이동 확정 전에 leavingRef를 세운다 — 세우지 않으면 setOpen(false)가 무장 effect를 재실행하고,
  // 그 센티넬 pushState가 진행 중이던 router.push를 취소해 버튼이 무동작이 된다(감사 3차 J7-K A/B).
  const save = async () => {
    const id = recent[0];
    if (id === undefined || saving) return;
    setSaving(true);
    setSaveError(null);
    const item = await findItemById(id);
    if (item === null) {
      setSaving(false);
      setSaveError("이 물건은 갱신에서 내려가 관심함에 저장할 수 없다.");
      return;
    }
    if (!isWatched(id) && !toggleWatch(item).saved) {
      setSaving(false);
      setSaveError("이 기기에 저장하지 못했다 — 저장 공간을 확보한 뒤 다시 누르라.");
      return;
    }
    leavingRef.current = true;
    router.push(`/item/${id}`);
    setOpen(false);
    setSaving(false);
  };

  // 이탈 확정: 가드를 끄고 실제로 뒤로 보낸다(확인 뒤에는 다시 가로채지 않는다).
  // 가드가 쌓아 둔 홈 센티넬이 아래에 남아 있으면 홈에 다시 서는 것처럼 보이므로,
  // 도착지가 홈인 동안만 최대 2칸 더 지난다 — 다른 화면에 도착하면 즉시 멈춘다.
  const leave = () => {
    bypassRef.current = true;
    setOpen(false);
    let hops = 2;
    const onPop = () => {
      if (hops === 0 || window.location.pathname !== "/") {
        window.removeEventListener("popstate", onPop);
        return;
      }
      hops -= 1;
      window.history.back();
    };
    window.addEventListener("popstate", onPop);
    window.setTimeout(() => window.removeEventListener("popstate", onPop), 2000);
    window.history.back();
  };

  // 모달 계약(백로그 4와 동일 규격): 포커스 이동·Tab 순환·배경 inert·배경 스크롤 잠금·Escape.
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
        stay();
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
  }, [open, stay]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cv-exit-title"
      aria-describedby="cv-exit-desc"
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy/60"
    >
      <div className="w-full max-w-md rounded-t-2xl bg-paper p-5 pb-8 shadow-[0_8px_24px_rgba(15,42,67,0.14)]">
        <div className="flex items-start justify-between gap-2">
          <h2 id="cv-exit-title" className="text-lg font-bold">
            저장 없이 나가기
          </h2>
          <button
            type="button"
            onClick={stay}
            aria-label="계속 보기"
            className="-mt-2 -mr-2 flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink/70 transition-colors duration-200 hover:bg-line/50"
          >
            <X size={20} aria-hidden />
          </button>
        </div>
        <p id="cv-exit-desc" className="mt-1 text-[13px] leading-snug text-ink/70">
          최근 본 물건 <b className="tabular-nums">{recent.length}건</b>은 관심함에 저장해야 다음
          방문에 남는다.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={leave}
            className="min-h-12 flex-1 cursor-pointer rounded-xl border border-line bg-white font-semibold text-ink transition-colors duration-200 hover:bg-paper"
          >
            그대로 나가기
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="min-h-12 flex-1 cursor-pointer rounded-xl bg-accent font-semibold text-white transition-colors duration-200 hover:bg-accent/90 disabled:cursor-default disabled:bg-accent/70"
          >
            {saving ? "저장 중" : "가장 최근 물건 저장"}
          </button>
        </div>
        {saveError !== null && (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-line bg-white px-3 py-2 text-[13px] leading-snug"
          >
            {saveError}
          </p>
        )}
      </div>
    </div>
  );
}
