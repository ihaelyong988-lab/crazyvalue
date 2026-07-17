// UI 품질 검증 루프 (Stop 훅) — "스킬 호출만 하고 결과 미적용" 구멍을 구조적으로 차단한다.
// 원본 템플릿: Hermes_Workspace/templates/ui-quality-gate.mjs → crazyvalue용 개작:
//   src/(app|components) 구조 대응 · 전수 스캔(diff 구멍 차단) · PLAN §13 차단룰(시크릿·
//   dangerouslySetInnerHTML·금지 표현·이모지·그라데이션·저대비) 추가 · main 브랜치.
//
// 모드:
//   (인자 없음)  Stop 훅 — UI 변경 세션에서 마커/위반 검사 후 block 여부 결정
//   --check      전수 채점 결과 출력(기록 안 함)
//   --pass       차단룰 0건일 때만 이 세션 검증 마커 기록(루프 해제)
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const stateDir = join(root, '.claude', 'hooks', '.state');
const mode = process.argv[2] || '';

const sh = (cmd) => { try { return execSync(cmd, { cwd: root, encoding: 'utf8' }); } catch { return ''; } };

// 산출물 전수 수집 — 채점은 변경분이 아니라 현재 산출물 전체를 본다(오류 원장 2026-07-18).
function walk(dir, exts, out = []) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const rel = `${dir}/${name}`;
    const st = statSync(join(root, rel));
    if (st.isDirectory()) { if (name !== 'node_modules' && name !== '.next') walk(rel, exts, out); }
    else if (exts.some((e) => name.endsWith(e))) out.push(rel);
  }
  return out;
}
const uiFiles = () => [...walk('src/app', ['.tsx']), ...walk('src/components', ['.tsx'])];
const styleFiles = () => walk('src', ['.css']);
const scanAllFiles = () => [
  ...walk('src', ['.ts', '.tsx', '.css']),
  ...walk('scripts', ['.ts', '.mjs', '.js']),
  ...walk('.github', ['.yml', '.yaml']),
];

// 이번 세션에 UI 변경이 있었는지(Stop 훅 트리거 판단용) — 미커밋 + 기준 브랜치 diff.
function uiChanged() {
  const isUi = (p) => /^src\/(app|components)\/.+\.tsx$/.test(p.trim().replace(/^"|"$/g, ''));
  const status = sh('git status --porcelain').split('\n').filter(Boolean)
    .map((l) => { let p = l.slice(3); if (p.includes(' -> ')) p = p.split(' -> ').pop(); return p; });
  if (status.some(isUi)) return true;
  for (const base of ['main', 'master']) {
    const mb = sh(`git merge-base HEAD ${base}`).trim();
    if (mb) return sh(`git diff --name-only ${mb} HEAD`).split('\n').filter(Boolean).some(isUi);
  }
  return false;
}

