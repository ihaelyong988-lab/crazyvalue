import { afterEach, describe, expect, it, vi } from "vitest";
import * as jsxRuntime from "react/jsx-runtime";
import { SORT_OPTIONS } from "@/lib/data";
import { LIST_COUNT_MAX } from "@/lib/query";
import {
  createReactStub,
  find,
  loadModule,
  makeStub,
  propsOf,
  textOf,
  type Element,
} from "./react-harness";

// 리스트 표시 건수 상한(감사 3차) — 정제는 500으로 깎는데 버튼은 총 건수만 보던 탓에,
// 500에 닿은 뒤의 "더보기 (500/1000)"는 눌러도 카드도 문구도 그대로였다(무반응 = 앱이 멈춘 것으로 읽힘).
// 상한은 query.ts가 소유하고 노출 조건이 그 값을 읽는지, 상한에서 다음 수단을 안내하는지를 고정한다.
//
// .tsx는 vitest의 vite 파이프라인이 파싱하지 못한다(tsconfig `jsx: "preserve"`) —
// react-harness가 esbuild로 직접 컴파일해 싣는다(onboarding-exit.test.ts와 같은 경로).

interface ListProps {
  items: { id: string }[];
  shown: number;
  sort: string;
  onSortChange: (s: string) => void;
  onMore: () => void;
  relaxActions: { label: string; onClick: () => void }[];
}

/** 트리 전주회 — 조건에 맞는 엘리먼트 전량(react-harness의 find는 첫 건만 준다). */
function collect(node: unknown, hit: (el: Element) => boolean, out: Element[] = []): Element[] {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, hit, out);
    return out;
  }
  if (typeof node !== "object" || node === null || !("props" in node) || !("type" in node))
    return out;
  const el = node as Element;
  if (hit(el)) out.push(el);
  return collect(el.props.children, hit, out);
}

const moreButton = (tree: unknown) =>
  find(tree, (el) => el.type === "button" && textOf(el).includes("더보기"));
/** 상한 안내 — 버튼이 사라진 자리의 변화를 공지하는 status 영역. */
const capNotice = (tree: unknown) => find(tree, (el) => el.props.role === "status");
/** 포인터 차단이 걸린 카드 수(더보기 직후 오적중 방지 가드의 잔존 여부). */
const blockedCards = (tree: unknown) =>
  collect(tree, (el) => el.type === "li" && String(el.props.className ?? "").includes("pointer-events-none")).length;

