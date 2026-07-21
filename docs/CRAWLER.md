# 법원경매정보(courtauction.go.kr) 수집 전략 정찰 보고서

> Phase 3.1 정찰 스파이크 결과(2026-07-18, 요청 7회 — 예절 한도 10회 이내). 목적: 주 1회(일요일 03:00 KST) 실행, "유찰 2회 이상" 물건만 수집하는 무료 정보 서비스(출처·원문 링크 표기)의 크롤러 설계 근거.

## 1. 전략 판정

**판정: A) 내부 JSON API 직접 호출**

근거:
- 사이트는 WebSquare 기반 SPA다(초기 HTML은 부트로더 셸 2.6KB뿐). HTML 파싱(B)은 렌더링된 DOM이 없어 불가에 가깝고, Playwright(C)는 매주 헤드리스 브라우저를 띄우는 비용·불안정성이 크다.
- 검색은 단일 POST 엔드포인트 `/pgj/pgjsearch/searchControllerMain.on` 로 JSON을 반환한다. 실측 결과 CAPTCHA·CSRF 토큰 없이 `JSESSIONID` 쿠키만으로 동작하며, 잘못된 파라미터에 깔끔한 JSON 에러를 돌려준다.
- 결정적 이점: 서버가 **유찰횟수 필터(`flbdNcntMin`/`flbdNcntMax`)를 네이티브 지원**한다. `flbdNcntMin=2`로 "유찰 2회 이상"을 서버측에서 걸 수 있어, 전량 수집 없이 목표 물건만 최소 요청으로 받는다. 예절·효율·법적 리스크 모두에서 최선.

## 2. 추천 전략 구현 스펙

### 2.1 아키텍처 요약
- 프레임워크: WebSquare5 (inswave). 화면은 `/pgj/ui/pgj100/*.xml`, 데이터는 `*.on` 엔드포인트.
- 시스템명: NELS(차세대 경매) — 화면 XML 주석상 2022.12 생성. 2024년 이전 개편 이후 현 구조 유지 중.
- 부동산 물건 검색 화면: `PGJ151M01.xml` / 동산: `PGJ151M02.xml`.

### 2.2 핵심 엔드포인트
| 용도 | 메서드·경로 | 비고 |
|---|---|---|
| 세션 쿠키 취득 | `GET /pgj/index.on` | 응답 `Set-Cookie: JSESSIONID` 확보 후 재사용 |
| 물건 검색(부동산·동산 공통) | `POST /pgj/pgjsearch/searchControllerMain.on` | `Content-Type: application/json;charset=UTF-8`, 응답 JSON |
| 검색조건 코드목록(드롭다운·법원목록) | `POST /pgj/pgj151/selectGdsDtlBmrkSrchCond.on` | 최초 1회 호출로 법원·용도 코드 확보 |

### 2.3 요청 본문(POST search) 예시
WebSquare submission은 `dma_pageInfo`, `dma_srchGdsDtlSrchInfo` 두 객체를 JSON으로 직렬화해 전송한다.

```json
{
  "dma_pageInfo":  { "pageNo":1, "pageSize":40, "totalYn":"Y", "startRowNo":0, "totalCnt":0 },
  "dma_srchGdsDtlSrchInfo": {
    "cortAuctnSrchCondCd":"<코드 필수>",
    "mvprpRletDvsCd":"<부동산/동산 구분코드>",
    "bidDvsCd":"<입찰구분: 기일입찰 000331 / 기간입찰 000332 계열>",
    "cortOfcCd":"",
    "lclDspslGdsLstUsgCd":"",
    "mclDspslGdsLstUsgCd":"", "sclDspslGdsLstUsgCd":"",
    "flbdNcntMin":"2", "flbdNcntMax":"",
    "aeeEvlAmtMin":"", "aeeEvlAmtMax":"",
    "lwsDspslPrcRateMin":"", "lwsDspslPrcRateMax":"",
    "bidBgngYmd":"20260719", "bidEndYmd":"20260831",
    "notifyLoc":"off", "lafjOrderBy":"", "statNum":"1",
    "pgmId":"PGJ151M01"
  }
}
```
- `cortOfcCd` 비우면 전국. `flbdNcntMin=2` = 유찰 2회 이상 서버측 필터.

