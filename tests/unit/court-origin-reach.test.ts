import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as jsxRuntime from "react/jsx-runtime";
import * as format from "@/lib/format";
import { findItem, loadAllItems } from "@/lib/data-server";
import type { AuctionItem } from "@/types/auction";
import { createReactStub, find, loadModule, makeStub, textOf } from "./react-harness";

// 법원 원문 도달 3종 회귀(AGENTS §2-2 조문 6 · 감사 3차 J4).
// 3종이 "존재하는가"가 아니라 **마지막 한 걸음까지 이어지는가**를 잰다.
//   ① 안내가 지목하는 법원명이 그 블록 안에 있는가 — 헤더에만 있으면 복사 시점에 화면 밖이라
//      방문자가 법원명을 확인하러 위로 되돌아가야 한다(실측 828px).
//   ② 클립보드가 막힌 기기에서 실제 복구 수단(사건번호 문단)이 통지되는가 — 통지가 없으면
//      화면을 못 보는 방문자는 "복사 실패"만 듣고 끝난다.
// 상세는 서버 컴포넌트(async)라 렌더 결과를 그대로 await 해 엘리먼트 트리로 판정한다.

const CopyCaseNoStub = makeStub();

interface ItemPageModule {
  default: (props: { params: Promise<{ id: string }> }) => Promise<unknown>;
}

const page = loadModule<ItemPageModule>("src/app/item/[id]/page.tsx", {
  "react/jsx-runtime": jsxRuntime,
  "next/navigation": {
    notFound: () => {
      throw new Error("notFound()가 불렸다 — 픽스처 물건을 찾지 못했다");
    },
  },
  "lucide-react": { ExternalLink: makeStub(), MapPin: makeStub() },
  "@/lib/data-server": { findItem, loadAllItems },
  "@/lib/format": format,
  "@/components/PriceStructure": { PriceStructure: makeStub() },
  "@/components/HistoryTimeline": { HistoryTimeline: makeStub() },
  "@/components/WatchToggle": { WatchToggle: makeStub() },
  "@/components/ShareButton": { ShareButton: makeStub() },
  "@/components/CopyCaseNo": { CopyCaseNo: CopyCaseNoStub },
  "@/components/LegalNotice": { LegalNotice: makeStub() },
  "@/components/CategoryThumb": { CategoryThumb: makeStub() },
  "./RecentTracker": { BackButton: makeStub(), RecentTracker: makeStub() },
});

describe("상세 — 법원 원문 도달 3종이 한 블록에서 완결된다", () => {
  let item: AuctionItem;
  let section: { type: unknown; props: Record<string, unknown> };

  beforeAll(async () => {
    // 픽스처는 산출물에서 고른다 — 특정 지역·id를 박으면 그 지역이 0건이 되는 주에 통째로 깨진다.
    const items = await loadAllItems();
    expect(items.length, "전제: public/data에 물건이 있다").toBeGreaterThan(0);
    item = items[0];
    const tree = await page.default({ params: Promise.resolve({ id: item.id }) });
    const found = find(
      tree,
      (el) => el.type === "section" && el.props["aria-label"] === "법원 원문 확인",
    );
    expect(found, "법원 원문 확인 섹션").not.toBeNull();
    section = found!;
  });

  it("① 사건상세 화면 링크 — 새 창 규격 그대로", () => {
    const link = find(section, (el) => el.type === "a");
    expect(link).not.toBeNull();
    expect(link!.props.href).toBe(item.detailUrl);
    expect(link!.props.target).toBe("_blank");
    expect(String(link!.props.rel)).toContain("noopener");
  });

  it("② 사건번호 복사 — 복사 문자열은 사건번호 단독(법원명 미포함)", () => {
    const copy = find(section, (el) => el.type === CopyCaseNoStub);
    expect(copy).not.toBeNull();
    // 법원은 원문 화면에서 목록으로 고르는 값이라 함께 붙이면 입력칸을 오염시킨다(확정 사양).
    expect(copy!.props).toEqual({ caseNo: item.caseNo });
    expect(String(copy!.props.caseNo)).not.toContain(item.court);
  });

  it("③ 찾는 방법 안내가 법원을 지목한다 — 헤더로 되돌아가지 않는다", () => {
    const howto = find(section, (el) => el.type === "p");
    expect(howto).not.toBeNull();
    const text = textOf(howto).replace(/\s+/g, " ").trim();
    // 안내가 "법원 선택"을 지시하면서 어느 법원인지는 말하지 않는 상태가 결함이었다.
    expect(text, `안내 문구: ${text}`).toContain(item.court);
    expect(textOf(section)).toContain(item.court);
    // 세로 리듬 — 안내는 1문장 단정형(게이트 R12와 같은 종결부호 계수).
    expect((text.match(/[가-힣)\]][.?]/g) ?? []).length).toBe(1);
    expect(text).not.toMatch(/습니다|하세요|해 주세요/);
  });
});

