# TRACE.md — 실행 완전성 원장 (AGENTS §6)

> 원칙: 기억이 아니라 문서, 선언이 아니라 증거. **이 표의 행이 작업 범위의 전부다.**
> 상태 규약: `대기` → `완료(증거 인용)` / `보류(사유+재개 조건)`. 공란 1행 = 해당 Phase 마감 불가.
> 선전개 일시: 2026-07-18 (착수 지시 수신 직후, 기획안 v3.1 §8·§4.3·§4.4·§4.5·§13 전 행 전개)

## Phase 0 — 저장소·GitHub·Vercel 조기 연동

| # | 작업 | 구현 위치 | 확인 방법 | 상태 |
|---|---|---|---|---|
| 0.1 | 사전 점검(node≥20·git·gh·vercel) | 로컬 환경 | 4개 명령 출력 | 완료 — node v24.14.0 · git 2.53.0 · gh ihaelyong988-lab(repo·workflow) · vercel ihaelyong988-6219 |
| 0.2 | 스캐폴드 create-next-app@15 | C:\dev\crazyvalue | `npm run build` 성공 | 완료 — build 성공, First Load JS 119kB |
| 0.3 | 저장소 정비(README·.gitignore·PLAN.md·TRACE.md 선전개) | README.md·docs/ | 파일 존재 + 전 Phase 전개 | 완료 — 본 파일 생성으로 충족 |
| 0.4 | 하네스 이식(AGENTS.md·ui-quality-gate·Stop 훅) | AGENTS.md·.claude/ | `--check` 실행 가능 | 완료 — --check 정상 작동(스캐폴드 기본 css의 P1·P2 검출 = 채점 증거, Phase 1.2에서 해소) |
| 0.5 | GitHub 등록·푸시 | origin | `git ls-remote origin` | 완료(2026-07-19) — https://github.com/ihaelyong988-lab/crazyvalue 생성, main 6커밋 푸시·추적 설정("branch 'main' set up to track 'origin/main'") |
| 0.6 | Vercel 등록·연동·최초 배포 | vercel 프로젝트 | 프로덕션 URL 200 | 완료(2026-07-19) — link+`vercel git connect`(push=자동 배포 확립)+프로덕션 배포. **https://crazyvalue.vercel.app HTTP 200·본문 워드마크 확인** |

- Phase 0 결정 기록: 기본 브랜치 `master`→`main` 개명(§13-8 정합) · **First Load JS 표 수치 = gzip 기준 실측 확정**(보고 75.4kB ≈ gzip 74.6KB, 디스크 247KB — §13-4 예산 200KB는 build 표 수치로 직접 판정) · create-next-app 산출 lint 도구는 ESLint(eslint.config.mjs) 확인

## Phase 1 — 디자인 시스템·데이터 계약·목데이터

