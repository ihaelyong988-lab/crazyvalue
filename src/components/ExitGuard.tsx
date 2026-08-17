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
// 손실 시나리오 = 관심함 0건 + **현재 산출물에 남아 있는** 최근 본 물건 1건 이상.
//   ① 홈 뒤로가기: 앱 진입 칸에서만 센티넬 이력 1개를 쌓고, 뒤로가기가 그것을 소진하면 확인 시트를 연다.
//   ② 탭 닫기: 같은 조건에서만 beforeunload를 1개 등록한다(브라우저 표준상 문구 지정 불가).
// "그대로 나가기"를 고르면 가드를 끄고 실제로 뒤로 보낸다 — 영구 가로채기는 금지다.
// "가장 최근 물건 저장"은 그 물건을 실제로 관심등록한 뒤 상세로 보낸다 — 라벨이 약속한 저장을
// 화면 이동으로 대신하면 저장 0건이 된다(감사 3차 J7-H: 저장도 이동도 일어나지 않았다).
//
// 가드 범위는 두 번 좁혔다.
//   · 감사 3차 97 — 앱 안으로 돌아가는 뒤로가기까지 가로챘다(홈→리스트→홈에서 뒤로 = 경고). 앱이 만든
//     이력 칸 수를 세어, 돌아갈 칸이 남아 있으면 센티넬을 쌓지도 시트를 열지도 않는다. 센티넬이 진입 칸
//     한 곳에서만 생기므로 홈 방문마다 이력이 2칸씩 불어나던 것도 함께 끝난다.
//   · 감사 3차 99 — 갱신에서 내려간 id를 세어 홈은 0건인데 시트만 1건이라 했다. 무엇을 세는지는
//     presentRecent 하나가 정한다(RecentViewed와 공유).
// AppShell에 1곳만 마운트한다.

const NAV_KEY = "crazyvalue.nav.v1";
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * 이 탭에서 앱이 만든 이력 칸 수 — 앱에 들어선 칸이 0이고, 클라이언트 라우팅·센티넬이 1칸씩 쌓는다.
 * 0 = 지금 서 있는 칸이 진입 칸 = 다음 뒤로가기는 앱 밖으로 나간다(감사 3차 97).
 */
export function appHistoryDepth(): number {
  try {
    const raw = window.sessionStorage.getItem(NAV_KEY);
    if (raw === null) return 0;
    const depth = Number(raw); // 구버전 값 "1"은 이동 1회 = 칸 1개로 읽힌다(하위호환)
    return Number.isInteger(depth) && depth > 0 ? depth : 0;
  } catch {
    // 세션 저장 불가(프라이빗 모드)는 0으로 흡수한다 — 폴백 경로가 기본값이다.
    return 0;
  }
}

function writeDepth(depth: number): void {
  try {
    window.sessionStorage.setItem(NAV_KEY, String(depth));
  } catch {
    // 기록 실패는 "셀 수 없음"이다 — 가드가 덜 걸릴 뿐, 앱 안 이동을 가로채지는 않는다.
  }
}

/** 앱이 이력 칸을 하나 쌓았다(클라이언트 라우팅 push · 센티넬 push). */
export function markAppNavigated(): void {
  writeDepth(appHistoryDepth() + 1);
}

/** 뒤로가기가 앱 이력 칸을 하나 소진했다. */
export function markAppPopped(): void {
  const depth = appHistoryDepth();
  if (depth > 0) writeDepth(depth - 1);
}

/**
 * 앱 안으로 돌아갈 이력이 남아 있는가(감사 2차 67).
 * `history.length`는 외부 유입 이력까지 세어 공유 링크 방문자에게도 1을 넘으므로 폴백을 무력화한다.
 * 이 값은 앱이 실제로 만든 칸만 센다 — 직접 진입자는 false, 앱 내 이동자는 true다.
 */
export function hasAppNavigated(): boolean {
  return appHistoryDepth() > 0;
}

/** 센티넬 처리 계획(감사 3차 97). */
export type SentinelPlan = "push" | "arm" | "skip";

/**
 * 센티넬을 쌓을지·무장만 할지·건너뛸지 정한다.
 * 돌아갈 칸이 남아 있으면(depth > 0) 그 뒤로가기는 앱 안으로 가는 이동이므로 가드하지 않는다.
 * 이미 센티넬 위에 서 있으면 다시 쌓지 않는다 — 쌓으면 홈 방문마다 이력이 2칸이 된다.
 */
export function planSentinel(input: { onSentinel: boolean; depth: number }): SentinelPlan {
  if (input.onSentinel) return "arm";
  return input.depth === 0 ? "push" : "skip";
}

/**
 * 이 뒤로가기가 앱 밖으로 나가는가(감사 3차 97) — 시트는 이때만 연다.
 * armed = 센티넬 위에 서 있었다 · depth 0 = 소진하고 나니 앱이 만든 칸이 남지 않았다.
 */
