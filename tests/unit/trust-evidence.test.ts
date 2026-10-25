import { createElement } from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { describe, expect, it } from "vitest";
import { AuctionItemSchema, type AuctionItem, type HistoryEntry } from "@/types/auction";
import * as format from "@/lib/format";
import { isPick } from "@/lib/data";
import { gateItems } from "../../scripts/crawl-lib";
import { loadModule, textOf } from "./react-harness";

// 2026-10-25 게시 표본의 고정 회귀 자료: 다음 일일 수집에서 해당 ID가 빠져도 시험은 유지된다.
const legacy: AuctionItem = {
  id: "daegu-2026타경100078-1", court: "대구지방법원", caseNo: "2026타경100078", itemNo: "1",
  category: "기타", address: "대구광역시 남구 현충로16길 9-5", region: "대구", district: "남구",
  appraisalPrice: 34_000_000, minPrice: 16_660_000, priceRatio: 0.49, failCount: 2,
  saleDate: "2026-10-30", saleTime: "10:00", courtRoom: "입찰법정", deposit: 1_666_000,
  areaBuilding: null, areaLand: null, photoUrl: null, detailUrl: "https://www.courtauction.go.kr/",
  history: [
    { date: "2026-07-17", minPrice: 34_000_000, result: "신건" },
    { date: "2026-08-21", minPrice: 34_000_000, result: "유찰" },
    { date: "2026-09-25", minPrice: 23_800_000, result: "유찰" },
  ],
  specialNote: "재매각임. 매수보증금 최저매각가격의 20%임",
};
const seoul: AuctionItem = {
  ...legacy, id: "seoul-2023타경55266-1", court: "서울동부지방법원", caseNo: "2023타경55266",
  address: "서울특별시 강동구 천호대로188길 8", region: "서울", district: "강동구", category: "상가",
  appraisalPrice: 260_000_000, minPrice: 17_867_000, priceRatio: 0.0687, deposit: 3_573_400,
  specialNote: "공부상 용도는 '사무소'이나 현황은 '주거용'임 재매각임. 매수신청보증금 최저매각가격의 20%",
};

const { HistoryTimeline } = loadModule<{
  HistoryTimeline: (props: { history: HistoryEntry[]; saleDate: string; minPrice: number; days: number; historySource?: string }) => unknown;
}>("src/components/HistoryTimeline.tsx", { "react/jsx-runtime": jsxRuntime, "@/lib/format": format });
const { PriceStructure } = loadModule<{ PriceStructure: (props: { item: AuctionItem }) => unknown }>(
  "src/components/PriceStructure.tsx",
  { "react/jsx-runtime": jsxRuntime, "@/lib/format": format, "@/lib/data": { isPick },
    "@/components/PickBadge": { PickBadge: () => createElement("span") } },
);

describe("이력 출처 — 추정값을 관측 날짜로 제시하지 않는다", () => {
  it.each([undefined, "unknown", "estimated"])("출처 %s이면 과거 정확한 기일을 숨기고 불확실성을 알린다", (historySource) => {
    const text = textOf(HistoryTimeline({ ...legacy, days: 5, historySource }));
    expect(text).not.toContain(format.formatDateKr("2026-07-17"));
    expect(text).toMatch(/출처 미확인|추정/);
    expect(text).toContain(format.formatDateKr("2026-10-30"));
  });

  it("관측 이력은 실제 날짜와 가격을 표시한다", () => {
    const text = textOf(HistoryTimeline({ ...legacy, days: 5, historySource: "observed" }));
    expect(text).toContain(format.formatDateKr("2026-07-17"));
    expect(text).toContain(format.formatKrw(34_000_000));
  });
});

describe("보증금 — 저장값 보존과 동일 근거의 비율", () => {
  it("대구 10% 저장액과 비고 20%가 다르면 확인 필요로 표시한다", () => {
    const text = textOf(PriceStructure({ item: legacy }));
    expect(text).toContain("확인 필요");
    expect(text).toContain(format.formatKrw(1_666_000));
    expect(text).toContain("비고");
    expect(legacy.deposit).toBe(1_666_000);
  });

  it("서울은 문장 중간의 명시 보증금 비율과 금액이 일치하면 20%를 표시한다", () => {
    const text = textOf(PriceStructure({ item: seoul }));
    expect(text).toContain("최저가의 20%");
    expect(text).not.toContain("최저가의 10%");
    expect(text).not.toContain("확인 필요");
  });

  it.each(["재매각임", "임차인 보증금 20% 인수 가능성", null])("비고 %s만으로는 보증금 비율을 확정하지 않는다", (specialNote) => {
    const text = textOf(PriceStructure({ item: { ...legacy, specialNote } }));
    expect(text).toContain("확인 필요");
    expect(text).not.toMatch(/최저가의 (?:10|20)%/);
  });

  it("관측 비율로 계산한 금액만 같은 비율과 함께 확정 표시한다", () => {
    const item = { ...legacy, specialNote: null, deposit: 3_332_000,
      depositRate: 20, depositSource: "observed" } as AuctionItem;
    const text = textOf(PriceStructure({ item }));
    expect(text).toContain("최저가의 20%");
    expect(text).not.toContain("확인 필요");
    expect(textOf(PriceStructure({ item: { ...item, deposit: 1_666_000 } }))).toContain("확인 필요");
  });

  it("기본값으로 추정한 10%는 관측 비율처럼 표시하지 않는다", () => {
    const item = { ...legacy, specialNote: null, depositRate: 10, depositSource: "estimated" } as AuctionItem;
    const text = textOf(PriceStructure({ item }));
    expect(text).toContain("확인 필요");
    expect(text).not.toContain("최저가의 10%");
  });

  it("서로 다른 명시 비율은 금액 하나가 맞아도 충돌로 표시한다", () => {
    const item = { ...legacy, depositRate: 10, depositSource: "observed" } as AuctionItem;
    expect(textOf(PriceStructure({ item }))).toContain("확인 필요");
  });
});

describe("법원 키와 출처 계약", () => {
  it("선택 근거 필드를 보존하고 기존 출처 없는 자료도 수용한다", () => {
    const item = AuctionItemSchema.parse({ ...legacy, courtCode: "B000310", historySource: "estimated",
      depositRate: 20, depositSource: "observed" });
    expect(item).toMatchObject({ courtCode: "B000310", historySource: "estimated", depositRate: 20, depositSource: "observed" });
    expect(AuctionItemSchema.safeParse(legacy).success).toBe(true);
  });

  it("동일 출력 ID에 다른 법원 코드가 있으면 중복 드롭과 별도로 충돌 근거를 남긴다", () => {
    const a = { id: "seoul-2026타경1-1", courtCode: "B000210" };
    const b = { ...a, courtCode: "B000211" };
    const result = gateItems([a, b, { ...a }], () => true);
    expect(result.valid).toEqual([a]);
    expect(result.dupDropped).toBe(2);
    expect(result).toHaveProperty("idCollisions", [{ id: a.id, keptCourtCode: "B000210", droppedCourtCode: "B000211" }]);
  });

  it("법원 코드 없는 과거 중복은 법원 충돌로 단정하지 않는다", () => {
    expect(gateItems([{ id: "old" }, { id: "old" }], () => true)).toHaveProperty("idCollisions", []);
  });
});
