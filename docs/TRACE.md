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
| 0.5 | GitHub 등록·푸시 | origin | `git ls-remote origin` | **보류** — 로컬 커밋 완료·audit high 0(moderate 2). `gh repo create`가 세션 권한 분류기에 차단. 재개 조건: 주인님 권한 허용 또는 직접 1회 실행 |
| 0.6 | Vercel 등록·연동·최초 배포 | vercel 프로젝트 | 프로덕션 URL 200 | **부분 보류** — `vercel link` 성공(프로젝트 crazyvalue 생성, 이름 충돌 없음). `vercel --prod` 권한 차단. 재개 조건 0.5와 동일 |

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
| ①홈-1 | 기준일 바 | "데이터 기준 … · 다음 갱신 …" 상단 고정 | components/DataDateBar.tsx (AppShell 헤더 고정) | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ①홈-2 | 필터1 지역 | 시도 17 그리드→시군구 칩(다중, 기본 전체) | components/RegionFilter.tsx | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ①홈-3 | 필터2 금액 | 구간 칩 5종 복수 선택 | components/PriceFilter.tsx + lib/data.ts PRICE_BANDS | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ①홈-4 | 필터3 용도 | 8분류 | components/CategoryFilter.tsx | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ①홈-5 | 결과 버튼 | "물건 N건 보기" 실시간 갱신·높이 52px 하단 고정 | components/ResultButton.tsx (h-[52px] fixed) | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ①홈-6 | 미친가치 픽 진입 | "픽 N건 — 감정가 대비 50% 이하" → 픽 필터 리스트 | components/PickEntry.tsx → /list?pick=1 | 완료(E2E 8/8·게이트 0건·빌드 통과) |
| ①홈-7 | 이번 주 신규 | 신규 유찰2 도달 수 + 대표 3건 가로 스크롤 | components/NewThisWeek.tsx + lib/data.ts isNewThisWeek | 완료(E2E 8/8·게이트 0건·빌드 통과) |
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

## §13 개발 필수 규칙 15 (전 Phase 게이트)

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