export function isExitBack(input: {
  armed: boolean;
  depth: number;
  from: string;
  to: string;
}): boolean {
  return input.armed && input.depth === 0 && input.from === "/" && input.to === "/";
}

/**
 * 같은 화면을 가리키는 경로인가.
 * 물건 id에 한글이 들어가 `location.pathname`(퍼센트 인코딩)과 `usePathname()`의 표기가 갈릴 수 있다 —
 * 문자열 비교만 하면 뒤로가기를 새 이동으로 세어 칸 수가 0으로 내려오지 못한다.
 */
function samePath(a: string, b: string): boolean {
  const decode = (p: string): string => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p; // 이미 디코드된 경로에 %가 들어 있으면 원문으로 비교한다
    }
  };
  return a === b || decode(a) === decode(b);
}

/** 무장 이후에도 손실 상태가 유지되는가 — 관심함에 저장했거나 기록을 지웠으면 가드하지 않는다. */
function stillAtLoss(): boolean {
  return getRecentIds().length > 0 && Object.keys(getWatchState().items).length === 0;
}

/**
 * 최근 본 물건 중 **현재 산출물에 남아 있는 것**만 추린다(감사 3차 99).
 * 손실 판정·시트 문구·저장 대상이 이 판정 하나를 쓰고, 홈 "최근 본 물건" 섹션(RecentViewed)도 같은 것을 쓴다.
 * 기준이 갈리면 한 화면은 0건, 다른 화면은 1건이라고 말한다.
 */
export function presentRecent(find: (id: string) => AuctionItem | undefined): AuctionItem[] {
  return getRecentIds()
    .map(find)
    .filter((item): item is AuctionItem => item !== undefined);
}

/** 지역 산출물 색인 캐시 — 같은 문서에서 같은 지역 파일을 두 번 읽지 않는다. 실패분은 남기지 않는다. */
const regionCache = new Map<string, Promise<Map<string, AuctionItem> | null>>();

/** 지역 파일 1개 → id 색인. null = 조회 실패(존재 여부 미상이므로 가드하지 않는다). */
async function readRegion(key: string): Promise<Map<string, AuctionItem> | null> {
  try {
    const res = await fetch(`/data/${key}.json`);
    if (!res.ok) return null;
    const raw: unknown = await res.json();
    if (!Array.isArray(raw)) return null;
    const index = new Map<string, AuctionItem>();
    for (const entry of raw) if (isValidAuctionItem(entry)) index.set(entry.id, entry);
    return index;
  } catch {
    return null;
  }
}

function loadRegion(key: string): Promise<Map<string, AuctionItem> | null> {
  const cached = regionCache.get(key);
  if (cached !== undefined) return cached;
  const pending = readRegion(key);
  regionCache.set(key, pending);
  void pending.then((index) => {
    if (index === null) regionCache.delete(key); // 일시적 실패를 이 문서 내내 물고 가지 않는다
  });
  return pending;
}

/**
 * 최근 본 물건을 산출물에서 찾는다 — 관심함 저장에는 스냅샷(최저가·기일·유찰 수)이 필요하다.
 * id 접두가 지역 키("{regionKey}-…")라 최근 목록이 가리키는 지역 파일만 읽는다(data-server.findItem과 같은 규약).
 */
async function resolveRecent(): Promise<AuctionItem[]> {
  const keys = [...new Set(getRecentIds().map((id) => id.split("-")[0]))].filter((key) =>
    REGIONS.some((r) => r.key === key),
  );
  const loaded = await Promise.all(keys.map(loadRegion));
  const byRegion = new Map(keys.map((key, i) => [key, loaded[i]]));
  return presentRecent((id) => byRegion.get(id.split("-")[0])?.get(id));
}

