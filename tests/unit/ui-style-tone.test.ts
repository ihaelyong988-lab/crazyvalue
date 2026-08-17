import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import * as jsxRuntime from "react/jsx-runtime";
import { politeFormHits } from "../../.claude/hooks/lib/korean-style.mjs";
import { find, loadModule, textOf } from "./react-harness";

// 문체 회귀(감사 3차 115) — 사용자 노출 문구는 단정형이 확정 문체다(AGENTS §1 · 컨셉 DNA).
//
// 이 결함은 2차 63번에서 "단정형 통일 + 게이트 문체 룰 연동"으로 이미 처방됐는데, 게이트 R12가
// 문장 수 판정으로 바뀌며 문체 룰이 조용히 사라져 3차에 6개 화면에서 되살아났다. 그래서 이 테스트는
// 문구만 고정하지 않는다 — **게이트가 그 문구를 실제로 잡는지**까지 잰다(임시 픽스처 저장소에
// 습니다체 한 줄을 심어 게이트를 실행한다). 룰이 다시 사라지면 그 테스트가 죽어 사실이 드러난다.

const ROOT = process.cwd();
const GATE = join(ROOT, ".claude", "hooks", "ui-quality-gate.mjs");

/** 법적 고지는 격식체가 관례라 게이트 R13·R12가 함께 예외로 둔 유일한 파일이다. */
const EXEMPT = /components[\\/]LegalNotice\.tsx$/;

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTsx(p, out);
    else if (name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("판정기 — 습니다체·청유형만 잡고 단정형·주석은 통과시킨다", () => {
  it.each([
    ['<p>페이지를 찾을 수 없습니다</p>', "습니다"],
    ['<EmptyState title="관심 물건이 아직 없습니다" />', "습니다"],
    ['<p>여기에서 기일과 재유찰을 추적합니다.</p>', "합니다"],
    ['<p>목록에서 빠진 물건입니다(매각·취하 등)</p>', "입니다"],
    ['<ErrorState action="문제가 반복되면 홈으로 이동하세요." />', "하세요"],
    ['<p>아래 주소를 선택해 직접 복사해주세요.</p>', "주세요"],
    ["<p>{`항목 ${n}개가 표시되었습니다.`}</p>", "습니다"],
    ['<p>입찰 전 원문을 반드시 확인하십시오.</p>', "십시오"],
  ])("잡는다: %s", (src, ending) => {
    const hits = politeFormHits(src);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.ending)).toContain(ending);
  });

  it.each([
    ["단정형 평서", "<p>조건에 맞는 물건이 없다</p>"],
    ["단정형 명령", '<ErrorState action="네트워크 상태를 확인한 뒤 다시 시도하라." />'],
    // 「아니다」는 종성이 없어 합쇼체가 아니다 — 「니다」만 보는 정규식이면 여기서 오탐한다.
    ["아니다(합쇼체 아님)", "<p>이 정보는 투자 권유가 아니다.</p>"],
    ["줄 주석", "// 최초 진입은 이동이 아니다. 확인하세요."],
    ["블록 주석", "/* 예전 문구: 페이지를 찾을 수 없습니다 */"],
    ["JSX 주석", "{/* 이 안내는 표시되었습니다 — 이력 서술 */}"],
    ["URL(주석으로 오인 금지)", '<a href="https://www.courtauction.go.kr">원문</a>'],
  ])("통과시킨다: %s", (_label, src) => {
    expect(politeFormHits(src)).toEqual([]);
  });
});

describe("제품 문구 — src/app·src/components 전수", () => {
  const files = [...walkTsx(join(ROOT, "src", "app")), ...walkTsx(join(ROOT, "src", "components"))];

  it("스캔 대상이 비어 있지 않다 (전수 스캔이 조용히 0건이 되는 것을 막는다)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("습니다체·청유형 종결이 0건이다 (법적 고지 제외)", () => {
    const bad = files
      .filter((f) => !EXEMPT.test(f))
      .flatMap((f) =>
        politeFormHits(readFileSync(f, "utf8")).map(
          (h) => `${f.slice(ROOT.length + 1)} — ${h.ending}: ${h.text.slice(0, 40)}`,
        ),
      );
    expect(bad).toEqual([]);
  });
});

describe("게이트 R13 — 룰이 실제로 채점한다", () => {
  const dirs: string[] = [];

  function runGate(fixture: string): { out: string; code: number } {
    const dir = mkdtempSync(join(tmpdir(), "cv-gate-"));
    dirs.push(dir);
    mkdirSync(join(dir, "src", "components"), { recursive: true });
    writeFileSync(join(dir, "src", "components", "Fixture.tsx"), fixture, "utf8");
    try {
      const out = execFileSync(process.execPath, [GATE, "--check"], {
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
      });
      return { out, code: 0 };
    } catch (e) {
      const err = e as { stdout?: string; status?: number };
      return { out: err.stdout ?? "", code: err.status ?? -1 };
    }
  }

  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  it("습니다체 한 줄을 차단 위반으로 채점하고 종료코드 1을 낸다", () => {
    const { out, code } = runGate(
      'export const F = () => <p>화면을 표시하지 못했습니다.</p>;\n',
    );
    expect(out).toContain("R13");
    expect(code).toBe(1);
  });

  it("같은 문구를 단정형으로 바꾸면 R13이 사라지고 통과한다", () => {
    const { out, code } = runGate('export const F = () => <p>화면을 표시하지 못했다.</p>;\n');
    expect(out).not.toContain("R13");
    expect(code).toBe(0);
  });
});

describe("/list 제목 개요(감사 3차 100)", () => {
  interface ListLayoutModule {
    metadata: { title: string };
    default: (props: { children: unknown }) => unknown;
  }
  const layout = loadModule<ListLayoutModule>("src/app/list/layout.tsx", {
    "react/jsx-runtime": jsxRuntime,
  });

  it("document.title이 기본값이 아니라 이 화면의 이름을 담는다", () => {
    expect(layout.metadata.title).toContain("물건 목록");
    expect(layout.metadata.title).not.toBe("미친가치 CrazyValue");
  });

  it("children 갈래와 무관하게 h1이 렌더된다 (로딩·오류·빈 상태 전부 포함)", () => {
    for (const children of [null, "목록", ["a", "b"]]) {
      const tree = layout.default({ children });
      const h1 = find(tree, (el) => el.type === "h1");
      expect(h1).not.toBeNull();
      expect(textOf(h1).trim()).toBe("물건 목록");
    }
  });
});
