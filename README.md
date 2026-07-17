# CrazyValue(미친가치)

전국 법원경매 물건 중 2회 이상 유찰된 초저가 물건만 골라 보여주는 휴대폰 전용 PWA.

- 미친가치 픽: 현재 최저가가 감정가의 50% 이하인 물건에 부여하는 공개 기준 배지
- 무료 · 무가입 · 타이핑 0회(지역·금액·용도 3탭 필터)
- 데이터는 매주 일요일 03:00 KST 자동 갱신, 모든 화면에 데이터 기준일 표기

## 아키텍처

```
[GitHub Actions — 매주 일 03:00 KST (cron 0 18 * * 6 UTC)]
   └ scripts/crawl.ts : 법원경매정보 수집 → 유찰≥2 필터 → zod 검증
   └ public/data/{region}.json + meta.json 갱신 → git commit & push
        └ push가 Vercel 자동 배포 트리거 (데이터 갱신 = 배포)
[Vercel] Next.js 정적 서빙. /item/[id]는 서버에서 데이터 조회해 메타(OG)+초기 렌더
[클라이언트] 필터·정렬·관심함·최근 본 물건 전부 클라이언트 연산 (주간 정적 데이터)
```

DB 없음, 비밀키 없음. 장애 지점은 크롤러 하나이며, 실패해도 앱은 직전 데이터로 동작한다.

## 퀵스타트 (3명령)

```
git clone https://github.com/ihaelyong988-lab/crazyvalue.git && cd crazyvalue
npm install
npm run dev
```

## 문서 (작업 재개 순서)

1. `AGENTS.md` — 작업 규칙·오류 원장 (착수 전 필독)
2. `docs/PLAN.md` — 기획안 v3.1 사본 (원본: 기획 폴더 `경매 최저가/`)
3. `docs/TRACE.md` — 실행 완전성 원장 (Phase별 체크리스트·행 단위 대조)
4. `docs/CRAWLER.md` — 수집 전략 기록 (Phase 3 생성)
5. `docs/OPERATIONS.md` — 운영 절차 (Phase 5 생성)

정보 제공 목적의 서비스이며 법적 효력은 법원 공고 원문이 우선한다. 입찰 전 사건번호로 원문을 확인해야 한다.