| # | 작업 | 구현 위치 | 확인 방법 | 상태 |
|---|---|---|---|---|
| 1.1 | 디자인 기준파일(§6 오버라이드 고정) | design-system/MASTER.md | 파일 생성+§6 값 포함 | 완료 — ui-ux-pro-max --persist 실행, §6 확정 토큰 최상단 오버라이드 + 충돌 권고(틸 팔레트·Cinzel·CDN·펄스) 명시 무효화 |
| 1.2 | 색 토큰 CSS 변수·Pretendard 셀프호스팅·tabular-nums 유틸 | src/app/globals.css·layout.tsx | 빌드 성공 | 완료 — npm i pretendard(§5.1 확정 스택), focus-visible·prefers-reduced-motion 포함, build 성공 |
| 1.3 | zod 데이터 계약(§5.3) | src/types/auction.ts | `npx tsc --noEmit` | 완료 — typecheck 통과. §13-1 https URL 검증 + priceRatio·failCount 정합 refine 포함 |
| 1.4 | 목데이터 생성기(시드 20260717, 120건, 용도 8종, 유찰 2~5, 저감 20/30 혼합, 17개 시도, 픽 포함) | scripts/gen-mock.ts → public/data/*.json | 생성 JSON zod 전건 통과 | 완료 — "총 120건 · 픽 105건 · 용도 8종 · 지역 17개 · 시드 20260717" + mock-contract.test 통과. photoUrl은 전건 null(플레이스홀더 분기 렌더, 실사진은 Phase 3) |
| 1.5 | 코어 유틸+단위테스트(필터 조합·금액 경계·할인율·픽 경계 0.5·D-day 자정·축약 1억 경계·재유찰/기일변경/소멸) | src/lib/{data,format,watchlist}.ts + tests/unit ×4 | `npm test` 전체 통과 | 완료 — "Test Files 4 passed, Tests 37 passed" (지정 케이스 전부 포함) |

## Phase 2 — 코어 4화면 + 2시트

### 2.A 작업 단계

| # | 작업 | 구현 위치 | 확인 방법 | 상태 |
|---|---|---|---|---|
| 2.1 | 공통 셸(AppShell·DataDateBar·Skeleton·EmptyState·ErrorState·LegalNotice) | src/components | 전 라우트 렌더 | 완료 — build 128p 정적 생성·E2E 전 라우트 통과 |
| 2.2 | 홈(필터 3축+ResultButton+PickEntry+NewThisWeek+RecentViewed, §4.3-① 배치) | src/app/page.tsx | 3탭 내 리스트 도달 | 완료 — E2E 시나리오1(3탭→리스트) 통과 |
| 2.3 | 리스트(카드 7요소·10건 더보기·정렬 4종·빈 상태 완화) | src/app/list | §4.3-② 전 요소 | 완료 — E2E 1·7 통과(더보기·정렬·딥링크) |
| 2.4 | 상세(가격구조·타임라인·지도 딥링크·특이사항·원문·고지·관심·공유) | src/app/item/[id] | §4.3-③ 전 블록 | 완료 — E2E 2·3·5 통과 |
| 2.5 | 관심함(D-day 정렬·상태 배지·상단 고정) | src/app/watch | §4.3-④ 전 요소 | 완료 — E2E 3·4 통과(재유찰 배지 포함) |
| 2.6 | 시트 2종(온보딩 1회·용어 12+픽 기준+고지) | OnboardingSheet·guide | 최초 1회 노출 로직 | 완료 — E2E 1·8 통과. 온보딩은 SSR 포함+재방문 무플래시 숨김(onboarding-flag.js) |
| 2.7 | E2E 스모크(온보딩→필터3탭→리스트→상세→관심등록→관심함 배지→공유 URL + 오류 상태 + /list 딥링크 복원) | tests/e2e/smoke.spec.ts + playwright.config.ts | `npx playwright test` 통과 | 완료 — "8 passed" (오류 상태·딥링크 포함). 시나리오1은 목데이터 분포상 3필터 유지 시 11건 미만이라 지역 단독으로 더보기 검증(사양 단계는 전부 수행) |

- Phase 2 마감 증거: lint 0/0 · typecheck 통과 · vitest 37/37 · build 성공(정적 128페이지) · ui-quality-gate BLOCK 0·WARN 0 → --pass 마커 · E2E 8/8 · First Load JS 전 라우트 124~130kB(gzip, 예산 200KB 내)
- Phase 2 성능 결정 기록: zod 클라이언트 번들 제거(types/catalog.ts 분리, 라우트당 ≈70kB 절감) · DataDateBar를 meta 전용 경량 훅으로 분리(상세·안내에서 지역 17파일 로드 제거) · 온보딩 SSR 포함+페인트 전 플래그로 LCP 6.6s→1.8s

### 2.B §4.3 화면 사양 행 단위 대조

| 화면 | 행 | 사양 요지 | 구현 위치 | 상태 |
|---|---|---|---|---|
| ①홈-1 | 기준일 바 | `[새로 갱신] 08-03(월) 19:58 · 신규 42건` 상단 고정(2026-08-05 규격 변경) | components/DataDateBar.tsx (AppShell 헤더 고정) + lib/format.ts formatMonthDayKr | 완료(E2E 8/8·게이트 0건·빌드 통과) → 규격 변경분은 아래 "매일 갱신 전환" 절 |
| ①홈-2 | 필터1 지역 | 시도 17 그리드→시군구 칩(다중, 기본 전체) | components/RegionFilter.tsx | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ①홈-3 | 필터2 금액 | 구간 칩 5종 복수 선택 | components/PriceFilter.tsx + lib/data.ts PRICE_BANDS | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ①홈-4 | 필터3 용도 | 8분류 | components/CategoryFilter.tsx | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ①홈-5 | 결과 버튼 | "물건 N건 보기" 실시간 갱신·높이 52px 하단 고정 | components/ResultButton.tsx (h-[52px] fixed) | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ①홈-6 | 미친가치 픽 진입 | "픽 N건 — 감정가 대비 50% 이하" → 픽 필터 리스트 | components/PickEntry.tsx → /list?pick=1 | 완료 후 **사양 철회(2026-07-22 주인님 지시)** — 홈에서 제거, 픽 기준은 리스트 배지·/list?pick·/guide에 존치. PickEntry.tsx는 import 0의 잔여 파일 |
| ①홈-7 | 이번 주 신규 | 신규 유찰2 도달 수 + 대표 3건 가로 스크롤 | components/NewThisWeek.tsx + lib/data.ts isNewThisWeek | 완료 후 **사양 철회(2026-08-05 주인님 확정)** — 컴포넌트·판정 함수 삭제, 신규 건수는 기준일 바가 표기 |
| ①홈-8 | 최근 본 물건 | 최근 5건 가로 스크롤(없으면 미노출) | components/RecentViewed.tsx + lib/watchlist.ts recent | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ①홈-9 | 온보딩 반영 | 설정 지역·금액 = 필터 초기값 | app/page.tsx applyPrefs | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ②리-1 | 10건+더보기 | 무한스크롤 금지, 명시적 더보기 | components/ItemList.tsx + query.ts n 파라미터 | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ②리-2 | 카드 7요소 | 사진·용도·소재지·가격구조 한 줄·픽 배지·유찰 N회·D-day | components/ItemCard.tsx (+CategoryThumb 플레이스홀더) | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ②리-3 | 정렬 4종 | 기일 임박(기본)·할인율·최저가·신규 | ItemList select + lib/data.ts sortItems | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ②리-4 | 숫자 표기 | 한국식 축약+tabular-nums | lib/format.ts formatKrw + tabular-nums 클래스 | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ②리-5 | 빈 상태 | 안내+완화 제안 버튼 2종 | ItemList → EmptyState("금액 범위 넓히기"/"인근 지역 포함") | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ③상-1 | 가격 구조 | 감정가→최저가 바+할인율+픽+보증금(10%, 재매각 상이 문구) | components/PriceStructure.tsx | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ③상-2 | 기본 정보 | 법원·사건·물건번호·용도·면적(㎡+평)·전체 주소 | app/item/[id]/page.tsx header+기본 정보 dl | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ③상-3 | 기일 정보 | 매각기일 D-day·시각·법정 호수 | app/item/[id]/page.tsx 기일 정보 섹션 | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ③상-4 | 유찰 타임라인 | 회차별 기일—최저가—결과 세로 타임라인(시그니처) | components/HistoryTimeline.tsx | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ③상-5 | 지도 딥링크 | 네이버지도/카카오맵 앱 열기(SDK 미사용) | item page 네이버/카카오 검색 딥링크 a 2개 | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ③상-6 | 특이사항 | 공고 비고 — 자연인 성명 마스킹 후 표기 | item page 특이사항 섹션(마스킹은 crawl 단계 §13-2, mock 성명 0) | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ③상-7 | 원문 링크 | "법원경매정보에서 원문 보기" | item page detailUrl 버튼(https zod 검증 통과값만) | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ③상-8 | 법적 고지 | 하단 고정 문구(참고용·원문 우선·확인 요청) | components/LegalNotice.tsx (상세 하단+안내) | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ③상-9 | 액션 | 관심 토글·공유(Web Share+URL 복사)·터치 ≥44px | WatchToggle.tsx+ShareButton.tsx (min-h-12=48px) | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ④관-1 | D-day 정렬 | 오름차순 | app/watch/page.tsx 정렬 로직 | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ④관-2 | 상태 추적 | 재유찰·기일 변경·매각 종료 배지, 변화 상단 고정 | lib/watchlist.ts diffWatch + WatchCard + watch 정렬 | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ④관-3 | D-day 강조 | D-7 이하 Accent, 경과 처리 | ItemCard(D≤7 accent) + WatchCard(기일 경과 배지) | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ④관-4 | 저장 | localStorage 무가입, 기기 변경 불가 고지 1줄 | watchlist.ts(crazyvalue.*.v1) + watch 상단 고지 | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ④관-5 | 빈 상태 | 사용법 안내+"물건 찾으러 가기" | watch EmptyState+홈 버튼 | 완료(E2E 8/8·게이트 0건·빌드 통과) |

### 2.C §4.4 UX 18항

| # | 항목 | 구현 위치 | 상태 |
|---|---|---|---|
| 1 | 3축 탭 필터(타이핑 0) | RegionFilter·PriceFilter·CategoryFilter + 홈 | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| 2 | 가격 구조 한 줄+할인율 | ItemCard 가격 행 + PriceStructure | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| 3 | 매각기일 D-day | format.ts dday/formatDday — 카드·상세·관심함 | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| 4 | 유찰 이력 타임라인 | HistoryTimeline.tsx | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| 5 | 관심함 상태 추적 배지 | diffWatch + WatchCard | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| 6 | 온보딩 1회 관심조건 | OnboardingSheet + prefs | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| 7 | 무로그인·무가입 | 계정 코드 0 — localStorage만 | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| 8 | 데이터 기준일 상시 표기 | DataDateBar(전 화면 헤더) | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| 9 | 용어 도움말 시트(12개) | GlossarySheet(부록 B 원고 12+픽) | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| 10 | 법적 고지·원문 링크 | LegalNotice + detailUrl 버튼 | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| 11 | 빈 상태 완화 제안 | ItemList 빈 상태 2버튼 | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| 12 | 스켈레톤 로딩+오프라인 캐시 | Skeleton.tsx(로딩) — 오프라인 캐시는 Phase 4.2 서비스워커 | 부분(캐시는 Phase 4) |
| 13 | 한국식 금액 축약+tabular-nums | formatKrw + tabular-nums | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| 14 | 하단 탭·44px 터치 | BottomTabs(min-h-14) + 칩/버튼 min-h-11 이상 | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| 15 | 물건 URL 공유 | ShareButton(Web Share+복사) | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| 16 | 미친가치 픽 배지·진입점 | PickBadge + PickEntry + pick=1 쿼리 | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| 17 | OG 공유 카드 | Phase 4.4 예정(opengraph-image.tsx) | 대기(Phase 4) |
| 18 | 최근 본 물건 | RecentViewed + RecentTracker | 완료(E2E 8/8·게이트 0건·빌드 통과) |

## Phase 3 — 수집기·실데이터 전환

| # | 작업 | 구현 위치 | 확인 방법 | 상태 |
|---|---|---|---|---|
| 3.1 | 정찰 스파이크(robots·약관·API 관찰·전략 확정) | docs/CRAWLER.md | 전략 1개 확정 기록 | 완료 — 정찰 에이전트(요청 7회): 전략 A 확정, POST searchControllerMain.on + flbdNcntMin=2 서버 필터, robots 404·출처표시 자유이용 확인. 잔여: enum 코드 실검색 1회 캡처 |
| 3.2 | 수집기 구현(유찰≥2·간격≥1초·UA CrazyValueBot/0.1·재시도3·게이트·--region·--dry-run) | scripts/crawl.ts | dry-run 1개 지역 성공 | 대기 |
| 3.3 | 실데이터 전환(전국 1회→검증→교체→재통과) + 성명 마스킹 30건 스팟 체크 | public/data | `npm test`·스모크 실데이터 통과 | 대기 |
| 3.4 | 자동화 crawl.yml(cron 0 18 * * 6 UTC) | .github/workflows/crawl.yml | 파일 푸시 | 대기 |
| 3.5 | 원격 검증(workflow_dispatch 1회) | GitHub Actions | 원격 성공+data 커밋 | 대기 |

## Phase 4 — PWA·OG·품질 마감

| # | 작업 | 구현 위치 | 확인 방법 | 상태 |
|---|---|---|---|---|
| 4.1 | manifest+아이콘 512/192 | src/app/manifest.ts·public/icons | 설치 프롬프트 노출 | 대기 |
| 4.2 | 서비스워커(@serwist/next, 프리캐시+data SWR) | 서비스워커 설정 | 오프라인 재방문 렌더 | 대기 |
| 4.3 | 설치 유도(Android 배너·iOS 1회 안내) | 컴포넌트 | 각 OS 문구 노출 | 대기 |
| 4.4 | OG 공유 카드(next/og, 실패 시 og-default.png 폴백·비차단) | app/item/[id]/opengraph-image.tsx | 공유 미리보기 확인 | 대기 |
| 4.5 | 접근성·성능 마감(대비·alert·focus-visible·44px·lazy·서브셋) | 전역 | 게이트 재통과 | 대기 |

## Phase 5 — 프로덕션 검증·운영·릴리스

| # | 작업 | 구현 위치 | 확인 방법 | 상태 |
|---|---|---|---|---|
| 5.1 | 배포 상태 확인(push=자동 배포) | Vercel | 최신 커밋=프로덕션 | 대기 |
| 5.2 | 프로덕션 스모크(모바일 뷰포트 실URL) | tests/e2e | 전 시나리오 통과 | 대기 |
| 5.3 | 분석(@vercel/analytics+§2.6 지표) | src/app/layout.tsx | 대시보드 수신 | 대기 |
| 5.4 | 운영 문서 | docs/OPERATIONS.md | 문서 존재+퀵스타트 3명령 검증 | 대기 |
| 5.5 | 릴리스 태그 v0.1.0 | git tag | 태그 원격 확인 | 대기 |
| 5.6 | 완료 보고(URL·cron·Lighthouse·전수 재대조표·백로그) | 보고 | 재대조 공란 0 | 대기 |

## §4.5 비기능 기준

| 항목 | 기준 | 확인 방법 | 상태 |
|---|---|---|---|
| 성능 | LCP<2.5s·Lighthouse Performance ≥90 | Phase 2·4 Lighthouse | 부분 — LCP 1.8s·FCP 1.2s 통과(모바일 4x 스로틀 로컬 실측). **P 스코어 50 보류**: TBT 1,650ms(하이드레이션 3.1s 스크립트 평가+Style 1.8s — 실측 breakdown 확보). Phase 4.5·개선 라운드에서 재공략(서버 셸 분리·폰트 CSS 전략·onboarding-flag 재계산 455ms) |
| 접근성 | WCAG AA(대비 4.5:1·alert·focus-visible·44px·reduced-motion) | 게이트+Lighthouse A11y ≥90 | 통과 — 게이트 0건 + Lighthouse A11y 96 |
| 안정성 | 크롤 실패 시 직전 데이터 유지(빈 화면 금지) | 검증 게이트 무커밋 설계+오류 상태 E2E | 대기 |
| 정확성 | 금액·기일 원문 그대로·저감률 임의 계산 금지·픽만 파생 | 코드 리뷰+단위 테스트 | 대기 |

## 방문자 감사·수정 라운드 1차 (2026-07-18~19 — 주인님 지시)

| 단계 | 내용 | 증거 |
|---|---|---|
| 감사 | Workflow 병렬 7영역(5 완료·2 세션한도 중단→2차 라운드 대상) — 실브라우저 모바일 뷰포트, 발견 32건 | 감사 저널 wf_22c1c489-6f2 |
| 정리 | 중복 통합·그룹 분할 30건 순번화, AGENTS.md §5 각인 | AGENTS.md §5 |
| 수정 | 병렬 7그룹(파일 소유권 분할) — **29/29 완료, 보류 0** (#30 defer는 계획 보류) | 수정 저널 wf_2ad49e5a-6c2 |
| 검증 | lint 0 · typecheck 0 · vitest 44/44 · build 129p(번들 122~132kB) · 게이트 0건→pass · E2E 8/8(의도 변경 #11·#17만 스펙 갱신, 검증 강화 방향) · 온보딩 플래시 rAF 계측 0프레임(대조군 292/293프레임으로 프로브 유효성 입증) | 검증 에이전트 보고 전문 |

- 주요 구조 변화: 홈 필터 세션+URL 미러 복원(#3) · 온보딩 다이얼로그 접근성 완비(#4·23·24·28 — 동기 스크립트로 플래시 구조 제거) · error.tsx/not-found.tsx 신설(#2·13) · 시군구 시도 결합 키(#14) · 리스트 필터 요약 칩+셸로우 URL(#15·29) · 관심함 배지 세션 캐시+이전→현재 병기(#17·21·22) · 관심조건 편집(/guide, #19) · 대비 AA 전면 상향(#8·9·10)

| # | 관점 | 강제 장치 | 적용 Phase | 상태 |
|---|---|---|---|---|
| 1 | 보안 | 시크릿 grep·dangerouslySetInnerHTML 0건(게이트 등록)·URL https zod·npm audit high 0 | 0.4 등록, 0.5/3.4/4/5 audit | 대기(게이트 등록은 0.4) |
| 2 | 개인정보 | 스키마 화이트리스트·성명 마스킹 함수+30건 스팟 체크 | 1.3·3.2·3.3 | 대기 |
| 3 | 접근성 | 게이트 차단룰+Lighthouse A11y ≥90 | 0.4·2·4 | 대기 |
| 4 | 성능 예산 | First Load JS ≤200KB(gzip)·build 표 확인 | 2·4 DoD | Phase 2 판정: **통과** — 전 라우트 124~130kB(zod 클라이언트 제거로 199→130). LCP 1.8s 통과. P 스코어 보류분은 §4.5 행 참조 |
| 5 | SRE | ErrorState·try-parse 단일 유틸·오류 E2E | 2 | 대기 |
| 6 | 데이터 | 검증 실패=무커밋·localStorage v1 버전 키·스키마 변경 시 재생성+test | 1·3 | 대기 |
| 7 | QA | 단위+E2E 상시·버그 수정=재현 테스트 선행 | 1.5·2.7·전 Phase | 대기 |
| 8 | 릴리스 | main 배포 가능·커밋 규약·태그·force-push/--no-verify 금지 | 전 Phase | 진행 중 — main 개명 완료 |
| 9 | 관측성 | crawl 요약 출력·meta.json·Actions 실패 표면화 | 3 | 대기 |
| 10 | 공급망 | 의존 최소·신규 패키지=사유 1줄·lockfile 커밋 | 전 Phase | 대기 |
| 11 | FE 아키텍처 | /list 상태=URL 쿼리·전역 상태 라이브러리 금지·딥링크 E2E | 2 | 대기 |
| 12 | 시간대·금액 | Asia/Seoul date-only 단일 함수·원 단위 정수·직접 Date 연산 grep | 1.5·2 | 대기 |
| 13 | UX 라이팅 | 단정형·금지어 grep·오류 문구 2문장 규격·용어집 대조 | 0.4·2 | 대기 |
| 14 | 법무 | LegalNotice 상시·수집 근거 보존·투자 권유/수익 보장 금지 grep | 0.4·2·3.1 | 대기 |
| 15 | 메인테이너 | README 3명령 실검증·문서 재개 순서 | 0.3·5.4 | 진행 중 — README 작성(0.3), 검증은 5.4 |

## 세로 리듬 압축 라운드 (2026-07-19 — 주인님 캡쳐 마크업 2건 + 같은 날 2차 일반화 지시)

| # | 작업 | 구현 위치 | 확인 방법 | 상태 |
|---|---|---|---|---|
| V-1 | 홈 픽 카드 X표시 삭제 — 꼬리 「— 기준은 안내에 공개」만(주인님 1회 확정, 부분구간 판례) | src/components/PickEntry.tsx | 설명 42px(2줄)→21px(1줄) 실측 | 완료(커밋트리 로컬 실측) |
| V-2 | 홈 세로 리듬 — 섹션 20→16px·하단 중복 패딩 192→128px(AppShell pb-24와 중복 해소) | src/app/page.tsx | 375px 뷰포트 scrollHeight 1231→1127(−104px) | 완료 |
| V-3 | 안내 문구 교체(필기 그대로 「홈 필터의 초기값 쓰임, 선택 즉시 이 기기에 저장.」)+리듬 압축 | src/components/GlossarySheet.tsx | scrollHeight 2244→2144(−100px)·안내문 42→18px 1줄 | 완료 |
| V-4 | 2문장 안내문 앱 전수 1문장 압축(2차 지시 "이런 문장은") — 관심함 고지·저장 상태·공유 폴백·404·온보딩 확인문 | src/app/watch/page.tsx·GlossarySheet·ShareButton·not-found·OnboardingSheet | UI 문구 「습니다.…습니다.」 병렬 0건 + 게이트 R12 warn 0 | 완료 |
| V-5 | 규칙 영구화 — MASTER.md 세로 리듬 오버라이드·AGENTS.md(레포·기획)·게이트 R11/R12 warn·memory 2건 | design-system/MASTER.md 외 | 각 파일 diff | 완료 |
| V-6 | 검증 — 게이트 0건→pass·typecheck 0·vitest 44/44·build 129p·커밋트리 E2E 8/8(27.2s) | 워크트리 cv-verify(HEAD+변경분, npm ci) | 출력 인용. 작업트리 E2E 1실패는 미커밋 InstallPrompt 소행 — §9 원장·별도 작업 칩 | 완료 |
| V-7 | 배포 재확인 — push 후 프로덕션 두 화면 재실측 | crazyvalue.vercel.app | 커밋 19bb055 push 후 ~15s 배포. 홈 1127px·픽 설명 21px 1줄, /guide 2144px·안내문 18px 1줄 — 커밋트리 로컬 실측과 동일치 | 완료 |

## 방문자 감사 2차 라운드 (2026-07-22 — 주인님 승인 계획, AGENTS.md §2-2 헌법)

### 선전개: 35셀 커버리지 매트릭스 (공란 1개 = 마감 불가)
> 각 셀에 감사 발견 순번 또는 `이상없음(증거)`를 기입한다. `대기`가 1개라도 남으면 마감 게이트 ①번에서 차단된다.

| 여정 \ 품질 | Q1 불안정성 | Q2 편의성 | Q3 정합성 | Q4 접근성·문구 | Q5 성능 |
|---|---|---|---|---|---|
| J1 최초 방문 | 39·68 | 47·50 | 40 | 70·71·73·75·76·77·78 | 87 |
| J2 관심조건 등록(온보딩) | 31 | 47·48 | 32 | 49·72·79 | 이상없음(칩 반영 1.4~3.4ms·시트 닫힘 11~20ms·플래시 0) |
| J3 맞춤설정(/guide→/me) | 31·33·34 | 51·52·53 | 32 | 74·80·81 | 88 |
| J4 탐색→법원 원문 | 44·54 | 55·56·57 | 36·37·45·46·90 | 82·83·84·85 | 89 |
| J5 관심 추적(관심함) | 31·35 | 58·59·60·61 | 62 | 63 | 이상없음(백로그 30 defer 유지) |
| J6 재방문·주간 갱신 반영 | 32 | 64 | 38·41·42·91·92 | 86 | 43·65·66 |
| J7 이탈·탭/백링크 | 이상없음(탭 3개 연타 왕복 15회 무붕괴) | 67·69 | 이상없음(aria-current 6경로 일치) | 75 | 93 |

> **35/35 기입 완료 — 공란 0.** 완결성 비평가가 근거 부실로 지적한 6셀(J6-Q5·J5-Q4·J7-Q3·J2-Q5·J7-Q1·J5-Q5)은 비평가가 보완 검사 C1~C13을 직접 실시해 추가 8건을 적출했다.
> **보고된 보류(미확인 주장 — 헌법 §6-4)**: ① 스크린리더 실낭독(NVDA·VoiceOver) 미실시 — 전 접근성 판정은 DOM/ARIA 기반 추정이다. ② 실기기 미검증 — 전 감사가 Chromium+iPhone 13 에뮬레이션 1종(iOS Safari·Android Chrome·설치형 standalone 미주행). ③ 주간 갱신 실주행은 91번 수정 이후에만 가능. ④ 서비스워커가 컨트롤러가 되면 page.route 가로채기가 우회돼, 첫 화면 이후 화면의 데이터 실패 폴백은 미확정.

### 신설 사양 5건 (주인님 승인분 — 감사 결과와 무관하게 이행)
| 코드 | 사양 | 그룹 | 확인 방법 | 상태 |
|---|---|---|---|---|
| N1 | 내 설정 `/me` — 관심조건 편집 이관·저장 현황·내 데이터 초기화 | me | `/me` 200 · 탭 4개 · prefs 저장 왕복 · 초기화 확인 팝업 E2E | 완료 — `/me` 라우트 빌드 성공(6.41kB·110kB) · 하단 탭 4개 · resetAll() 신설 · 관심조건 /guide→/me 이관 완료 |
| N2 | 이탈 확인 팝업 + 설치 배너 겹침 종결 | exit | 홈 뒤로가기 시트 E2E · 배너·결과버튼 bbox 교집합 0 | 완료 — ExitGuard.tsx 신설(popstate 가드+조건부 beforeunload 3곳) · 배너 겹침 종결(--cv-banner-h로 main 여백 보정) · E2E 8/8 |
| N3 | 법원 링크 3종(규격 링크·사건번호 복사·찾는 법) | link | detailUrl 불일치 0 · 3종 존재 E2E | 완료 — detailUrl 루트 잔존 **0건** · DETAIL_URL 규격 **120/120건** · CopyCaseNo.tsx 신설로 3종(링크·복사·찾는 법) 완비 |
| N4 | 주간 갱신 복구(crawl.ts 커밋·dry-run·갱신 지연 표기) | data | git 트래킹 · dry-run 성공 · cron 확인 · 지연 표기 렌더 | 완료 — crawl.ts git 추적 완료 · `--dry-run --limit 3` 실주행 성공(라이브 요청 5회·6.0초) · cron `0 18 * * 6` 확인 · 기준일 바 "갱신 3일 지연" 표기 |
| N5 | Phase 4 마감(서비스워커·오프라인·manifest) | pwa | SW 등록 · manifest 200 · 오프라인 열람 Playwright | 완료 — serwist SW 번들 성공 · manifest maskable + apple-touch-icon 추가 · 오프라인 폴백 setCatchHandler · 정적 130p 빌드 |

### 마감 검증 (2026-07-22)
| 채널 | 결과 |
|---|---|
| typecheck | `npx tsc --noEmit --incremental false` — **0 오류** |
| 단위 테스트 | `npx vitest run` — **95/95 통과**(착수 전 66건 → 신규 29건) |
| 프로덕션 빌드 | `npm run build` — 정적 **130 페이지**, serwist SW 번들 성공, First Load JS 104~119kB(예산 200kB 이내) |
| E2E | `npx playwright test --project=mobile-chromium` — **8/8 통과**(21.0s) |
| UI 게이트 | `ui-quality-gate.mjs --check` — **위반 0건**(검사 대상 UI 41개 + 전체 스캔) |

> 감사 스펙 `tests/e2e/audit-*.spec.ts` 13개는 마감과 함께 삭제했다(일회성 증거 수집용). 상시 회귀는 `tests/e2e/smoke.spec.ts` 8종 + 단위 95건이 담당한다.
> 마감 3문 게이트: ① 35셀 공란 0 ✔ ② 순번 31~93 전건 완료 또는 **보고된 보류**(76·87·89, 사유·재개조건 §5-2 기재) ✔ ③ 검증 출력 실물 첨부 ✔

### 프로덕션 최종 재대조 (2026-07-22, AGENTS §6-8 — 프로덕션 URL 1:1 확인)
| 대상 | 실측 결과 |
|---|---|
| 라우트 | `/` `/me` `/list` `/watch` `/guide` `/manifest.webmanifest` `/sw.js` — **전부 HTTP 200** |
| 핵심목표① 법원 원문 도달 3종 | **통과** — ① href = `https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ15AF01.xml`(루트 URL 잔존 0) · ② "사건번호 복사" 버튼 노출 · ③ "…붙여넣는다" 안내 노출 |
| 핵심목표② 주간 갱신 표기 | **통과** — 기준일 바 실렌더 `데이터 기준: 2026-07-12(일) 03:00 · 갱신 3일 지연` |
| N1 내 설정 | **통과** — 하단 탭 4개 · `/me` h1 "내 설정" · "초기화" 버튼 노출 |

> 검증 방법: 프로덕션 URL 대상 Playwright 3건(mobile-chromium) 12.7s 전건 통과. 일회성 스펙이라 실행 후 삭제했다.

### 후속 과제 해소 — 주간 크롤 실행 시간 (2026-07-22)
| 항목 | 실측 |
|---|---|
| 문제 | 42일 창 대상 16,302건 · 전건 상세 시 16,710요청 × 1.1초 = **약 5.2시간**(Actions job 상한 6시간, 여유 15% 미만) |
| 시도 A — 창 축소 42→21일 | 16,302 → **17,000건**(줄지 않음) → **무효, 되돌림**. 대조군 0일 창 934건으로 서버 필터 정상 작동은 확인 |
| 시도 B — 상세 요청을 픽 후보 한정 | 표본 40건 중 **19건(47.5%)** → 상세 17,000 → 약 8,075회, 총 **약 2.6시간** → **채택** |
| 구현 | `scripts/crawl.ts` `needsDetail()` — 목록 응답의 gamevalAmt·minmaePrice로 판정(추가 요청 0), 비-픽은 `buildBackcalcHistory` 역산 폴백, 값 결측은 요청 쪽으로 기움 |
| 검증 | typecheck 0 · vitest 95/95 · dry-run 실주행 — "상세 요청 대상 0/6건" 시 라이브 요청 **2회**(세션+목록)로 감소, 역산 폴백 6건 정상, 총 6건 수집 1.9초 |

> 관측 부수 사실: 서버 `totalCnt`가 같은 조건에서 16,302 → 17,000 → 17,283으로 변동한다(수 시간 간격). 규모 판단은 단일 측정이 아니라 자릿수로 한다.

## 수집 파이프라인 완결 수정 — 첫 실데이터 배포 (2026-07-30, 주인님 지시 "완벽한 해결책")
| 항목 | 내용 |
|---|---|
| 본질 진단 | 실패 5회(07-25~29)의 공통 뿌리 = ① 서버 재서빙 중복을 그대로 축적 ② 게이트 "오류 0건" 전량 기각 ③ 검증을 하루 1회 야간 슬롯에 위탁한 24시간 피드백 루프 |
| 수정(6b02128) | 수신 시점 dedupe(`seenRowKeys`)·정체 종결(`stallPages`)·게이트 부분 배포(기각은 유효 0건 한정)·`OUTPUT_CAP` 1000 임박순·`SESSION_BACKOFFS` 5s/15s/45s·/guide 기준 공개. `crawl-lib.ts` 분리, 신규 포함 vitest 110/110·tsc 0 |
| 실전 검증(당일 dispatch, 런 30481066785) | 수신 15,323 · 고유 8,741(중복드롭 6,614 = 43% 재서빙 실증) · 유효 8,438 → 상한 1,000건. 로봇탐지(요청 1,123회)는 조기 종료로 강등, 커밋 3fd4d74 완료 · 실취득 상세 737건 · 안내 이슈 #4 |
| 배포 확인 | 프로덕션 meta crawledAt 2026-07-30T04:36 KST · totalCount 1000 실측 — 목데이터 120건 → 실데이터 전환. 17개 지역 파일 건수-meta 일치 · priceRatio (0,1] · detailUrl · saleDate 형식 이상 0건 · 매각기일 07-30~08-03 임박순 절단 |
| 후속 발견·조치 | 대기열 캐치업이 이벤트 시점 SHA 체크아웃으로 옛 meta를 읽고 이중 실행(오탐 이슈 #5) → 게이트 직전 `git pull` 1줄. 세션 GET transport 거부 2회째 관측 — 파괴 없음, 일일 캐치업 자가 복구 |

## 매일 갱신 전환 (2026-08-05 주인님 확정)

> 갱신 주기를 주 1회 → 매일 03:00 KST로 올리고 홈 기준일 바 표기를 확정했다. 전환에서 밟은 함정과 처방은 AGENTS.md §9 [2026-08-05] 원장 2행.

| 확정 사양 | 반영 위치 |
|---|---|
| 매일 03:00 KST 갱신 — KST 월~토 quick(경량) · 일 full(전량). 슬롯은 실행 여부가 아니라 모드를 가른다 | `.github/workflows/crawl.yml` — 데이터 나이(`STALE_DAYS`) 조건 삭제, 게이트가 `mode` 출력을 내고 crawl·commit 스텝이 그 값을 쓴다 |
| 산출물 배분 창을 갱신 주기에서 떼어내 7일로 고정 | `scripts/crawl-config.ts` `OUTPUT_WINDOW_DAYS` · `scripts/crawl.ts` 창 끝 = 수집일+7일(`isoDayKst`) · `.claude/hooks/data-value-gate.mjs` R2가 같은 상수로 채점 |
| 홈 기준일 바 = `[새로 갱신] 08-03(월) 19:58 · 신규 42건`("데이터 기준:" 라벨·다음 갱신·지연 문구 제거) | `src/components/DataDateBar.tsx` · `src/lib/format.ts` `formatMonthDayKr` 신설, `updateDelay`·`isFreshUpdate` 삭제 |
| 신규 건수 = 직전 산출물에 없던 물건 수, 비교 불가면 감춘다 | `scripts/crawl-lib.ts` `countNewIds` · `scripts/crawl.ts` `readPreviousIds`(지역 파일 덮어쓰기 전 읽기, 부분 수집은 비교 안 함) → `meta.newCount` · `src/types/auction.ts` optional·nullable |
| "이번 주 신규" 철회 | `src/components/NewThisWeek.tsx` 삭제 · `src/lib/data.ts` `isNewThisWeek`·`newThisWeek` 삭제 · 게이트 R4 **삭제**(newCount는 채점하지 않고 요약 관측값으로만 표기 — 창 회전만으로 0이 되는 요일이 주 2일 구조적으로 발생한다) |
| 자동 알림 이슈 중복 억제 | `.github/workflows/crawl.yml` — 같은 접두의 열린 알림이 있으면 새로 만들지 않는다. 조회는 봇 라벨 `auto-alert`로 한정(사람이 연 이슈·옛 이슈가 알림을 삼키는 침묵 실패 차단). 닫는 자동화는 두지 않는다 |