// 결정적 채점 룰. block=true 는 마감 차단.
function lint() {
  const out = [];
  const push = (file, block, rule, fix) => out.push({ file, block, rule, fix });
  const read = (f) => { try { return readFileSync(join(root, f), 'utf8'); } catch { return ''; } };

  const emoji = /\p{Extended_Pictographic}/u;
  const lowContrast = /text-(gray|zinc|neutral|slate|stone)-(300|400)(?![0-9])/;
  const gradient = /bg-gradient|linear-gradient|radial-gradient/;
  const hype = /혁신적|완벽한|강력한|손쉽게|원활한/;
  const exclaim = /[가-힣]\s*[!！]/;
  const investment = /투자 ?권유(?!가 아니)|수익(률)? ?보장/;
  const secrets = /ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|api[_-]?key\s*[:=]\s*['"][A-Za-z0-9_-]{8,}['"]/i;

  for (const f of uiFiles()) {
    const src = read(f); if (!src) continue;
    const hasErrRender = /\{\s*err(or)?(Msg|Message)?\s*&&/.test(src) || /<ErrorState/.test(src);
    const hasAlert = /role=["']alert["']/.test(src) || /aria-live=/.test(src);
    if (hasErrRender && !hasAlert && !/components\/ErrorState/.test(f))
      push(f, true, 'R1 에러 표시에 role="alert"/aria-live 누락', '오류 컨테이너에 role="alert" 추가');
    if (lowContrast.test(src))
      push(f, true, 'R2 저대비 본문색(300/400 계열, 4.5:1 미달)', 'text-*-600 이상 또는 Ink 토큰 사용');
    if (emoji.test(src))
      push(f, true, 'R3 이모지 아이콘 사용', 'lucide-react 라인 아이콘 또는 텍스트 라벨로 교체');
    if (hype.test(src))
      push(f, true, 'R4 과장 수식어', '단정형 문장으로 교체(컨셉 DNA)');
    if (exclaim.test(src))
      push(f, true, 'R5 한글 문장 느낌표', '마침표로 교체');
    if (/w-[89] h-[89][^"']*cursor-pointer|cursor-pointer[^"']*w-[89] h-[89]/.test(src))
      push(f, false, 'R6 터치 타깃<44px 의심', 'min-w/h 44px 이상 또는 패딩 확대');
  }
  for (const f of [...uiFiles(), ...styleFiles()]) {
    const src = read(f); if (!src) continue;
    if (gradient.test(src)) push(f, true, 'R7 그라데이션', '단색 토큰(Navy·Accent)으로 교체');
  }
  for (const f of scanAllFiles()) {
    const src = read(f); if (!src) continue;
    if (/dangerouslySetInnerHTML/.test(src)) push(f, true, 'R8 dangerouslySetInnerHTML', '텍스트 노드로만 렌더');
    if (secrets.test(src)) push(f, true, 'R9 시크릿 패턴 검출', '비밀키를 코드·저장소에 두지 않는다');
    if (investment.test(src)) push(f, true, 'R10 투자 권유·수익 보장 표현', '사실 표기로 교체("투자 권유가 아니다"류 부정문은 허용)');
  }
  // 프로젝트 수준(UI가 존재할 때만): 전역 접근성 스타일.
  if (uiFiles().length > 0) {
    const g = read('src/app/globals.css');
    if (g && !/focus-visible/.test(g))
      push('src/app/globals.css', true, 'P1 focus-visible 스타일 부재', ':focus-visible 가시 아웃라인 정의');
    if (g && !/prefers-reduced-motion/.test(g))
      push('src/app/globals.css', true, 'P2 prefers-reduced-motion 미존중', '@media (prefers-reduced-motion: reduce) 처리 추가');
    const anyTabular = [...uiFiles(), ...styleFiles()].some((f) => /tabular-nums/.test(read(f)));
    if (!anyTabular)
      push('src/', false, 'P3 tabular-nums 미사용', '금액·숫자 표기에 tabular-nums 적용');
  }
  return out;
}

function readStdin() { try { return JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { return {}; } }
function ensureState() { if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true }); }

// ---- --check / --pass ----
if (mode === '--check' || mode === '--pass') {
  const files = uiFiles();
  if (files.length === 0) { process.stdout.write('UI(.tsx) 산출물 없음 — 검증 대상 없음.\n'); process.exit(0); }
  const v = lint();
  const blocking = v.filter((x) => x.block);
  process.stdout.write(`검사 대상 UI ${files.length}개 + 전체 스캔.\n`);
  if (v.length === 0) process.stdout.write('위반 0건.\n');
  else v.forEach((x) => process.stdout.write(`${x.block ? '[BLOCK]' : '[WARN]'} ${x.rule} — ${x.file}\n   → ${x.fix}\n`));
  if (mode === '--pass') {
    if (blocking.length > 0) { process.stdout.write(`\n차단 룰 ${blocking.length}건 — 마커 미기록. 먼저 수정하라.\n`); process.exit(2); }
    ensureState(); writeFileSync(join(stateDir, 'uiux-pass'), String(Date.now()));
    process.stdout.write('\n검증 통과 — 마커 기록. 마감 진행 가능.\n');
  }
  process.exit(blocking.length > 0 && mode === '--check' ? 1 : 0);
}

// ---- Stop 훅 모드 ----
const input = readStdin();
const sessionId = input.session_id || 'nosession';
if (!uiChanged()) process.exit(0); // 이번 세션 UI 변경 없음 → 통과

ensureState();
const passMarker = join(stateDir, 'uiux-pass');
const blockMarker = join(stateDir, `uiux-blocks-${sessionId}`);

const violations = lint();
const blocking = violations.filter((x) => x.block);
if (existsSync(passMarker) && blocking.length === 0) process.exit(0);

// 무한 루프 방지 — 세션당 3회 초과 차단 시 경고만 내고 통과.
let n = 0; if (existsSync(blockMarker)) { try { n = parseInt(readFileSync(blockMarker, 'utf8'), 10) || 0; } catch {} }
if (n >= 3) {
  process.stdout.write(JSON.stringify({ systemMessage: 'UI 품질 게이트: 검증 미통과지만 차단 3회 초과로 통과시킨다. 수동 점검 필요.' }));
  process.exit(0);
}
writeFileSync(blockMarker, String(n + 1));

const lines = violations.length
  ? violations.map((x) => `  ${x.block ? '[BLOCK]' : '[WARN]'} ${x.rule} (${x.file}) → ${x.fix}`).join('\n')
  : '  (자동 룰 위반은 없으나 검증 기록이 없음)';

const reason = [
  'UI 품질 게이트(검증 루프): UI(.tsx)를 변경했는데 검증 기록이 없습니다.',
  '아래를 점검·수정한 뒤 마감하세요(스킬 호출만으로는 통과 불가):',
  lines,
  '',
  '기준: design-system/MASTER.md + AGENTS.md(대비 4.5:1·터치 44px·role=alert·focus-visible·tabular-nums·이모지/그라데이션/과장어 금지).',
  '점검: `node .claude/hooks/ui-quality-gate.mjs --check`',
  '통과 기록(차단 룰 0건일 때만): `node .claude/hooks/ui-quality-gate.mjs --pass`',
].join('\n');

process.stdout.write(JSON.stringify({ decision: 'block', reason }));
