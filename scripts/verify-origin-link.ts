/**
 * 법원 원문 링크가 **지금도 도달하는지** 확인한다.
 *
 * 왜 있나: 2026-08-20까지 상세의 "원문 보기"는 1,000건 전량이 오류창
 * ("부모 객체를 찾을 수 없습니다.")으로 떨어졌는데, 유닛·E2E 게이트 3종이 전부 초록이었다.
 * 셋 다 `href === item.detailUrl`처럼 **자기 자신과 대조**했기 때문이다(AGENTS §9).
 * 그리고 목적지는 우리 저장소가 아니라 법원 사이트다 — 통보 없이 바뀌고, 바뀌면 아무도 모른다
 * (그 화면 코드에는 2025.12.26 개정 이력이 있다).
 *
 * 무엇을 하나: 브라우저를 띄우지 않고 **법원 사이트의 화면 정의(XML)로 계약을 잰다.**
 *   ① 링크가 200을 준다.
 *   ② 그 화면이 최상단 컨테이너다 — `scwin.isMain`이 true를 돌려주고, 본문 프레임을 스스로 얹는다.
 *      (`…F01`/`…M01` 자식 화면은 부모가 사건 파라미터를 넣어 줘야 뜨므로 단독 진입 시 오류창이다.)
 *   ③ 그 화면이 얹는 자식에 **법원 선택·번호 입력칸**이 있고, 번호칸 규격(`dataType=number`·maxlength)이
 *      우리 복사값(산출물 전건)을 받아들인다.
 * 브라우저를 쓰지 않는 이유: 일일 수집 워크플로에 붙여도 브라우저 설치 비용이 들지 않고,
 * 요청 3회로 끝나 예절 한도(§4) 안에 있다. "실제로 렌더되는가"는 E2E가 로컬·CI에서 따로 잰다.
 *
 * 실행: npx tsx scripts/verify-origin-link.ts
 * 종료코드: 0 통과 · 1 계약 위반(무엇이 어긋났는지 출력) — **조회 실패도 1이다**(측정 실패는 통과가 아니다).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { COURT_ORIGIN_URL, copyableCaseNo } from "../src/lib/court-origin";
import { REGIONS } from "../src/types/auction";
import { BASE_URL, POLITENESS, USER_AGENT } from "./crawl-config";

const violations: string[] = [];
const notes: string[] = [];

function fail(msg: string): void {
  violations.push(msg);
}

async function get(url: string): Promise<{ status: number; body: string }> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  return { status: res.status, body: await res.text() };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 산출물 전건의 복사값 — 목적지 입력칸 규격과 대조할 실제 값이다. */
function copyValues(): string[] {
  const dir = path.resolve(__dirname, "..", "public", "data");
  const out: string[] = [];
  for (const r of REGIONS) {
    const raw: unknown = JSON.parse(readFileSync(path.join(dir, `${r.key}.json`), "utf-8"));
    if (!Array.isArray(raw)) continue;
    for (const item of raw as { caseNo?: string }[]) {
      if (typeof item.caseNo === "string") out.push(copyableCaseNo(item.caseNo));
    }
  }
  return out;
}

