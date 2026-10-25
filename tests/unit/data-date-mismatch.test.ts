import { afterEach, expect, it, vi } from "vitest";
import * as jsxRuntime from "react/jsx-runtime";
import * as format from "@/lib/format";
import { createReactStub, find, loadModule, textOf } from "./react-harness";

afterEach(() => vi.unstubAllGlobals());

it("빌드와 목록 버전 불일치를 알리고 전체 갱신 동선을 제공한다", () => {
  const reportBuildSnapshot = vi.fn();
  const reload = vi.fn();
  vi.stubGlobal("document", { visibilityState: "hidden", addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal("window", { location: { reload }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const hooks = createReactStub();
  const { DataDateNotice } = loadModule<{ DataDateNotice: (props: { baked: string }) => unknown }>("src/components/DataDateNotice.tsx", {
    react: hooks.react,
    "react/jsx-runtime": jsxRuntime,
    "@/lib/format": format,
    "@/lib/use-meta": { useMeta: () => ({ dropped: 2, snapshotMismatch: true }), reportBuildSnapshot },
  });
  const mounted = hooks.mount(() => DataDateNotice({ baked: "2026-10-25T06:15:43+09:00" }));
  const tree = mounted.render();
  expect(reportBuildSnapshot).toHaveBeenCalledWith("2026-10-25T06:15:43+09:00");
  expect(textOf(tree)).toContain("데이터 버전");
  expect(textOf(tree)).toContain("형식 오류 2건 제외");
  const button = find(tree, (el) => el.type === "button" && textOf(el).includes("새로고침"));
  expect(button).not.toBeNull();
  (button?.props.onClick as () => void)();
  expect(reload).toHaveBeenCalledOnce();
  mounted.unmount();
});