describe("사건번호 복사 — 클립보드가 막힌 기기의 복구 경로", () => {
  const caseNo = "2024타경12345";

  interface CopyModule {
    CopyCaseNo: (props: { caseNo: string }) => unknown;
  }

  /** 클립보드 결과를 지정해 컴포넌트를 마운트하고, 버튼을 눌러 그 다음 렌더를 돌려준다. */
  async function clickCopy(writeText: () => Promise<void>) {
    const stub = createReactStub();
    const mod = loadModule<CopyModule>("src/components/CopyCaseNo.tsx", {
      react: stub.react,
      "react/jsx-runtime": jsxRuntime,
      "lucide-react": { Copy: makeStub() },
    });
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText } },
      configurable: true,
      writable: true,
    });
    const mounted = stub.mount(() => mod.CopyCaseNo({ caseNo }));
    const button = find(mounted.render(), (el) => el.type === "button");
    expect(button, "복사 버튼").not.toBeNull();
    await (button!.props.onClick as () => Promise<void>)();
    return mounted;
  }

  const deny = () => {
    const err = new Error("Write permission denied.");
    err.name = "NotAllowedError";
    return Promise.reject(err);
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it("실패 폴백 문단이 role=alert로 통지된다 — 사건번호까지 실린다", async () => {
    const mounted = await clickCopy(deny);
    const tree = mounted.render();
    const fallback = find(tree, (el) => el.type === "p");
    expect(fallback, "폴백 문단").not.toBeNull();
    const live = fallback!.props.role ?? fallback!.props["aria-live"];
    expect(live, "폴백 문단의 role/aria-live").toBeTruthy();
    expect(String(live)).toMatch(/alert|assertive|polite/);
    expect(textOf(fallback)).toContain(caseNo);
    mounted.unmount();
  });

  it("실패 라벨은 2초 뒤에도 유지된다 — 폴백과 두 상태를 말하지 않는다", async () => {
    vi.useFakeTimers();
    const mounted = await clickCopy(deny);
    expect(textOf(find(mounted.render(), (el) => el.type === "button")).trim()).toBe("복사 실패");
    vi.advanceTimersByTime(3000);
    const tree = mounted.render();
    // 라벨이 idle로 돌아가면 화면은 "사건번호 복사"와 실패 폴백을 동시에 말한다.
    expect(textOf(find(tree, (el) => el.type === "button")).trim()).toBe("복사 실패");
    expect(find(tree, (el) => el.type === "p"), "폴백 문단 잔존").not.toBeNull();
    mounted.unmount();
  });

  it("성공 라벨은 2초 뒤 복귀한다 — 폴백도 뜨지 않는다", async () => {
    vi.useFakeTimers();
    const mounted = await clickCopy(() => Promise.resolve());
    expect(textOf(find(mounted.render(), (el) => el.type === "button")).trim()).toBe("복사됨");
    expect(find(mounted.render(), (el) => el.type === "p")).toBeNull();
    vi.advanceTimersByTime(2000);
    expect(textOf(find(mounted.render(), (el) => el.type === "button")).trim()).toBe("사건번호 복사");
    mounted.unmount();
  });
});
