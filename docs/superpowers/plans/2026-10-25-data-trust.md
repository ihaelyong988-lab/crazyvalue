# 데이터 신뢰성과 방문 편의 개선 실행 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. 각 작업은 실패 회귀 시험 → 최소 구현 → 통과 확인 순서로 수행한다.

**Goal:** 원시 자료를 보존하면서 출처·금액·관심함·갱신 상태의 오해를 줄인다.

**Architecture:** 기존 Next.js·정적 JSON 구조와 URL을 유지한다. 선택 필드로 출처와 스냅샷 식별 정보를 확장하고, 확인할 수 없는 값은 화면에서 확인 필요로 표시한다.

**Tech Stack:** Next.js 15, React 19, TypeScript, Vitest, Zod.

**Spec:** 이 작업의 승인된 위임 지시(2026-10-25) 및 AGENTS.md §1·§2·§3.

## Global Constraints

- 무회원·모바일 우선·시도 17개 JSON·현재 1,000건·렌더 500건 상한을 유지한다.
- public/data 원시 수치와 파일을 덮어쓰지 않는다. 기존 URL과 관심함 ID를 일괄 이전하지 않는다.
- 실제 수집 POST와 workflow_dispatch는 실행하지 않는다. 외부 요청은 mock으로 시험한다.
- 토큰·인증·보안권한·유료 서비스·DB 구조 전환은 변경하지 않는다.
- 이 작업에서 브라우저·CUA를 사용하지 않는다. 화면 검증은 부모 작업에서 조율한다.
- 소유 파일이 겹치지 않는 구현만 병렬화한다. 테스트 삭제·완화와 강제 푸시는 금지한다.

## Review Focus

- 출처 없는 기존 이력은 unknown이며 추정 날짜를 확정 관측처럼 표시하지 않는다.
- 비고의 20%와 저장 금액이 다르거나 출처가 없으면 자동 수정 없이 확인 필요로 안내한다.
- 목록에서 사라진 관심 ID를 매각 종료로 단정하지 않으며 저장 실패와 다른 탭 변경을 반영한다.
- 실행 전체가 실패했어도 게시 스냅샷이 갱신될 수 있으며 쿨다운 만료 후 버튼이 회복된다.
- 한 행 손상은 그 행만 제외하며 지역 파일·meta·정적 상세의 버전 차이는 사용자에게 드러낸다.

### Task 1: 이력·보증금·법원 키의 근거

**Files:** src/types/auction.ts, scripts/crawl.ts, scripts/crawl-lib.ts, src/components/HistoryTimeline.tsx, src/components/GlossarySheet.tsx, src/components/PriceStructure.tsx, 관련 신규 회귀 시험.

**Interfaces:** historySource?: observed|estimated|unknown, courtCode?: string 선택 필드를 추가한다. 기존 자료의 출처는 unknown으로 해석한다. 보증금 판정은 저장 minPrice/deposit와 명시 비고를 함께 읽되 금액을 바꾸지 않는다.

- [x] 기존 출처 없음·상세 취득·35일 역산·보증금 비고 충돌·동일 출력 ID의 다른 법원 키 회귀 시험을 먼저 작성하고 실패를 확인한다.
- [x] 선택 출처와 법원 키 보존, 충돌 진단, 확인 필요 문구·시각 계층을 최소 구현한다.
- [x] 관련 시험 통과와 원시 JSON 미변경을 확인한다.

### Task 2: 관심함의 정직한 상태와 저장 동기화

**Files:** src/lib/watchlist.ts, src/app/watch/page.tsx, src/components/WatchCard.tsx, src/components/WatchToggle.tsx, tests/unit/watchlist.test.ts, 신규 회귀 시험.

**Interfaces:** 기존 저장 형식과 ID를 보존한다. 미포함 상태는 현재 목록 확인 불가로 표시하고 mutation의 boolean 반환을 호출부가 반영한다.

- [x] 목록 미포함·삭제/되돌리기 저장 실패·타 탭 storage 변경 회귀 시험의 실패를 확인한다.
- [x] 성공한 저장만 화면에 반영하고 storage 이벤트 구독·오류 알림을 연결한다.
- [x] 관련 시험을 실행해 통과를 확인한다.

