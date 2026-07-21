import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { districtKey, type Filters } from "@/lib/data";
import {
  buildListQuery,
  parseListQuery,
  readHomeFilterMirror,
  writeHomeFilterMirror,
  type ListQuery,
} from "@/lib/query";

// URL 쿼리 정제(§13 규칙 11 · 감사 2차 44) — 화면은 parseListQuery 결과를 그대로 "적용 중인 필터"
// 칩으로 단정 표기한다. 유령 값·중복 값이 통과하면 걸리지 않은 조건이 걸린 것처럼 보인다.
const parse = (qs: string) => parseListQuery(new URLSearchParams(qs));

describe("parseListQuery — 지역(r) 화이트리스트(감사 2차 44)", () => {
  it("시·도 목록에 없는 값은 버린다", () => {
    expect(parse("r=없는지역").regions).toEqual([]);
  });
  it("유효 값과 유령 값이 섞이면 유효 값만 남는다", () => {
    expect(parse("r=서울,없는지역,경기").regions).toEqual(["서울", "경기"]);
  });
  it("유효한 시·도는 입력 순서 그대로 유지한다", () => {
    expect(parse("r=경기,서울").regions).toEqual(["경기", "서울"]);
  });
});

describe("parseListQuery — 4축 중복 제거(감사 2차 44)", () => {
  it("r·d·b·c 반복 값은 축마다 한 번만 남는다", () => {
    const gangnam = districtKey("서울", "강남구");
    const q = parse(`r=서울,서울&d=${gangnam},${gangnam}&b=b3,b3&c=아파트,아파트`);
    expect(q.regions).toEqual(["서울"]);
    expect(q.districts).toEqual([gangnam]);
    expect(q.priceBands).toEqual(["b3"]);
    expect(q.categories).toEqual(["아파트"]);
  });
  it("구형 단독 값과 결합 키는 매칭 범위가 다르므로 함께 남는다", () => {
    expect(parse(`d=북구,${districtKey("대구", "북구")},북구`).districts).toEqual([
      "북구",
      districtKey("대구", "북구"),
    ]);
  });
});

describe("parseListQuery — 정상 케이스 회귀", () => {
  it("결합 키 인코딩이 왕복에서 보존된다(감사 14)", () => {
    const districts = [districtKey("대구", "북구"), districtKey("서울", "강남구")];
    expect(parse(buildListQuery({ districts })).districts).toEqual(districts);
  });
  it("금액 구간·용도의 유효 값은 그대로 통과한다", () => {
    const q = parse("b=b1,b4&c=아파트,토지");
    expect(q.priceBands).toEqual(["b1", "b4"]);
    expect(q.categories).toEqual(["아파트", "토지"]);
  });
  it("정렬·표시건수·픽 파라미터는 그대로 통과한다", () => {
    const q = parse("sort=price&n=30&pick=1");
    expect([q.sort, q.count, q.pickOnly]).toEqual(["price", 30, true]);
  });
  it("알 수 없는 정렬·건수는 기본값으로 되돌린다", () => {
    const q = parse("sort=zzz&n=abc");
    expect([q.sort, q.count]).toEqual(["date", 10]);
  });
});

// 홈 필터 세션 미러(감사 2차 55) — 홈·리스트가 공유하는 "지금 보고 있는 조건" 1곳.
// node 환경 window 셧: 미러는 sessionStorage만 쓴다(watchlist.test.ts와 같은 방식).
const session = new Map<string, string>();
let blockWrite = false;

function setWindow(): void {
  (globalThis as unknown as { window: unknown }).window = {
    sessionStorage: {
      getItem: (k: string) => session.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (blockWrite) throw new Error("QuotaExceededError"); // 용량 초과·프라이빗 모드 모사
        session.set(k, v);
      },
      removeItem: (k: string) => void session.delete(k),
    },
  };
}

function clearWindow(): void {
  delete (globalThis as unknown as { window?: unknown }).window;
}

describe("홈 필터 세션 미러(감사 2차 55)", () => {
  const filters: Filters = {
    regions: ["서울"],
    districts: [districtKey("서울", "강남구")],
    priceBands: ["b3"],
    categories: ["아파트"],
  };

  beforeEach(() => {
    session.clear();
    blockWrite = false;
    setWindow();
  });
  afterEach(clearWindow);

  it("저장 전에는 미러가 없다", () => {
    expect(readHomeFilterMirror()).toBeNull();
  });

  it("리스트가 쓴 조건을 홈이 그대로 되읽는다(4축 왕복)", () => {
    writeHomeFilterMirror(filters);
    const q = parse(readHomeFilterMirror() ?? "");
    expect([q.regions, q.districts, q.priceBands, q.categories]).toEqual([
      filters.regions,
      filters.districts,
      filters.priceBands,
      filters.categories,
    ]);
  });

  it("홈에 없는 상태(픽·정렬·표시건수)는 미러에 남기지 않는다", () => {
    const listState: ListQuery = { ...filters, pickOnly: true, sort: "price", count: 50 };
    writeHomeFilterMirror(listState);
    expect(readHomeFilterMirror()).toBe(buildListQuery(filters));
  });

  it("조건 전체 해제는 빈 값으로 기록된다(되살아남 방지)", () => {
    writeHomeFilterMirror(filters);
    writeHomeFilterMirror({ regions: [], districts: [], priceBands: [], categories: [] });
    expect(readHomeFilterMirror()).toBe("");
  });

  it("저장 실패(용량·프라이빗)는 화면 흐름을 막지 않는다", () => {
    blockWrite = true;
    expect(() => writeHomeFilterMirror(filters)).not.toThrow();
    expect(readHomeFilterMirror()).toBeNull();
  });

  it("window 없는 렌더에서는 저장소에 접근하지 않는다", () => {
    clearWindow();
    expect(readHomeFilterMirror()).toBeNull();
    expect(() => writeHomeFilterMirror(filters)).not.toThrow();
  });
});
