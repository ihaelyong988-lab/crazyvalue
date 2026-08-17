import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

// 클라이언트 컴포넌트를 node에서 실측하기 위한 최소 하네스.
// .tsx는 vitest의 vite 파이프라인이 파싱하지 못한다(tsconfig `jsx: "preserve"` — Next 전제, vitest.config는
// 이 작업의 소유 파일이 아니다). onboarding-exit.test.ts와 같이 esbuild로 직접 컴파일해 싣는다.
//
// 훅은 최소 구현으로 갈아끼워 **이펙트를 그 자리에서 돌린다** — 검증 대상이 "마운트 1회 복원"이라
// 렌더 → 이펙트 → 재렌더로 결과 읽기가 실제 순서 그대로 재현돼야 한다.
// renderToStaticMarkup은 이펙트를 돌리지 않으므로 이 경로로는 복원 결함을 잡을 수 없다.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

/** 저장소 셧 — length·key(i)까지 갖춰야 resetAll의 키 열거를 실제와 같은 계약으로 흉내낼 수 있다. */
export interface StorageShim {
  map: Map<string, string>;
  /** true면 removeItem이 던진다 — 삭제가 막힌 기기 모사. */
  blockRemove: boolean;
  /** true면 setItem이 던진다 — 용량 초과·프라이빗 모드 모사. */
  blockWrite: boolean;
}

export interface TestWindow {
  local: StorageShim;
  session: StorageShim;
  /** 주소창 조작 — 뒤로가기로 되살아난 히스토리 스냅샷을 모사한다. */
  setUrl(search: string): void;
  /** 현재 주소창 쿼리(코드가 replaceState로 바꾼 결과 포함). */
  url(): string;
  /** 타 탭 저장 통지. */
  fireStorage(key: string | null): void;
}

function storage(shim: StorageShim): Storage {
  return {
    get length() {
      return shim.map.size;
    },
    key: (i: number) => [...shim.map.keys()][i] ?? null,
    getItem: (k: string) => shim.map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (shim.blockWrite) throw new Error("QuotaExceededError");
      shim.map.set(k, v);
    },
    removeItem: (k: string) => {
      if (shim.blockRemove) throw new Error("SecurityError");
      shim.map.delete(k);
    },
    clear: () => shim.map.clear(),
  } as Storage;
}

/** node 전역에 window를 세운다. watchlist·query는 localStorage·sessionStorage·location·history만 쓴다. */
export function installWindow(search = ""): TestWindow {
  const local: StorageShim = { map: new Map(), blockRemove: false, blockWrite: false };
  const session: StorageShim = { map: new Map(), blockRemove: false, blockWrite: false };
  const listeners = new Set<(e: StorageEvent) => void>();
  const location = { pathname: "/", search };
  const win = {
    localStorage: storage(local),
    sessionStorage: storage(session),
    location,
    history: {
      replaceState: (_s: unknown, _t: string, url: string) => {
        const q = url.indexOf("?");
        location.pathname = q === -1 ? url : url.slice(0, q);
        location.search = q === -1 ? "" : url.slice(q);
      },
    },
    addEventListener: (type: string, fn: (e: StorageEvent) => void) => {
      if (type === "storage") listeners.add(fn);
    },
    removeEventListener: (type: string, fn: (e: StorageEvent) => void) => {
      if (type === "storage") listeners.delete(fn);
    },
  };
  (globalThis as unknown as { window: unknown }).window = win;
  return {
    local,
    session,
    setUrl: (next: string) => {
      location.search = next;
    },
    url: () => location.search,
    fireStorage: (key: string | null) => {
      for (const fn of [...listeners]) fn({ key } as unknown as StorageEvent);
    },
  };
}

// ---- 훅 셧 ----

interface Cell {
  v?: unknown;
  current?: unknown;
  deps?: unknown[];
  cleanup?: () => void;
}

interface MountState {
  cells: Cell[];
  idx: number;
  queue: (() => void)[];
}

export interface Mounted<T> {
  /** 렌더 1회 + 이번 렌더에서 예약된 이펙트 실행. 반환값은 엘리먼트 트리. */
  render(): T;
  /** 언마운트 — 이펙트 정리 함수 실행(구독 해제). */
  unmount(): void;
}

export interface ReactStub {
  react: Record<string, unknown>;
  mount<T>(fn: () => T): Mounted<T>;
}

