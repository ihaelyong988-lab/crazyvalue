import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as jsxRuntime from "react/jsx-runtime";
import * as format from "@/lib/format";
import { findItem, loadAllItems } from "@/lib/data-server";
import {
  COURT_ORIGIN_URL,
  copyableCaseNo,
  siteCourtLabel,
  splitCaseNo,
} from "@/lib/court-origin";
import type { AuctionItem } from "@/types/auction";
import { createReactStub, find, loadModule, makeStub, textOf } from "./react-harness";
import { COURT_SELECT_OPTIONS } from "@/lib/court-select-options";

// 법원 원문 도달 3종 회귀(AGENTS §2-2 조문 6 · 감사 3차 J4).
// 3종이 "존재하는가"가 아니라 **마지막 한 걸음까지 이어지는가**를 잰다.
//   ① 안내가 지목하는 법원명이 그 블록 안에 있는가 — 헤더에만 있으면 복사 시점에 화면 밖이라
//      방문자가 법원명을 확인하러 위로 되돌아가야 한다(실측 828px).
//   ② 클립보드가 막힌 기기에서 실제 복구 수단(번호 문단)이 통지되는가 — 통지가 없으면
//      화면을 못 보는 방문자는 "복사 실패"만 듣고 끝난다.
// 상세는 서버 컴포넌트(async)라 렌더 결과를 그대로 await 해 엘리먼트 트리로 판정한다.
//
// 2026-08-20 개정 — 이 파일의 옛 단언은 `href === item.detailUrl`이었다. **자기 자신과의 대조라**
// 목적지가 오류창을 띄우는 동안에도 초록이었다(1,000건 전량 도달 0%). 그래서 판정값을 목적지 계약으로 바꾼다:
//   · 링크는 단독 진입이 되는 최상단 화면(`…F00`/`…M00`)이어야 한다 — 자식 화면(`…F01`)은 부모 없이 못 뜬다.
//   · 복사값은 목적지 입력칸 규격(숫자 · 7자 이내)을 데이터 전건에서 통과해야 한다.
//   · 안내가 지목하는 법원 표기는 실제 선택 목록(스냅샷 60종)에 있어야 한다.
// 목적지가 진짜 열리는지는 네트워크가 필요하므로 라이브 게이트가 따로 잰다.

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
  "@/lib/court-origin": { COURT_ORIGIN_URL, siteCourtLabel, splitCaseNo },
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

  it("① 원문 화면 링크 — 단독 진입이 되는 최상단 화면이다", () => {
    const link = find(section, (el) => el.type === "a");
    expect(link).not.toBeNull();
    expect(link!.props.href).toBe(COURT_ORIGIN_URL);
    expect(link!.props.target).toBe("_blank");
    expect(String(link!.props.rel)).toContain("noopener");
    // `…F01`/`…M01`은 부모가 사건 파라미터를 넣어 줘야 뜨는 자식 화면이다 — 단독 진입 시 오류창이 뜬다.
    const screen = new URL(COURT_ORIGIN_URL).searchParams.get("w2xPath") ?? "";
    expect(screen, `w2xPath=${screen}`).toMatch(/PGJ\w{3}(F|M)00\.xml$/);
  });

  it("② 번호 복사 — 목적지 입력칸 규격(숫자·7자 이내)을 통과한다", () => {
    const copy = find(section, (el) => el.type === CopyCaseNoStub);
    expect(copy).not.toBeNull();
    // 법원·연도는 원문 화면에서 목록으로 고르는 값이라 함께 붙이면 입력칸을 오염시킨다(확정 사양).
    expect(copy!.props).toEqual({ caseNo: item.caseNo });
    const value = copyableCaseNo(item.caseNo);
    expect(value).toMatch(/^\d{1,7}$/);
    expect(value).not.toContain("타경");
  });

  it("③ 찾는 방법 안내가 선택 목록에 있는 법원 표기를 지목한다", () => {
    const howto = find(section, (el) => el.type === "p");
    expect(howto).not.toBeNull();
    const text = textOf(howto).replace(/\s+/g, " ").trim();
    const label = siteCourtLabel(item.court);
    // 안내가 목록에 없는 이름을 지목하면 방문자는 60개 목록을 훑는다.
    expect(COURT_SELECT_OPTIONS, `법원 표기: ${label}`).toContain(label);
    expect(text, `안내 문구: ${text}`).toContain(label);
    // 폼은 연도와 번호를 따로 받는다 — 연도를 말하지 않으면 방문자가 사건번호에서 잘라내야 한다.
    expect(text).toContain(splitCaseNo(item.caseNo)!.year);
    // 세로 리듬 — 안내는 1문장 단정형(게이트 R12와 같은 종결부호 계수).
    expect((text.match(/[가-힣)\]][.?]/g) ?? []).length).toBe(1);
    expect(text).not.toMatch(/습니다|하세요|해 주세요/);
  });
});

