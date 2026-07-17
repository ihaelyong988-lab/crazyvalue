# AGENTS.md — crazyvalue 저장소 작업 규칙

> 작업 재개 순서: 이 파일 → `docs/PLAN.md`(기획안 v3.1 사본, 원본은 기획 폴더 `경매 최저가/`) → `docs/TRACE.md`(실행 완전성 원장) → 마지막 Phase 보고.
> 상위법: `~/.claude/CLAUDE.md` 반복금지 헌법 · 기획 폴더 `경매 최저가/AGENTS.md`.

## 1. 정체성·확정 결정 (재질문 금지)
- **CrazyValue(미친가치)** — 유찰 2회 이상 법원경매 물건만 큐레이션하는 모바일 온리 PWA.
- 스택: Next.js 15 + TypeScript + Tailwind v4 · 정적 JSON(시도 17분할) · GitHub Actions cron `0 18 * * 6`(UTC)=일 03:00 KST · Vercel 자동 배포.
- 무가입 — 관심함·최근 본 물건은 localStorage `crazyvalue.*`. 코드 위치는 이 저장소(`C:\dev\crazyvalue`)만, 기획 문서는 기획 폴더.
- 워드마크: 미친가치(주)+CrazyValue(보조). "미친"은 브랜드명·픽 배지 한정, 본문 수식어 금지.

## 2. 도메인 불변식
- 저감률은 법원별 20% 또는 30% — 전국 일률 아님. 앱이 임의 계산·단정 표기 금지, 수집값 그대로.
- **미친가치 픽 = `priceRatio <= 0.5`** (최저가 ≤ 감정가 50%) — 저장 필드 아닌 파생 계산, 기준은 앱 안내에 공개.
- `priceRatio` = minPrice/appraisalPrice(0~1). 표시 할인율 = 1 − priceRatio — **부호 반전 주의**.
- 법적 고지(참고용·원문 우선·입찰 전 확인)를 상세·안내에 상시 표기. 투자 권유·수익 보장 표현 금지.
- 크롤 예절: 간격 ≥1초 · UA `CrazyValueBot/0.1` · 심야 실행 · 실패 시 직전 데이터 유지(무커밋).
- 기일 계산은 Asia/Seoul date-only, `src/lib/format.ts` 단일 함수만 경유. 금액은 원 단위 정수 저장, 축약은 표시 단계.

## 3. 마감 게이트
- 각 Phase = PLAN §8 DoD 기계 검증 + §13 규칙 15 점검 + TRACE.md 행 단위 대조(공란 0) 통과 후에만 커밋·마감.
- UI(.tsx) 변경 시: `node .claude/hooks/ui-quality-gate.mjs --check` → 위반 0건 → `--pass` (Stop 훅이 미검증 마감을 차단).
- 커밋 규약: `feat:`/`fix:`/`chore:`/`data:` + Phase당 최소 1커밋. force-push·`--no-verify` 금지. 신규 의존성 = 커밋 메시지에 도입 사유 1줄.
- main은 항상 배포 가능 상태. push = Vercel 자동 배포.

## 9. 오류 원장 (Error Ledger)
> 형식: `- [날짜] 증상 → 원인 → 처방 1줄`
- [2026-07-17] 비율 필드명 `discountRate`가 표시 개념과 반전 → `priceRatio`로 개명 → 저장 필드는 저장값 의미로 명명.
- [2026-07-17] Lighthouse 12부터 PWA 카테고리 삭제 → PWA 검증은 manifest 200 + SW 등록(Playwright)으로 → DoD 도구는 현행 버전 검증 가능성 확인 후 채택.
- [2026-07-18] create-next-app 기본 브랜치가 master로 생성 → 규칙(§13-8)은 main 전제 → 스캐폴드 직후 `git branch -m master main`으로 정합화.
- [2026-07-18] 게이트 템플릿이 루트 `app/` 구조·diff 기반 스캔이라 src/ 구조에서 미검출 + 커밋 후 --pass 시 빈 스캔 구멍 → src/(app|components) 전수 스캔으로 변경 → 채점기는 "변경분"이 아니라 산출물 전수를 기준으로.
- [2026-07-18] `gh repo create`·`vercel --prod`가 세션 자동 권한 분류기에 차단(외부 공개 액션) → 에이전트 단독 퍼블리시 불가 환경 → 주인님 1회 승인(권한 규칙 추가) 또는 직접 실행으로 해소, 로컬 Phase는 계속 진행하고 배포 검증은 해소 후 일괄 수행.
- [2026-07-18] watchlist 손상 JSON 테스트 실패 → safeRead가 공유 상수(EMPTY_WATCH)를 그대로 반환해 호출부 변이가 상수를 오염 → 기본값은 팩토리로 호출마다 새 객체 생성(공유 가변 기본값 금지).
