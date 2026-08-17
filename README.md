# CrazyValue(미친가치)

전국 법원경매 물건 중 2회 이상 유찰된 초저가 물건만 골라 보여주는 휴대폰 전용 PWA.

- 미친가치 픽: 현재 최저가가 감정가의 50% 이하인 물건에 부여하는 공개 기준 배지
- 무료 · 무가입 · 타이핑 0회(지역·금액·용도 3탭 필터)
- 데이터는 매일 새벽 자동 갱신, 모든 화면에 데이터 기준일 표기 — 슬롯·모드 분기는 `docs/OPERATIONS.md` §2
- 리프레쉬 탭: 정기 갱신을 기다리지 않고 지금 시점으로 다시 수집 — 쿨다운·경량 모드 계약은 `AGENTS.md` §1

## 아키텍처

```
[GitHub Actions — 매일 정기 수집(슬롯·모드 분기는 .github/workflows/crawl.yml on.schedule)]
   └ scripts/crawl.ts : 법원경매정보 수집 → 유찰≥2 필터 → zod 검증
   └ public/data/{region}.json + meta.json 갱신 → git commit & push
        └ push가 Vercel 자동 배포 트리거 (데이터 갱신 = 배포)
[리프레쉬 탭 → POST /api/refresh]
   └ 쿨다운·진행중 검사 → workflow_dispatch(mode=quick)
        └ 경량 수집: 매각기일 창 축소 + 상세 생략
[Vercel] Next.js 정적 서빙. /item/[id]는 서버에서 데이터 조회해 메타(OG)+초기 렌더
[클라이언트] 필터·정렬·관심함·최근 본 물건 전부 클라이언트 연산 (정적 데이터)
```

DB 없음, 비밀키 없음. 장애 지점은 크롤러 하나이며, 실패해도 앱은 직전 데이터로 동작한다.

## 퀵스타트 (3명령)

```
git clone https://github.com/ihaelyong988-lab/crazyvalue.git && cd crazyvalue
npm install
npm run dev
```

## 문서

작업 규칙·문서 순서는 `AGENTS.md`.

정보 제공 목적의 서비스이며 법적 효력은 법원 공고 원문이 우선한다. 입찰 전 사건번호로 원문을 확인해야 한다.