describe("법원 원문 도달 — 산출물 전건이 목적지 계약을 만족한다", () => {
  it("법원 표기 전건이 선택 목록에 있다", async () => {
    const items = await loadAllItems();
    expect(items.length, "전제: public/data에 물건이 있다").toBeGreaterThan(0);
    const options = new Set(COURT_SELECT_OPTIONS);
    const missing = [...new Set(items.map((i) => siteCourtLabel(i.court)))].filter(
      (label) => !options.has(label),
    );
    expect(missing, `선택 목록에 없는 법원 표기 ${missing.length}종`).toEqual([]);
  });

  it("지역을 가정한 표기(`동부지원`)가 그 지역 밖에 나타나지 않는다", async () => {
    // `동부지원`은 본원 없는 폴백 표기라 정규화가 "부산"을 가정한다(court-origin.ts).
    // 서울동부·부산동부가 모두 존재하므로, 가정이 깨지면 안내가 **틀린 법원**을 지목한다.
    // 조용히 틀리지 않게 여기서 막는다 — 근본 처방은 백로그 118(법원명 원천 교체)이다.
    const items = await loadAllItems();
    const stray = items.filter((i) => i.court === "동부지원" && i.region !== "부산");
    expect(
      stray.map((i) => `${i.id}(${i.region})`),
      "부산 밖에서 나온 `동부지원` — 정규화 가정이 깨졌다",
    ).toEqual([]);
  });

  it("복사값 전건이 번호 입력칸 규격을 통과한다", async () => {
    const items = await loadAllItems();
    const bad = items
      .map((i) => ({ caseNo: i.caseNo, value: copyableCaseNo(i.caseNo) }))
      .filter((r) => !/^\d{1,7}$/.test(r.value));
    expect(bad.slice(0, 5), `규격 밖 ${bad.length}건`).toEqual([]);
  });
});

describe("번호 복사 — 클립보드가 막힌 기기의 복구 경로", () => {
  const caseNo = "2024타경12345";
  const number = "12345"; // 복사·폴백에 실리는 값(목적지 입력칸이 받는 형태)

  interface CopyModule {
    CopyCaseNo: (props: { caseNo: string }) => unknown;
  }

  /** 클립보드 결과를 지정해 컴포넌트를 마운트하고, 버튼을 눌러 그 다음 렌더를 돌려준다. */
  async function clickCopy(writeText: (text: string) => Promise<void>) {
    const stub = createReactStub();
    const mod = loadModule<CopyModule>("src/components/CopyCaseNo.tsx", {
      react: stub.react,
      "react/jsx-runtime": jsxRuntime,
      "lucide-react": { Copy: makeStub() },
      "@/lib/court-origin": { copyableCaseNo },
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

  it("실패 폴백 문단이 role=alert로 통지된다 — 번호까지 실린다", async () => {
    const mounted = await clickCopy(deny);
    const tree = mounted.render();
    const fallback = find(tree, (el) => el.type === "p");
    expect(fallback, "폴백 문단").not.toBeNull();
    const live = fallback!.props.role ?? fallback!.props["aria-live"];
    expect(live, "폴백 문단의 role/aria-live").toBeTruthy();
    expect(String(live)).toMatch(/alert|assertive|polite/);
    // 손으로 옮겨 적는 값도 입력칸이 받는 형태여야 한다 — 사건번호 전체를 실으면 `20241`만 남는다.
    expect(textOf(fallback)).toContain(number);
    expect(textOf(fallback)).not.toContain(caseNo);
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
    const written: string[] = [];
    const mounted = await clickCopy((text) => {
      written.push(text);
      return Promise.resolve();
    });
    // 클립보드에 담기는 값이 번호 단독인가 — 라벨만 보고 판정하면 옛 값이 그대로 실려도 초록이다.
    expect(written).toEqual([number]);
    expect(textOf(find(mounted.render(), (el) => el.type === "button")).trim()).toBe("복사됨");
    expect(find(mounted.render(), (el) => el.type === "p")).toBeNull();
    vi.advanceTimersByTime(2000);
    expect(textOf(find(mounted.render(), (el) => el.type === "button")).trim()).toBe("번호 복사");
    mounted.unmount();
  });
});
