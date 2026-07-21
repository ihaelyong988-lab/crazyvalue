/**
 * PWA 아이콘·기본 OG 카드 생성기 — 기획안 §8 Phase 4.1(아이콘)·4.4(og-default 폴백).
 * @playwright/test의 chromium으로 HTML을 목표 크기 뷰포트 그대로 렌더해 스크린샷으로 저장한다.
 * 192는 512 디자인을 transform scale로 동일 비율 축소 렌더 — 이미지 리사이즈 라이브러리 미도입(§13 규칙 10).
 * 폰트는 pretendard 패키지의 정적 OTF를 data URI로 주입(브랜드 정합), 결손 시 시스템 맑은 고딕 폴백.
 * 산출: public/icons/icon-512.png · public/icons/icon-192.png · public/icons/icon-maskable-512.png ·
 *       public/icons/apple-touch-icon-180.png · public/og-default.png
 * 실행: 저장소 루트에서 `npx tsx scripts/gen-icons.ts` (인자로 파일명을 주면 그 산출물만 다시 만든다 —
 *       기존 아이콘을 덮어쓰지 않고 추가할 때 쓴다: `npx tsx scripts/gen-icons.ts icon-maskable-512`)
 * 종료: 대상 전부가 기대 픽셀 크기와 일치해야 0 — 불일치·실패 시 1(§13 규칙 9: 요약 출력·침묵 실패 금지).
 */
import { chromium, type Browser } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

// 디자인 토큰 — design-system/MASTER.md 최상단 오버라이드(기획안 §6)
const NAVY = "#0F2A43";
const PAPER = "#FAFAF8";

const FONT_DIR = join(ROOT, "node_modules", "pretendard", "dist", "public", "static");
const FAMILY = `'Pretendard OTF','Malgun Gothic',sans-serif`;

function fontFace(file: string, weight: number): string {
  const b64 = readFileSync(join(FONT_DIR, file)).toString("base64");
  return `@font-face{font-family:'Pretendard OTF';src:url('data:font/otf;base64,${b64}') format('opentype');font-weight:${weight};font-style:normal;}`;
}

function baseDoc(width: number, height: number, fontCss: string, inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontCss}
html,body{margin:0;padding:0;}
body{width:${width}px;height:${height}px;overflow:hidden;background:${NAVY};}
</style></head><body>${inner}</body></html>`;
}

/**
 * 아이콘 공통 디자인(512 기준) — 중앙 "미친가치" 흰색 볼드 + 하단 소형 "CrazyValue"(§1.1 워드마크 규범).
 * maskable 안전영역(중앙 80% = 409.6px) 준수: 본문 폭 약 394px(100px×4자 − 자간), 블록 높이 약 157px.
 * viewport/512 배율의 transform scale로 192도 동일 디자인을 재렌더한다.
 */
function iconInner(viewport: number): string {
  const scale = viewport / 512;
  return `<div style='width:512px;height:512px;transform:scale(${scale});transform-origin:0 0;background:${NAVY};display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:${FAMILY};'>
  <div style='color:#ffffff;font-size:100px;font-weight:700;line-height:1;letter-spacing:-2px;'>미친가치</div>
  <div style='margin-top:24px;color:rgba(255,255,255,0.72);font-size:33px;font-weight:500;line-height:1;letter-spacing:1px;'>CrazyValue</div>
</div>`;
}

/**
 * maskable 아이콘(512) — 런처가 바깥 20%를 잘라내므로 워드마크를 안전원(반지름 204.8px) 안에 넣는다.
 * 본문 폭 약 298px(76px×4자 − 자간), 블록 높이 약 119px → 대각 반지름 약 161px로 여유가 있다.
 */
function maskableInner(): string {
  return `<div style='width:512px;height:512px;background:${NAVY};display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:${FAMILY};'>
  <div style='color:#ffffff;font-size:76px;font-weight:700;line-height:1;letter-spacing:-2px;'>미친가치</div>
  <div style='margin-top:18px;color:rgba(255,255,255,0.72);font-size:25px;font-weight:500;line-height:1;letter-spacing:1px;'>CrazyValue</div>
