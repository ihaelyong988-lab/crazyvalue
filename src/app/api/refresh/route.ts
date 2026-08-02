import { NextResponse } from "next/server";
import { deriveStatus, type RunSummary } from "@/lib/refresh";

// 수동 재수집(리셋) — 브라우저는 크롤러를 직접 돌릴 수 없다(앱은 정적 서빙, 크롤러는 Actions에만 있다).
// 이 핸들러가 서버에서 workflow_dispatch를 대신 호출한다. 토큰은 서버 환경변수로만 존재하며
// 응답에 실리지 않는다.
//
// 저장소가 공개라 런 조회(GET)는 무인증으로도 된다 — 토큰 미설정 상태에서도 진행 상황은 정확히 보인다.
// 실행(POST)만 토큰을 요구한다.

export const dynamic = "force-dynamic";

const REPO = "ihaelyong988-lab/crazyvalue";
const WORKFLOW = "crawl.yml";
const API = `https://api.github.com/repos/${REPO}`;

function dispatchToken(): string | null {
  const raw = process.env.GH_DISPATCH_TOKEN?.trim();
  return raw ? raw : null;
}

async function fetchRuns(): Promise<RunSummary[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = dispatchToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/actions/workflows/${WORKFLOW}/runs?per_page=10`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const json = (await res.json()) as {
    workflow_runs?: Array<{ status: string; created_at: string; html_url: string }>;
  };
  return (json.workflow_runs ?? []).map((r) => ({
    status: r.status,
    createdAt: r.created_at,
    htmlUrl: r.html_url,
  }));
}

export async function GET() {
  try {
    return NextResponse.json(deriveStatus(await fetchRuns(), new Date(), dispatchToken() !== null));
  } catch {
    return NextResponse.json({ error: "수집 상태를 확인하지 못했다" }, { status: 502 });
  }
}

export async function POST() {
  const token = dispatchToken();
  if (!token) {
    return NextResponse.json(
      { state: "unconfigured", error: "재수집 실행 권한이 아직 설정되지 않았다" },
      { status: 503 },
    );
  }
  let status;
  try {
    status = deriveStatus(await fetchRuns(), new Date(), true);
  } catch {
    return NextResponse.json({ error: "수집 상태를 확인하지 못했다" }, { status: 502 });
  }
  // 진행 중·쿨다운은 거절한다 — 워크플로 concurrency가 중복을 막지만, 거절 사유를 화면이 말해야 한다.
  if (status.state === "running") return NextResponse.json(status, { status: 409 });
  if (status.state === "cooldown") return NextResponse.json(status, { status: 429 });

  const res = await fetch(`${API}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    // quick = 경량 모드(창 7일·상세 생략). 실측 182초라 방문자가 기다릴 수 있는 범위다.
    // 전량 모드(60분)는 주간 슬롯이 담당한다 — 리프레쉬가 그것을 대신하지 않는다.
    body: JSON.stringify({ ref: "main", inputs: { mode: "quick" } }),
  });
  if (!res.ok) {
    return NextResponse.json({ error: `실행 요청이 거부됐다(${res.status})` }, { status: 502 });
  }
  // dispatch는 202만 주고 런 식별자를 주지 않는다. 목록에 잡히기까지 수 초 걸리므로 화면이 폴링해 잇는다.
  return NextResponse.json(
    { state: "running", lastRunAt: new Date().toISOString(), cooldownUntil: null, runUrl: null },
    { status: 202 },
  );
}
