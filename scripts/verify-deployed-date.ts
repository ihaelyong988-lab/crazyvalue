/**
 * 배포된 화면이 산출물의 기준일을 말하는지 확인한다.
 *
 * 왜 있나: 이 저장소의 갱신 워크플로는 오랫동안 **커밋된 파일**만 jq로 채점하고 **배포된 화면**을
 * 한 번도 보지 않았다. 그래서 "런 성공·게이트 통과·커밋·배포"가 전부 초록인데 방문자 화면은
 * 일주일 묵은 날짜를 띄우고 있었다(2026-08-09 주인님 폰). 원장 2026-08-02가 이미
 * "검증이 파이프라인 안쪽에서 멈추고 방문자 화면까지 오지 않았다"를 남겼는데 기계 게이트가 없었다.
 *
 * 게다가 봇이 `GITHUB_TOKEN`으로 올리는 데이터 커밋은 워크플로를 발화시키지 않는다(GitHub 사양).
 * 즉 매일 갱신이 화면을 깨뜨려도 사람이 푸시할 때까지 CI가 돌지 않는다 — 실제로 08-07 데이터가
 * E2E 1건을 이틀간 깨뜨린 채였다. **자동화가 만든 변경은 그 자동화가 검사해야 한다.**
 *
 * 무엇을 하나: 기준일은 이제 빌드 시점에 HTML로 구워진다(src/lib/build-meta.ts). 그래서 배포된
 * HTML에 그 문자열이 있는지만 보면 ① 배포가 반영됐는가 ② 화면이 옳은 날짜를 말하는가를 한 번에
 * 판정할 수 있다. 반영에는 시간이 걸리므로 창을 두고 폴링하다가, 창을 넘기면 실패로 끝낸다.
 *
 * 실행: npx tsx scripts/verify-deployed-date.ts
 *   SITE_URL           기본 https://crazyvalue.vercel.app
 *   VERIFY_TIMEOUT_MS  기본 720000(12분) — Vercel 배포 반영 실측이 1~3분이라 여유를 둔다
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { formatMonthDayKr, seoulDateTime } from "../src/lib/format";

const SITE = (process.env.SITE_URL ?? "https://crazyvalue.vercel.app").replace(/\/+$/, "");
const TIMEOUT_MS = Number(process.env.VERIFY_TIMEOUT_MS ?? 12 * 60_000);
const INTERVAL_MS = 15_000;

const metaPath = path.resolve(__dirname, "..", "public", "data", "meta.json");
const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as { crawledAt?: string };

if (typeof meta.crawledAt !== "string") {
  console.error("meta.json에 crawledAt이 없다 — 산출물부터 확인하라.");
  process.exit(1);
}
const stamp = seoulDateTime(meta.crawledAt);
if (!stamp) {
  console.error(`crawledAt을 읽지 못했다: ${meta.crawledAt}`);
  process.exit(1);
}

// 화면 표기 규약은 DataDateBar와 같은 함수에서 나온다 — 문자열을 여기서 다시 조립하지 않는다.
const expected = `${formatMonthDayKr(stamp.date)} ${stamp.time}`;

async function fetchHome(): Promise<string> {
  // 캐시 무력화 — 엣지·중간 캐시가 옛 HTML을 돌려주면 판정이 무의미해진다.
  const res = await fetch(`${SITE}/?verify=${Date.now()}`, {
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function main(): Promise<void> {
  console.log(`배포 화면 검증 — ${SITE} 에서 "${expected}" 를 찾는다(창 ${Math.round(TIMEOUT_MS / 60_000)}분).`);
  const deadline = Date.now() + TIMEOUT_MS;
  let lastSeen = "(응답 없음)";
  let attempts = 0;

  for (;;) {
    attempts++;
    try {
      const html = await fetchHome();
      if (html.includes(expected)) {
        console.log(`통과 — ${attempts}회차에서 확인했다. 화면 기준일 = ${expected}`);
        return;
      }
      // 무엇이 떠 있는지 남긴다. "다르다"만 알면 배포 지연인지 표기 파손인지 가를 수 없다.
      const found = html.match(/\d{2}-\d{2}\([일월화수목금토]\) \d{2}:\d{2}/);
      lastSeen = found ? found[0] : "(기준일 표기 없음 — 화면 구조 파손 가능성)";
    } catch (err) {
      lastSeen = `(요청 실패: ${err instanceof Error ? err.message : String(err)})`;
    }
    if (Date.now() + INTERVAL_MS >= deadline) break;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }

  console.error(
    `실패 — 창 안에 반영되지 않았다.\n` +
      `  기대: ${expected}\n` +
      `  화면: ${lastSeen}\n` +
      `  시도: ${attempts}회\n` +
      `배포가 지연·실패했거나, 기준일이 빌드 산출물에서 오지 않도록 되돌아갔다.`,
  );
  process.exit(1);
}

void main();