</div>`;
}

/** 기본 OG 카드(1200×630) — 좌측 워드마크 + 한 줄 소개(Paper 보조 텍스트). 그라데이션·이모지 없음(§6). */
function ogInner(): string {
  return `<div style='width:1200px;height:630px;background:${NAVY};display:flex;flex-direction:column;justify-content:center;padding:0 96px;box-sizing:border-box;font-family:${FAMILY};'>
  <div style='display:flex;align-items:baseline;gap:20px;'>
    <div style='color:#ffffff;font-size:92px;font-weight:700;line-height:1.1;letter-spacing:-2px;'>미친가치</div>
    <div style='color:rgba(255,255,255,0.72);font-size:34px;font-weight:500;'>CrazyValue</div>
  </div>
  <div style='margin-top:30px;color:${PAPER};font-size:40px;font-weight:400;line-height:1.4;'>유찰 2회 이상 법원경매 큐레이션</div>
</div>`;
}

interface Job {
  out: string;
  width: number;
  height: number;
  html: string;
}

async function render(browser: Browser, job: Job): Promise<void> {
  const page = await browser.newPage({
    viewport: { width: job.width, height: job.height },
    deviceScaleFactor: 1,
  });
  await page.setContent(job.html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready.then(() => undefined)); // 폰트 로드 완료 후 촬영
  await page.screenshot({ path: job.out });
  await page.close();
}

/** PNG IHDR에서 실제 픽셀 크기를 읽는다 — 산출 검증은 결정적 룰로(하네스 Loop). */
function pngInfo(path: string): { w: number; h: number; bytes: number } {
  const buf = readFileSync(path);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes: buf.length };
}

async function main(): Promise<void> {
  mkdirSync(join(ROOT, "public", "icons"), { recursive: true });
  const fontCss = [
    fontFace("Pretendard-Regular.otf", 400),
    fontFace("Pretendard-Medium.otf", 500),
    fontFace("Pretendard-Bold.otf", 700),
  ].join("\n");

  const all: Job[] = [
    {
      out: join(ROOT, "public", "icons", "icon-512.png"),
      width: 512,
      height: 512,
      html: baseDoc(512, 512, fontCss, iconInner(512)),
    },
    {
      out: join(ROOT, "public", "icons", "icon-192.png"),
      width: 192,
      height: 192,
      html: baseDoc(192, 192, fontCss, iconInner(192)),
    },
    // 설치 아이콘 보강(감사 2차 66): 안드로이드 런처 마스크용 + iOS 홈 화면 추가용.
    {
      out: join(ROOT, "public", "icons", "icon-maskable-512.png"),
      width: 512,
      height: 512,
      html: baseDoc(512, 512, fontCss, maskableInner()),
    },
    {
      out: join(ROOT, "public", "icons", "apple-touch-icon-180.png"),
      width: 180,
      height: 180,
      html: baseDoc(180, 180, fontCss, iconInner(180)),
    },
    {
      out: join(ROOT, "public", "og-default.png"),
      width: 1200,
      height: 630,
      html: baseDoc(1200, 630, fontCss, ogInner()),
    },
  ];

  // 인자가 있으면 그 파일명을 포함하는 산출물만 만든다 — 기존 아이콘을 덮어쓰지 않고 추가하는 경로.
  const only = process.argv.slice(2);
  const jobs =
    only.length === 0 ? all : all.filter((j) => only.some((name) => j.out.includes(name)));
  if (jobs.length === 0) {
    console.error(`대상 없음 — 인자 ${JSON.stringify(only)}와 일치하는 산출물이 없다.`);
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch();
  try {
    for (const job of jobs) await render(browser, job);
  } finally {
    await browser.close();
  }

  // 요약 + 검증(기대 크기 불일치 = 실패)
  let failCount = 0;
  for (const job of jobs) {
    const info = pngInfo(job.out);
    const ok = info.w === job.width && info.h === job.height;
    if (!ok) failCount += 1;
    console.log(
      `${ok ? "OK  " : "FAIL"} ${relative(ROOT, job.out)} ${info.w}x${info.h}px ${info.bytes.toLocaleString("ko-KR")} bytes`,
    );
  }
  if (failCount > 0) {
    console.error(`생성 검증 실패 ${failCount}건 — 산출물을 확인하라.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("gen-icons 실패:", err);
  process.exitCode = 1;
});