export function ExitGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<AuctionItem[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const armedRef = useRef(false);
  const bypassRef = useRef(false);
  const leavingRef = useRef(false);
  const pathRef = useRef(pathname);
  const navPathRef = useRef<string | null>(null);
  const poppedPathRef = useRef<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // 이력 칸 수 갱신(감사 3차 97) — 앱이 만든 push만 센다.
  // 최초 진입은 이동이 아니고, 뒤로가기로 바뀐 경로는 popstate 핸들러가 이미 깎았으므로 다시 세지 않는다
  // (이중 계상하면 칸 수가 0으로 내려오지 못해 이탈 판정이 영영 성립하지 않는다).
  useEffect(() => {
    pathRef.current = pathname;
    leavingRef.current = false; // 이동이 끝났다 — 다음 손실 시나리오에서는 다시 무장한다
    if (navPathRef.current === null || navPathRef.current === pathname) {
      navPathRef.current = pathname;
      return;
    }
    const popped = poppedPathRef.current !== null && samePath(poppedPathRef.current, pathname);
    poppedPathRef.current = null;
    navPathRef.current = pathname;
    if (!popped) markAppNavigated();
  }, [pathname]);

  // 가드 무장 — 손실 시나리오에서만, 시트가 닫혀 있고 이탈·이동 확정 전일 때만 건다.
  // 산출물 조회는 값싼 사전 판정(최근 기록 있음 + 관심함 0건)을 통과한 방문자에게만 한다.
  useEffect(() => {
    if (open || bypassRef.current || leavingRef.current) return;
    if (!stillAtLoss()) return;
    let live = true;
    let sentinel: number | undefined;
    let stopUnloadGuard = () => {};

    void resolveRecent().then((items) => {
      if (!live || items.length === 0) return; // 산출물에 남은 것이 없으면 잃을 것도 없다(감사 3차 99)
      setRecent(items);

      const onBeforeUnload = (e: BeforeUnloadEvent) => {
        if (!stillAtLoss()) return; // 등록 뒤 관심함에 저장했으면 확인창을 띄우지 않는다
        e.preventDefault();
        e.returnValue = ""; // 일부 브라우저는 이 값이 있어야 종료 확인창을 띄운다
      };
      window.addEventListener("beforeunload", onBeforeUnload);
      stopUnloadGuard = () => window.removeEventListener("beforeunload", onBeforeUnload);

      if (pathname !== "/") return;
      // 센티넬은 홈에서만, 그것도 앱 진입 칸에서만 쌓는다(감사 3차 97).
      // 기존 state를 반드시 보존한다 — 통째로 교체하면 Next app-router의 `__NA` 마커가 사라지고,
      // popstate에서 마커가 없으면 라우터가 window.location.reload()로 떨어져 뒤로가기가
      // SPA 복원이 아니라 문서 전체 재로드가 된다(감사 3차: 복원 275ms vs 정상 58ms · 페이지 상태 소멸).
      // 쌓는 시점은 같은 마운트의 다른 이펙트가 끝난 뒤다 — 홈 복원(page.tsx commit)이 셸로우
      // replaceState로 라우터 state를 새로 쓰므로, 그보다 먼저 push하면 우리가 보존한 마커가 곧바로
      // 덮인다. 한 틱 미뤄 라우터가 마커를 붙인 state 위에 센티넬을 얹는다.
      sentinel = window.setTimeout(() => {
        const state = (window.history.state ?? {}) as Record<string, unknown>;
        const plan = planSentinel({
          onSentinel: state.cvExitGuard === true,
          depth: appHistoryDepth(),
        });
        if (plan === "skip") return;
        if (plan === "push") {
          window.history.pushState({ ...state, cvExitGuard: true }, "", window.location.href);
          markAppNavigated(); // 센티넬도 앱이 만든 칸이다 — 소진되면 다음 뒤로가기가 앱 밖이다
        }
        armedRef.current = true;
      }, 0);
    });

    return () => {
      live = false;
      stopUnloadGuard();
      if (sentinel !== undefined) window.clearTimeout(sentinel);
      armedRef.current = false;
    };
  }, [open, pathname]);

  // 뒤로가기 가로채기는 앱 밖으로 나가는 1회뿐 — 앱 안으로 돌아가는 뒤로가기는 그대로 통과시킨다.
  useEffect(() => {
    const onPopState = () => {
      poppedPathRef.current = window.location.pathname;
      markAppPopped();
      const exiting = isExitBack({
        armed: armedRef.current,
        depth: appHistoryDepth(),
        from: pathRef.current,
        to: window.location.pathname,
      });
      if (!exiting) return;
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
  // 대상은 무장할 때 산출물에서 찾아 둔 물건이다 — 목록에만 남은 id로 보내면 상세가 404다(감사 3차 J7-I).
  // 이동 확정 전에 leavingRef를 세운다 — 세우지 않으면 setOpen(false)가 무장 effect를 재실행하고,
  // 그 센티넬 pushState가 진행 중이던 router.push를 취소해 버튼이 무동작이 된다(감사 3차 J7-K A/B).
  const save = () => {
    const item = recent[0];
    if (item === undefined) return;
    setSaveError(null);
    if (!isWatched(item.id) && !toggleWatch(item).saved) {
      setSaveError("이 기기에 저장하지 못했다 — 저장 공간을 확보한 뒤 다시 누르라.");
      return;
    }
    leavingRef.current = true;
    router.push(`/item/${item.id}`);
    setOpen(false);
  };

  // 이탈 확정: 가드를 끄고 실제로 뒤로 보낸다(확인 뒤에는 다시 가로채지 않는다).
  // 시트는 앱 진입 칸에서만 열리므로 한 칸 뒤가 곧 앱 밖이다.
  const leave = () => {
    bypassRef.current = true;
    setOpen(false);
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
            className="min-h-12 flex-1 cursor-pointer rounded-xl bg-accent font-semibold text-white transition-colors duration-200 hover:bg-accent/90"
          >
            가장 최근 물건 저장
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