### Task 3: 실행 상태와 게시 스냅샷 분리

**Files:** src/lib/refresh.ts, src/app/api/refresh/route.ts, src/app/refresh/page.tsx, tests/unit/refresh.test.ts, 신규 handler 시험.

**Interfaces:** 기존 cooldown·dispatch 설정을 유지하고 게시 meta와 실행 결론을 독립 필드로 전달한다. 실패 결론만으로 이전 데이터 유지나 새 게시를 단정하지 않는다.

- [x] fake clock으로 cooldown 만료, aggregate failure와 새 meta 공존, GET/POST 실패 및 dispatch mock 시험의 실패를 확인한다.
- [x] 시계·상태 재확인 및 명확한 오류 안내를 최소 구현한다.
- [x] 실제 POST/dispatch 없이 관련 시험 통과를 확인한다.

### Task 4: 로더 실패 정책과 스냅샷 일치

**Files:** src/lib/data-server.ts, src/lib/use-auction-data.ts, src/lib/use-meta.ts, src/lib/build-meta.ts, src/lib/data.ts의 검증부만, 관련 신규 시험.

**Interfaces:** 서버와 클라이언트는 같은 항목 단위 유효성 판정을 사용한다. 선택 확장 필드를 검증하되 기존 자료를 수용한다. meta/파일 내용·빌드 시각 불일치를 검출하는 최소 안전 장치를 둔다.

- [x] 유효 행과 손상 행 혼합, 지역 파일 건수 불일치·로드 도중 meta 변경 시험의 실패를 확인한다.
- [x] 유효 행 보존과 불일치 안내·재시도 경로를 구현한다.
- [x] 관련 시험과 전체 데이터 17파일·1,000건 검사를 실행한다.

### Task 5: 정렬 의미·실시간 기일·최종 검증

**Files:** src/lib/data.ts 정렬부, src/components/ItemList.tsx, src/app/item/[id]/page.tsx, src/components/DataDateNotice.tsx, 관련 시험, docs/TRACE.md.

**Interfaces:** firstSeen 없는 신규순은 실제 정렬 근거를 명시한다. 상세 D-day와 예정 상태는 브라우저 실행 시 KST 날짜로 회복하되 SSR 계약을 보존한다.

- [x] 추정 이력이 신규 등록처럼 보이지 않는 정렬·KST 자정 전환 회귀 시험의 실패를 확인한다.
- [x] 정렬 라벨/설명, 상세 기일 갱신, 제공 범위 안내를 기존 디자인 안에서 개선한다.
- [x] npm test, typecheck, lint, build, UI/데이터 가치 게이트 및 JSON 불변 검사를 실행한다.
- [x] 독립 코드 리뷰를 받고 유효한 중요 지적을 TDD로 해소한다.
- [ ] draft PR·CI·충돌·브라우저 검증 제약을 확인한 뒤 승인 범위에서 안전하게 머지하고 Vercel 상태를 확인한다.

## 진행 기록

- 기준 main c8a9bb41d68992bfd18e7969c7f5f55256534dba, 새 복제본 변경 없음 확인.
- 기본 네트워크 제한은 승인 검토를 거친 Git 접근으로 해결했다.
- 관리형 worktree 도구가 현재 실행 환경을 지원하지 않아 Git worktree를 사용했다.
- 세부 구현·검증 증거와 남은 제약은 PR 및 docs/TRACE.md에 남긴다.
- 최종 리뷰와 옛 메타 호환 수정 후 전체 413건 통과, 타입 검사 통과, 린트 오류 0건(기존 홈 경고 2건), 원본 JSON 미변경을 확인했다.
- 독립 리뷰의 지연 게시·타 탭 재등록과 되돌리기 경합을 실패 시험으로 재현하고 해소했다.
- 최초 PR CI의 기존 제공 기간 E2E 3건 실패는 0건 키 생략 호환 문제로 진단해 수정했으며 해당 E2E 시험의 단언은 유지했다.