### 2.4 응답 파싱 포인트
성공 응답 봉투:
```
{ "data": { "dma_pageInfo": { ..., "totalCnt": N }, "dlt_srchResult": [ {물건row}, ... ] } }
```
- 목록 배열: `data.dlt_srchResult`. 총건수: `data.dma_pageInfo.totalCnt`(페이지네이션 종료 판단).
- 주요 컬럼: `csNo` 사건번호 · `cortOfcCd` 법원코드 · `jdbnCd` 재판부코드 · `dspslGdsSeq` 물건순번 · `lclDspslGdsLstUsgCd`(용도 대분류)·`mcl`·`scl` · 감정평가액 `aeeEvlAmt*` · 최저매각가격 `lwsDspslPrc*` · 최저매각가율 `lwsDspslPrcRate*` · **`flbdNcnt` 유찰횟수** · `dspslDxdyYmd` 매각기일 · `dspslPlcNm` 매각장소 · `objctArDts` 면적 · 주소 `rprsAdongSdCd/SggCd/EmdCd`(지번)·`rdnmSdCd/SggCd/No`(도로명)
- 페이지네이션: `pageNo` 증가, `pageSize` 기본 10(40까지 무리 없음). `totalCnt`까지 순회.

### 2.5 응답 봉투(에러) — 실측
잘못된 `cortAuctnSrchCondCd`로 POST 시 HTTP 550 + JSON(정상 동작 신호, CAPTCHA 아님):
```json
{"timestamp":1784330966559,"errors":{"errorMessage":"검색 구분코드가 존재하지 않습니다.","errorCode":"","referedUrl":"/pgj/pgjsearch/searchControllerMain.on"}}
```
→ `cortAuctnSrchCondCd`·`mvprpRletDvsCd`·`bidDvsCd`의 정확한 enum 값은 실제 검색 1회의 네트워크 캡처로 고정한다. 무차별 대입은 예절 위반이라 하지 않는다.

### 2.6 전국 순회 방법
- 1안(채택): `cortOfcCd` 공백 = 전국 단일 조회 + `flbdNcntMin=2` + 매각기일 창(향후 6주) → `totalCnt` 기준 페이지네이션 + **픽 후보에 한한** 물건별 상세.

#### 2.6.1 수집 규모 실측과 대응 (2026-07-22)
**기획 단계 추정이 틀렸다.** 위 1안에 "유찰 2회↑ 전국 물건은 소량이라 주간 실행 시 수십 요청 이내로 종결"이라 적었으나, 실제는 42일 창에서 **16,302건**이었다. 전건 상세 요청 시 목록 408 + 상세 16,302 = 16,710회 × 1.1초 = **약 5.2시간**으로 Actions job 상한 6시간에 여유가 15% 미만이었다.

| 시도한 대응 | 실측 | 판정 |
|---|---|---|
| 매각기일 창 축소(42→21일) | 16,302건 → **17,000건** (줄지 않음) | **무효** — 되돌림 |
| 창 0일(대조군) | 934건 | 서버 날짜 필터 자체는 정상 작동 |
| **상세 요청을 픽 후보로 한정** | 표본 40건 중 **19건(47.5%)** | **채택** — 상세 17,000 → 약 8,075회, 총 **약 2.6시간** |

창 축소가 무효인 이유: **매각기일이 근시일 3주에 집중**돼 있어 창을 절반으로 줄여도 대상 건수가 줄지 않는다. 창만 좁히면 노출 물건만 잃는다.
채택안의 근거: 픽 판정에 쓰는 감정가·최저가는 목록 응답(`gamevalAmt`·`minmaePrice`)에 이미 있어 추가 요청이 들지 않고, 비-픽 물건의 기일 이력은 기존 `buildBackcalcHistory` 역산 폴백이 채운다. 값 결측으로 판정이 불가하면 요청하는 쪽으로 기운다 — 픽을 놓치는 것이 큐레이션 정체성에 더 큰 손해다.
남은 여유가 다시 얇아지면 다음 수단은 법원별 분할 실행(2안)이 아니라 **매각기일 임박 순 우선 수집 + 시간 예산 초과 시 중단(부분 갱신)** 이다 — 2안은 같은 서버에 동시 요청을 늘려 예절 규칙과 충돌한다.
- 2안(안정·분산): `selectGdsDtlBmrkSrchCond.on`로 법원 목록(약 60개, `cortOfcCd`)을 받아 법원별 루프. 요청 분산·에러 격리에 유리하나 요청 수 증가.
- 유찰≥2 필터: **요청 필터(`flbdNcntMin=2`) 우선**(서버측). 폴백으로 응답의 `flbdNcnt` 값으로 수집 후 재필터(필터 회귀 시 안전망).