const mkItems = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id-${i}` }));

/** 매 테스트가 자기 모듈 인스턴스를 쓴다 — 훅 셀·모듈 스코프가 섞이지 않게. */
function mountList(initial: Partial<ListProps> = {}) {
  const stub = createReactStub();
  const ItemCard = makeStub();
  const EmptyState = makeStub();
  const { ItemList } = loadModule<{ ItemList: (p: ListProps) => unknown }>(
    "src/components/ItemList.tsx",
    {
      react: stub.react,
      "react/jsx-runtime": jsxRuntime,
      "@/lib/data": { SORT_OPTIONS },
      "@/lib/query": { LIST_COUNT_MAX },
      "@/components/ItemCard": { ItemCard },
      "@/components/EmptyState": { EmptyState },
    },
  );
  let props: ListProps = {
    items: mkItems(1_000),
    shown: 10,
    sort: "date",
    onSortChange: () => {},
    onMore: () => {},
    relaxActions: [],
    ...initial,
  };
  const mounted = stub.mount(() => ItemList(props));
  return {
    EmptyState,
    /** 부모 재렌더 — patch로 바뀐 props만 갈아끼운다. */
    render(patch: Partial<ListProps> = {}) {
      props = { ...props, ...patch };
      return mounted.render();
    },
    unmount: mounted.unmount,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ItemList 더보기 — 표시 건수 상한(감사 3차)", () => {
  it("상한 미만에서는 더보기가 그대로 뜬다(진행 표기 포함)", () => {
    const tree = mountList({ shown: 10 }).render();
    const button = moreButton(tree);
    expect(button).not.toBeNull();
    expect(textOf(button)).toContain("(10/1000)");
    expect(capNotice(tree)).toBeNull();
  });

  it("상한 직전(490)까지는 더보기가 살아 있다", () => {
    const tree = mountList({ shown: LIST_COUNT_MAX - 10 }).render();
    expect(moreButton(tree)).not.toBeNull();
    expect(capNotice(tree)).toBeNull();
  });

  it("상한에 닿으면 더보기가 사라지고 좁히는 방법을 안내한다", () => {
    const tree = mountList({ shown: LIST_COUNT_MAX }).render();
    expect(moreButton(tree)).toBeNull();

    const notice = capNotice(tree);
    expect(notice).not.toBeNull();
    const text = textOf(notice);
    // 상한 값은 query.ts 상수에서 온다 — 문구에 숫자를 따로 적어두면 상수와 어긋난다.
    expect(text).toContain(LIST_COUNT_MAX.toLocaleString("ko-KR"));
    expect(text).toMatch(/필터/);
    expect(text).toMatch(/정렬/);
  });

  it("상한을 넘겨 들어와도(URL 조작) 더보기를 되살리지 않는다", () => {
    const tree = mountList({ shown: LIST_COUNT_MAX + 50 }).render();
    expect(moreButton(tree)).toBeNull();
    expect(capNotice(tree)).not.toBeNull();
  });

  it("전량을 이미 보여주면 버튼도 상한 안내도 두지 않는다", () => {
    const all = mountList({ items: mkItems(20), shown: 20 }).render();
    expect(moreButton(all)).toBeNull();
    expect(capNotice(all)).toBeNull();

    // 상한 = 총 건수인 경계: 남은 것이 없으므로 안내도 없다.
    const exact = mountList({ items: mkItems(LIST_COUNT_MAX), shown: LIST_COUNT_MAX }).render();
    expect(moreButton(exact)).toBeNull();
    expect(capNotice(exact)).toBeNull();
  });
});

describe("ItemList 삽입 가드 — 해제 타이머(감사 3차 부수)", () => {
  it("표시 건수가 늘지 않은 클릭에서도 가드가 해제된다", () => {
    vi.useFakeTimers();
    const list = mountList({ items: mkItems(1_000), shown: 10 });
    const tree = list.render();

    // 더보기 클릭 — 이 시점의 표시 건수부터 포인터 차단이 걸린다.
    (moreButton(tree)?.props.onClick as () => void)();
    // 표시 건수가 아직 늘지 않은 상태로 재렌더(URL 갱신 지연·되감기 경합).
    list.render();
    vi.advanceTimersByTime(1_000);

    // 뒤늦게 삽입이 도착해도 차단이 남아 있으면 안 된다 — 남으면 새 카드가 탭에 무반응이다.
    const late = list.render({ shown: 30 });
    expect(blockedCards(late)).toBe(0);
    list.unmount();
  });

  it("더보기 직후 삽입분은 잠깐 차단되고 시간이 지나면 풀린다", () => {
    vi.useFakeTimers();
    const list = mountList({ items: mkItems(1_000), shown: 10 });
    const tree = list.render();

    (moreButton(tree)?.props.onClick as () => void)();
    expect(blockedCards(list.render({ shown: 20 }))).toBe(10); // 삽입분 10건만 차단

    vi.advanceTimersByTime(1_000);
    expect(blockedCards(list.render())).toBe(0);
    list.unmount();
  });
});

describe("ItemList 빈 결과 문구 — 단정형(앱 기준 문체)", () => {
  const POLITE = /(습니다|합니다|됩니다|입니다|하세요|십시오)/;

  it("완화 수단이 있으면 해제 안내를 단정형 1문장으로 준다", () => {
    const list = mountList({ items: [], relaxActions: [{ label: "금액 범위 넓히기", onClick: () => {} }] });
    const props = propsOf(list.render(), list.EmptyState);
    const text = `${String(props.title)} ${String(props.description ?? "")}`;
    expect(props.title).toMatch(/^조건에 맞는/);
    expect(text).not.toMatch(POLITE);
    // 1문장 압축(세로 리듬) — 종결 마침표는 하나뿐이다.
    expect(String(props.description).match(/[가-힣)\]][.?]/g)?.length ?? 0).toBe(1);
  });

  it("완화 수단이 없으면 갱신 주기·시각을 말하지 않는다", () => {
    const list = mountList({ items: [], relaxActions: [] });
    const props = propsOf(list.render(), list.EmptyState);
    const text = `${String(props.title)} ${String(props.description ?? "")}`;
    expect(text).not.toMatch(POLITE);
    // 슬롯이 바뀌면 앱이 거짓을 말한다 — 하드코딩된 시각·주기는 문구에 두지 않는다.
    expect(text).not.toMatch(/\d{1,2}:\d{2}|매일|갱신/);
  });
});