async function main(): Promise<void> {
  const screenPath = new URL(COURT_ORIGIN_URL).searchParams.get("w2xPath");
  if (screenPath === null) {
    fail(`원문 링크에 w2xPath가 없다: ${COURT_ORIGIN_URL}`);
    report();
    return;
  }
  if (!/PGJ\w{3}(F|M)00\.xml$/.test(screenPath)) {
    fail(`목적지가 최상단 화면 규격(…F00/…M00)이 아니다: ${screenPath}`);
  }

  // ① 링크 자체
  const entry = await get(COURT_ORIGIN_URL);
  if (entry.status !== 200) fail(`원문 링크 응답 ${entry.status} (기대 200)`);
  await sleep(POLITENESS.minIntervalMs);

  // ② 최상단 화면 정의
  const top = await get(`${BASE_URL}${screenPath}`);
  if (top.status !== 200) {
    fail(`화면 정의 응답 ${top.status} — 법원이 화면을 옮겼거나 삭제했다: ${screenPath}`);
    report();
    return;
  }
  // `[^}]*`가 줄바꿈까지 먹으므로 dotAll(`s`)은 쓰지 않는다 — tsconfig target(es2017)이 그 플래그를 막는다.
  const isMain = /scwin\.isMain\s*=\s*function\s*\(\s*\)\s*\{[^}]*return\s+true/.test(top.body);
  if (!isMain) fail("목적지가 최상단 화면이 아니다 — scwin.isMain이 true를 돌려주지 않는다");
  if (/\$p\.getParameter\(/.test(top.body)) {
    fail("목적지가 부모에게서 파라미터를 받는다 — 단독 진입 시 오류창이 뜬다");
  }
  const child = /wfm_mainFrame\.setSrc\("([^"]+)"\)/.exec(top.body)?.[1];
  if (child === undefined) {
    fail("목적지가 본문 프레임을 얹지 않는다 — 화면 구조가 바뀌었다");
    report();
    return;
  }
  notes.push(`최상단 ${screenPath} → 본문 ${child}`);
  await sleep(POLITENESS.minIntervalMs);

  // ③ 검색 폼 계약 — 법원 선택·번호 입력칸과 그 규격
  const form = await get(new URL(child, `${BASE_URL}${screenPath}`).toString());
  if (form.status !== 200) {
    fail(`본문 화면 응답 ${form.status}: ${child}`);
    report();
    return;
  }
  if (!/id="sbx_auctnCsSrchCortOfc"/.test(form.body)) {
    fail("법원 선택 필드가 없다 — 안내 문구(법원 선택)가 가리킬 대상이 사라졌다");
  }
  const numField = /id="ibx_auctnCsSrchCsNo"([^>]*)/.exec(form.body)?.[1];
  if (numField === undefined) {
    fail("번호 입력칸이 없다 — 복사값을 붙여넣을 대상이 사라졌다");
    report();
    return;
  }
  const maxLen = Number(/maxlength="(\d+)"/.exec(numField)?.[1] ?? 0);
  const numeric = /dataType="number"/.test(numField);
  if (maxLen === 0) fail(`번호 입력칸 maxlength를 읽지 못했다: ${numField.trim()}`);
  notes.push(`번호칸 maxlength=${maxLen}${numeric ? " · dataType=number" : ""}`);

  const values = copyValues();
  if (values.length === 0) fail("산출물에서 복사값을 하나도 읽지 못했다(측정 실패)");
  const tooLong = values.filter((v) => v.length > maxLen);
  const notNumeric = numeric ? values.filter((v) => !/^\d+$/.test(v)) : [];
  if (tooLong.length > 0) {
    fail(`복사값 ${tooLong.length}건이 입력칸 ${maxLen}자를 넘는다 (예: ${tooLong[0]})`);
  }
  if (notNumeric.length > 0) {
    fail(`복사값 ${notNumeric.length}건이 숫자가 아니다 (예: ${notNumeric[0]})`);
  }
  notes.push(`복사값 ${values.length}건 전건이 규격을 통과`);
  report();
}

function report(): void {
  for (const n of notes) console.log(`· ${n}`);
  if (violations.length === 0) {
    console.log(`원문 링크 도달 계약 통과 — ${COURT_ORIGIN_URL}`);
    return;
  }
  console.error(`원문 링크 계약 위반 ${violations.length}건 — ${COURT_ORIGIN_URL}`);
  for (const v of violations) console.error(`  · ${v}`);
  process.exitCode = 1;
}

main().catch((e: unknown) => {
  // 조회 실패를 통과로 흘리지 않는다 — 모르면 알린다.
  console.error(`원문 링크 검증 자체가 실패했다: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