## 3. robots.txt · 약관 판정 요약

**판정: 조건부 수집 가능. 조건 = 출처·원문 표기 + 최소요청 예절 + 비상업 사실정보.**

- **robots.txt**: `https://www.courtauction.go.kr/robots.txt` → **HTTP 404(부재)**. 게시된 Disallow 규칙 없음(부재가 무제한 동의는 아님).
- **저작권 정책**(대법원 저작권보호정책): 법원 보유 공공저작물은 저작권법 제24조의2(공공저작물의 자유이용)에 따라 별도 허락 없이 자유이용 가능하되 "반드시 저작물의 출처를 구체적으로 표시하여야 합니다." → 앱의 출처·원문 링크 표기 방침과 부합. 경매 물건 정보는 사실정보로 창작성이 낮아 보호 대상성 자체가 약함.
- **공식 OpenAPI 부재**: 2015년 공공데이터 분쟁조정 사례에서 "OPEN API가 구축되어 있지 않으므로" 확인, 이후에도 미제공. 내부 JSON API 활용이 현실적 유일 경로.
- **미확인 잔여**: 사이트 내 이용약관 모달의 자동수집 금지 문구 유무(SPA라 정적 취득 불가) — 구축 시 온사이트 1회 정독, 발견 시 본 문서에 근거 인용 추가.

## 4. 리스크 목록 · 폴백

| 리스크 | 내용 | 폴백 |
|---|---|---|
| 구조 변경 | NELS 재배포 시 화면ID/필드명 변경 가능 | 필드 매핑 config 외부화(scripts/crawl-config), 실패 시 기존 데이터 유지+Actions 실패 표면화 |
| enum 코드 미확정 | `cortAuctnSrchCondCd` 등 값 오류 시 550 JSON 에러 | 실검색 1회 네트워크 캡처로 고정, 550/`errors` 봉투 감시 |
| 차단·레이트리밋 | 정부 WAF 스로틀 가능(CAPTCHA 미관측) | 일 03:00 실행, 요청 간 2~3초, 연락처 포함 UA `CrazyValueBot/0.1`, 429/550 시 지수백오프·중단 |
| 세션 요구 | `JSESSIONID` 쿠키 필요 | 매 실행 `GET /pgj/index.on` 선행 취득·재사용 |
| 사진 핫링크 | Referer 제한 가능(미검증) | MVP는 photoUrl null(용도 플레이스홀더). 도입 시 프록시+캐시 검토 |
| 원문 딥링크 한계 | 사건 단위 URL 파라미터 미지원(localStorage 전달) | 상세에 법원명·사건번호·물건번호 명시 + 경매사건검색 화면 링크 안내(§4.1) |

### 4.1 원문 링크(딥링크) 형식
- 화면 단위 딥링크: `https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ15AF01.xml`(사건상세 프레임). 특정 사건 파라미터는 URL 주입 불가.
- 실무 인용: 각 물건에 `법원명 · 사건번호 · 물건번호` 표기 + 법원경매정보 검색 화면 링크 제공. 출처 도메인 명시로 출처표시 의무 충족.

## 5. 정찰 중 실제 확인한 URL(출처)
- https://www.courtauction.go.kr/robots.txt — 404 확인
- https://www.courtauction.go.kr/pgj/index.on?device=pc — SPA 셸·JSESSIONID 발급 확인
- https://www.courtauction.go.kr/pgj/ui/pgj100/PGJ151F00.xml — 검색 프레임, submission 액션 확인
- https://www.courtauction.go.kr/pgj/ui/pgj100/PGJ151M01.xml — 부동산 목록 화면, 필드맵·유찰 필터·응답 매핑 확인
- POST https://www.courtauction.go.kr/pgj/pgjsearch/searchControllerMain.on — 응답·에러 봉투 실측(무 CAPTCHA)
- https://openapi.scourt.go.kr/kgso000m04.do — 대법원 저작권보호정책(자유이용+출처표시)
- https://www.data.go.kr/odmc/trublMdat/mdatCase/board.do?id=45 — 경매 OpenAPI 부재 분쟁조정 사례
- https://github.com/guriguri/cauca — 선례 크롤러(구조 참고)
- https://developer.codef.io/products/public/each/ck/auction-events — 상용 대안(유료)