export function createReactStub(): ReactStub {
  let active: MountState | null = null;
  const cell = (): Cell => {
    const state = active;
    if (state === null) throw new Error("훅이 mount 밖에서 불렸다");
    state.cells[state.idx] ??= {};
    return state.cells[state.idx++];
  };

  const react = {
    useState<T>(init: T | (() => T)) {
      const c = cell();
      if (!("v" in c)) c.v = typeof init === "function" ? (init as () => T)() : init;
      const set = (next: T | ((prev: T) => T)) => {
        c.v = typeof next === "function" ? (next as (prev: T) => T)(c.v as T) : next;
      };
      return [c.v as T, set] as const;
    },
    useRef<T>(init: T) {
      const c = cell();
      if (!("current" in c)) c.current = init;
      return c as { current: T };
    },
    useEffect(fn: () => void | (() => void), deps?: unknown[]) {
      const c = cell();
      const prev = c.deps;
      const changed =
        deps === undefined ||
        prev === undefined ||
        prev.length !== deps.length ||
        deps.some((d, i) => !Object.is(d, prev[i]));
      c.deps = deps;
      if (!changed) return;
      active?.queue.push(() => {
        c.cleanup?.();
        const ret = fn();
        c.cleanup = typeof ret === "function" ? ret : undefined;
      });
    },
    useMemo<T>(fn: () => T) {
      cell();
      return fn();
    },
    useCallback<T>(fn: T) {
      cell();
      return fn;
    },
  };

  return {
    react,
    mount<T>(fn: () => T): Mounted<T> {
      const state: MountState = { cells: [], idx: 0, queue: [] };
      return {
        render() {
          const prev = active;
          active = state;
          state.idx = 0;
          state.queue = [];
          try {
            const out = fn();
            for (const job of state.queue) job();
            return out;
          } finally {
            active = prev;
          }
        },
        unmount() {
          for (const c of state.cells) c.cleanup?.();
        },
      };
    },
  };
}

// ---- 모듈 로더 ----

/**
 * .tsx 모듈을 컴파일해 싣는다. 팩토리를 매번 새로 실행하면 모듈 스코프가 초기화된다 = 새 문서(새 탭).
 * 같은 모듈 인스턴스를 다시 마운트하면 = 같은 문서의 재마운트(뒤로가기·하단탭 이동).
 */
export function loadModule<T>(relPath: string, stubs: Record<string, unknown>): T {
  const code = transformSync(readFileSync(path.resolve(ROOT, relPath), "utf8"), {
    loader: "tsx",
    format: "cjs",
    jsx: "automatic",
    target: "es2020",
  }).code;
  const factory = new Function("require", "module", "exports", code) as (
    req: (id: string) => unknown,
    mod: { exports: unknown },
    exp: unknown,
  ) => void;
  const mod = { exports: {} };
  factory(
    (id) => {
      if (!(id in stubs)) throw new Error(`예상하지 못한 import: ${id}`);
      return stubs[id];
    },
    mod,
    mod.exports,
  );
  return mod.exports as T;
}

/**
 * 자식 컴포넌트 자리표시. 호출마다 **다른 함수**를 돌려준다 —
 * 정체성이 겹치면 트리 조회가 엉뚱한 자식의 props를 집는다(첫 작성에서 실제로 그랬다).
 */
export const makeStub = (): (() => null) => () => null;

// ---- 엘리먼트 트리 조회 ----

export interface Element {
  type: unknown;
  props: Record<string, unknown>;
}

const isElement = (node: unknown): node is Element =>
  typeof node === "object" && node !== null && "props" in node && "type" in node;

/** 트리 선주회 — 조건에 맞는 첫 엘리먼트. */
export function find(node: unknown, hit: (el: Element) => boolean): Element | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, hit);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isElement(node)) return null;
  if (hit(node)) return node;
  return find(node.props.children, hit);
}

/** 지정 타입(자리표시 컴포넌트·태그명)의 첫 엘리먼트 props. */
export function propsOf(node: unknown, type: unknown): Record<string, unknown> {
  const found = find(node, (el) => el.type === type);
  if (found === null) throw new Error("트리에서 찾지 못했다");
  return found.props;
}

/** 엘리먼트가 그리는 문자열 전량 — 화면에 뜨는 글자를 그대로 잇는다. */
export function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isElement(node)) return textOf(node.props.children);
  return "";
}

/** 라벨이 붙은 버튼을 눌러 onClick을 실행한다. */
export function click(tree: unknown, label: string): void {
  const button = find(tree, (el) => el.type === "button" && textOf(el).trim() === label);
  if (button === null) throw new Error(`버튼을 찾지 못했다: ${label}`);
  (button.props.onClick as () => void)();
}
