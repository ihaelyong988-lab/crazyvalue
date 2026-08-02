/**
 * 수집기 설정 — 법원경매정보(courtauction.go.kr, NELS/WebSquare) 상수·코드 테이블.
 *
 * 값 확보 경위(2026-07-18 정적 화면 XML 실측 — docs/CRAWLER.md §2.5의 "네트워크 캡처로 고정" 대체):
 * - PGJ151F01.xml(물건상세검색 폼): cortAuctnSrchCondCd '0004601'=부동산 / '0004604'=동산,
 *   mvprpRletDvsCd '00031R'=부동산 / '00031M'=동산, bidDvsCd '000331'=기일입찰 / '000332'=기간입찰 / ''=전체,
 *   cortStDvs '1'=법원 / '2'=소재지(지번) / '3'=소재지(도로명).
 * - PGJ151M01.xml(부동산 목록): 검색 요청 dataMap(dma_srchGdsDtlSrchInfo) 전체 키 목록과
 *   응답 dlt_srchResult 컬럼(printCsNo·maemulSer·yuchalCnt·minmaePrice·gamevalAmt·maeGiil 등).
 * - PGJ15BM01.xml(물건상세): POST /pgj/pgj15B/selectAuctnCsSrchRslt.on
 *   요청 {csNo,cortOfcCd,dspslGdsSeq,pgmId,srchInfo} → 응답 data.dma_result.gdsDspslDxdyLst[]
 *   {dxdyYmd,dxdyHm,auctnDxdyKndCd,auctnDxdyRsltCd,tsLwsDspslPrc,dxdyPlcNm} = 회차별 기일 이력(실데이터).
 *
 * 구조 변경 리스크 대응(CRAWLER.md §4): 필드 매핑·코드값은 이 파일에서만 수정한다.
 */

export const BASE_URL = "https://www.courtauction.go.kr";

export const USER_AGENT = "CrazyValueBot/0.1 (+https://github.com/ihaelyong988-lab/crazyvalue)";

export const ENDPOINTS = {
  /** 세션(JSESSIONID) 취득 */
  session: "/pgj/index.on",
  /** 물건 검색(부동산·동산 공통) */
  search: "/pgj/pgjsearch/searchControllerMain.on",
  /** 물건상세(사건기본·기일이력·목적물) — PGJ15BM01.xml sbm_selectGdsDtlSrchDtlInfo */
  detail: "/pgj/pgj15B/selectAuctnCsSrchRslt.on",
} as const;

/**
 * 원문 링크 — 사건 단위 딥링크 불가(CRAWLER.md §4.1, localStorage 전달 구조).
 * 사건상세 화면 고정 링크 + 앱 상세 화면의 법원명·사건번호 표기로 출처표시를 충족한다.
 */
export const DETAIL_URL =
  "https://www.courtauction.go.kr/pgj/index.on?w2xPath=/pgj/ui/pgj100/PGJ15AF01.xml";

/** 예절 규칙(PLAN §5.4·CRAWLER.md §4) — 간격 ≥1초, 재시도 3회 지수 백오프 */
export const POLITENESS = {
  minIntervalMs: 1100,
  retries: 3,
  backoffsMs: [1000, 2000, 4000],
  timeoutMs: 30000,
  /**
   * 429(레이트리밋) 전용 대기·재시도 — 5xx와 분리한다.
   * 429를 일반 재시도(3회)에 태우면 서버가 속도를 낮추라고 답한 순간 요청이 물건당 4배로 늘어
   * 차단을 가속한다. CRAWLER.md §4는 "429/550 시 지수백오프·중단"을 폴백으로 명기한다.
   */
  rateLimitWaitMs: 30000,
  rateLimitMaxWaitMs: 120000,
  /** 429 허용 재시도 수. 초과하면 중단 신호(CrawlAbortError)로 승격한다. */
  rateLimitRetries: 1,
} as const;

/**
 * 세션 부트스트랩(GET /pgj/index.on) 전용 재시도 백오프 — 일반 요청 백오프(POLITENESS.backoffsMs)는 불변.
 *
 * 이 경로의 `TypeError: fetch failed`(HTTP 오류가 아니라 연결 자체 실패)는 누적 4회 관측됐고,
 * 실행 간격과 상관이 약하다 — 2026-08-02 실측: 13분 간격 뒤에는 성공했고 1시간 21분 간격 뒤에는 실패했다.
 * 즉 "너무 자주 눌러서"가 아니라 간헐적 거부이며, 흡수 폭이 현상보다 짧은 것이 문제였다(직전 65초).
 * 총 3.7분(10+30+60+120)으로 늘려 일시적 거부를 넘긴다 — 경량 수집 5분과 합쳐도 10분 목표 안이다.
 */
export const SESSION_BACKOFFS = [10000, 30000, 60000, 120000] as const;

/**
 * 산출물 상한 — 유효·중복제거 후 매각기일 임박순(saleDate 오름차순, 동일일 id 순) 상위 N건만 산출한다.
 * 상한 적용 전 유효 건수는 meta.cappedFrom으로 기록한다(crawl-lib capBySaleDate).
 */
export const OUTPUT_CAP = 1000;

/**
 * 요청 예산 — 1회 실행이 넘지 않는 상한(AGENTS.md §9 2026-07-27 원장).
 *
 * 실측 근거: 2026-07-25 18:53Z 주간 수집이 43분47초·약 2,160요청 지점에서
 * 로봇탐지(ipcheck=false)로 차단됐다(세션1+목록473=474회 실측 + 상세 2,024초÷1.2초/요청≈1,690회).
 * 계획 총량 9,307회·2.9시간의 25% 지점이라 예산 없는 설계로는 완주가 성립하지 않는다.
 * 차단 임계는 사후 재현이 불가능한 1회성 관측치이므로 상한은 그 아래로 여유를 둔다.
 */
export const BUDGET = {
  /** 1회 실행 총 요청 상한(세션+목록+상세). 실측 차단선 약 2,160회의 70% 지점. */
  maxRequests: 1500,
  /** 상세 단계 마감(분). 예산이 남아도 이 시각을 넘기면 조기 종료한다. */
  deadlineMinutes: 90,
} as const;

/** 검색 고정 파라미터 */
export const SEARCH = {
  /** 부동산 물건상세검색 구분코드(PGJ151F01.xml) */
  cortAuctnSrchCondCd: "0004601",
  /** 부동산 구분(PGJ151F01.xml) */
  mvprpRletDvsCd: "00031R",
  /** 입찰구분 — ''=전체(기일+기간, PGJ151F01.xml rad_mvprpBidLst의 '전체' 항목 값) */
  bidDvsCd: "",
  /** 법원/소재지 구분 — '1'=법원(법원 미지정 = 전국) */
  cortStDvs: "1",
  pgmId: "PGJ151M01",
  pageSize: 40,
  /**
   * 매각기일 창: 오늘부터 +N일(CRAWLER.md §2.6 — 향후 6주).
   *
   * 이 값을 줄여 수집량을 줄이려는 시도는 무효다(2026-07-22 실측):
   *   42일 → 16,302건 · 21일 → 17,000건 · 0일 → 934건.
   * 서버 날짜 필터 자체는 정상 작동하지만(0일 934건이 증거), 매각기일이 근시일 3주에 집중돼
   * 창을 절반으로 줄여도 대상 건수가 줄지 않는다. 창만 좁히면 노출 물건만 잃는다.
   * 실효 레버는 crawl.ts의 상세 요청 한정(픽 후보 47.5%)이다 — 그쪽 주석 참조.
   */
  windowDays: 42,
  /** 유찰 2회 이상 서버측 필터(제품 정체성) */
  flbdNcntMin: "2",
} as const;

/**
 * 검색 요청 dma_srchGdsDtlSrchInfo의 전체 키(PGJ151M01.xml keyInfo 전사).
 * 브라우저는 dataMap에 선언된 키 전부를 직렬화해 보내므로 동일하게 빈 문자열로 채워 전송한다.
 */
export const SEARCH_INFO_KEYS = [
  "rletDspslSpcCondCd", "bidDvsCd", "mvprpRletDvsCd", "cortAuctnSrchCondCd",
  "rprsAdongSdCd", "rprsAdongSggCd", "rprsAdongEmdCd", "rdnmSdCd", "rdnmSggCd", "rdnmNo",
  "mvprpDspslPlcAdongSdCd", "mvprpDspslPlcAdongSggCd", "mvprpDspslPlcAdongEmdCd",
  "rdDspslPlcAdongSdCd", "rdDspslPlcAdongSggCd", "rdDspslPlcAdongEmdCd",
  "cortOfcCd", "jdbnCd", "execrOfcDvsCd",
  "lclDspslGdsLstUsgCd", "mclDspslGdsLstUsgCd", "sclDspslGdsLstUsgCd",
  "cortAuctnMbrsId", "aeeEvlAmtMin", "aeeEvlAmtMax",
  "lwsDspslPrcRateMin", "lwsDspslPrcRateMax", "flbdNcntMin", "flbdNcntMax",
  "objctArDtsMin", "objctArDtsMax",
  "mvprpArtclKndCd", "mvprpArtclNm", "mvprpAtchmPlcTypCd",
  "notifyLoc", "lafjOrderBy", "pgmId", "csNo", "cortStDvs", "statNum",
  "bidBgngYmd", "bidEndYmd", "dspslDxdyYmd",
  "fstDspslHm", "scndDspslHm", "thrdDspslHm", "fothDspslHm", "dspslPlcNm",
  "lwsDspslPrcMin", "lwsDspslPrcMax",
  "grbxTypCd", "gdsVendNm", "fuelKndCd", "carMdyrMax", "carMdyrMin", "carMdlNm",
  "sideDvsCd",
] as const;

/**
 * 기일(경매기일) 코드 — PGJ15AF01.xml·PGJ15BM01.xml 스크립트 실측.
 * - 종류(auctnDxdyKndCd): '01'=매각기일, '02'=매각결정기일.
 * - 결과(auctnDxdyRsltCd): '001'=매각(스크립트가 매각금액을 병기). 유찰 코드는 화면이
 *   공통코드 캐시(AUCTN_DXDY_RSLT_CD)로 번역하므로 정적 XML에 값이 없다 →
 *   기본값 '002'를 두되, 런타임에 응답 데이터로 자가 보정한다(crawl.ts calibrateFailedCode).
 */
export const DXDY = {
  KND_SALE: "01",
  KND_DECISION: "02",
  RSLT_SOLD: "001",
  RSLT_FAILED_DEFAULT: "002",
} as const;

/**
 * 유찰 결과코드 자가 보정의 안전장치 — 표본이 얇으면 보정하지 않고 기본값을 쓴다.
 * 조기 종료가 상세 표본을 수 건까지 줄일 수 있고, 그때 빈도 1회짜리 코드가 기본값을 이기면
 * 유찰/변경 라벨이 뒤집힌 채 검증 게이트를 통과한다(zod는 fails==failCount만 본다).
 */
export const DXDY_CALIBRATION = {
  /** 보정을 시도할 최소 관측 수(과거 매각기일 행의 비매각 결과코드 합계) */
  minSamples: 200,
  /** 최빈 코드가 2위 코드의 이 배수 이상일 때만 채택한다 */
  dominanceRatio: 3,
} as const;

/** 법정동 시·도 코드(앞 2자리) → regionKey. 강원 51·전북 52는 특별자치도 개편 코드. */
export const REGION_KEY_BY_SD_CD: Record<string, string> = {
  "11": "seoul", "26": "busan", "27": "daegu", "28": "incheon", "29": "gwangju",
  "30": "daejeon", "31": "ulsan", "36": "sejong", "41": "gyeonggi",
  "42": "gangwon", "51": "gangwon", "43": "chungbuk", "44": "chungnam",
  "45": "jeonbuk", "52": "jeonbuk", "46": "jeonnam", "47": "gyeongbuk",
  "48": "gyeongnam", "50": "jeju",
};

/** 시·도명 접두(응답 hjguSido·주소 문자열) → regionKey. 구명칭·특별자치도 명칭 병기. */
export const REGION_KEY_BY_SIDO_PREFIX: [string, string][] = [
  ["서울", "seoul"], ["부산", "busan"], ["대구", "daegu"], ["인천", "incheon"],
  ["광주", "gwangju"], ["대전", "daejeon"], ["울산", "ulsan"], ["세종", "sejong"],
  ["경기", "gyeonggi"], ["강원", "gangwon"],
  ["충청북", "chungbuk"], ["충북", "chungbuk"], ["충청남", "chungnam"], ["충남", "chungnam"],
  ["전라북", "jeonbuk"], ["전북", "jeonbuk"], ["전라남", "jeonnam"], ["전남", "jeonnam"],
  ["경상북", "gyeongbuk"], ["경북", "gyeongbuk"], ["경상남", "gyeongnam"], ["경남", "gyeongnam"],
  ["제주", "jeju"],
];

/**
 * 법원코드(cortOfcCd/boCd) → 법원명·시·도 폴백 테이블.
 * 출처: 법원경매정보 법원 코드 체계(구 시스템부터 동일 계열 유지) — dry-run 실측 표본으로 일부 검증.
 * 주의: 관할 경계와 시·도가 불일치하는 예외(예: 인천지법 부천지원 관할=경기 부천)가 있으므로
 * region 판정은 항상 주소(hjguSido·시도코드)가 우선이고 이 표는 최후 폴백으로만 쓴다.
 */
export const COURT_BY_CODE: Record<string, { name: string; regionKey: string }> = {
  B000210: { name: "서울중앙지방법원", regionKey: "seoul" },
  B000211: { name: "서울동부지방법원", regionKey: "seoul" },
  B000212: { name: "서울남부지방법원", regionKey: "seoul" },
  B000213: { name: "서울북부지방법원", regionKey: "seoul" },
  B000215: { name: "서울서부지방법원", regionKey: "seoul" },
  B000214: { name: "의정부지방법원", regionKey: "gyeonggi" },
  B214807: { name: "의정부지방법원 고양지원", regionKey: "gyeonggi" },
  B214804: { name: "의정부지방법원 남양주지원", regionKey: "gyeonggi" },
  B000240: { name: "인천지방법원", regionKey: "incheon" },
  B000241: { name: "인천지방법원 부천지원", regionKey: "gyeonggi" },
  B000250: { name: "수원지방법원", regionKey: "gyeonggi" },
  B000251: { name: "수원지방법원 성남지원", regionKey: "gyeonggi" },
  B000252: { name: "수원지방법원 여주지원", regionKey: "gyeonggi" },
  B000253: { name: "수원지방법원 평택지원", regionKey: "gyeonggi" },
  B000254: { name: "수원지방법원 안산지원", regionKey: "gyeonggi" },
  B000255: { name: "수원지방법원 안양지원", regionKey: "gyeonggi" },
  B000260: { name: "춘천지방법원", regionKey: "gangwon" },
  B000261: { name: "춘천지방법원 강릉지원", regionKey: "gangwon" },
  B000262: { name: "춘천지방법원 원주지원", regionKey: "gangwon" },
  B000263: { name: "춘천지방법원 속초지원", regionKey: "gangwon" },
  B000264: { name: "춘천지방법원 영월지원", regionKey: "gangwon" },
  B000270: { name: "청주지방법원", regionKey: "chungbuk" },
  B000271: { name: "청주지방법원 충주지원", regionKey: "chungbuk" },
  B000272: { name: "청주지방법원 제천지원", regionKey: "chungbuk" },
  B000273: { name: "청주지방법원 영동지원", regionKey: "chungbuk" },
  B000280: { name: "대전지방법원", regionKey: "daejeon" },
  B000281: { name: "대전지방법원 홍성지원", regionKey: "chungnam" },
  B000282: { name: "대전지방법원 논산지원", regionKey: "chungnam" },
  B000283: { name: "대전지방법원 천안지원", regionKey: "chungnam" },
  B000284: { name: "대전지방법원 공주지원", regionKey: "chungnam" },
  B000285: { name: "대전지방법원 서산지원", regionKey: "chungnam" },
  B000290: { name: "대구지방법원", regionKey: "daegu" },
  B000298: { name: "대구지방법원 서부지원", regionKey: "daegu" },
  B000291: { name: "대구지방법원 안동지원", regionKey: "gyeongbuk" },
  B000292: { name: "대구지방법원 경주지원", regionKey: "gyeongbuk" },
  B000293: { name: "대구지방법원 김천지원", regionKey: "gyeongbuk" },
  B000294: { name: "대구지방법원 상주지원", regionKey: "gyeongbuk" },
  B000295: { name: "대구지방법원 의성지원", regionKey: "gyeongbuk" },
  B000296: { name: "대구지방법원 영덕지원", regionKey: "gyeongbuk" },
  B000297: { name: "대구지방법원 포항지원", regionKey: "gyeongbuk" },
  B000310: { name: "부산지방법원", regionKey: "busan" },
  B000311: { name: "부산지방법원 동부지원", regionKey: "busan" },
  B000312: { name: "부산지방법원 서부지원", regionKey: "busan" },
  B000320: { name: "울산지방법원", regionKey: "ulsan" },
  B000330: { name: "창원지방법원", regionKey: "gyeongnam" },
  B000331: { name: "창원지방법원 진주지원", regionKey: "gyeongnam" },
  B000332: { name: "창원지방법원 통영지원", regionKey: "gyeongnam" },
  B000333: { name: "창원지방법원 밀양지원", regionKey: "gyeongnam" },
  B000334: { name: "창원지방법원 거창지원", regionKey: "gyeongnam" },
  B000335: { name: "창원지방법원 마산지원", regionKey: "gyeongnam" },
  B000340: { name: "광주지방법원", regionKey: "gwangju" },
  B000341: { name: "광주지방법원 목포지원", regionKey: "jeonnam" },
  B000342: { name: "광주지방법원 장흥지원", regionKey: "jeonnam" },
  B000343: { name: "광주지방법원 순천지원", regionKey: "jeonnam" },
  B000344: { name: "광주지방법원 해남지원", regionKey: "jeonnam" },
  B000350: { name: "전주지방법원", regionKey: "jeonbuk" },
  B000351: { name: "전주지방법원 군산지원", regionKey: "jeonbuk" },
  B000352: { name: "전주지방법원 정읍지원", regionKey: "jeonbuk" },
  B000353: { name: "전주지방법원 남원지원", regionKey: "jeonbuk" },
  B000360: { name: "제주지방법원", regionKey: "jeju" },
};

/**
 * 매각용도명(dspslUsgNm) → 앱 카테고리 매핑 규칙. 위에서부터 첫 일치 적용.
 * '공장' 검사를 '아파트'보다 앞에 둔다(아파트형공장 오분류 방지).
 */
export const CATEGORY_RULES: { pattern: RegExp; category: string }[] = [
  { pattern: /공장|창고|축사|제조/, category: "공장창고" },
  { pattern: /아파트/, category: "아파트" },
  { pattern: /오피스텔/, category: "오피스텔" },
  { pattern: /다세대|연립|빌라/, category: "다세대" },
  { pattern: /단독|다가구|전원주택|주택/, category: "단독다가구" },
  { pattern: /상가|점포|근린|판매|시장|숙박|목욕|병원|사무실|업무/, category: "상가" },
  { pattern: /대지|임야|전답|과수원|목장|잡종지|토지|농지|도로|하천|유지|염전|묘지|광천지|제방|구거|답|전/, category: "토지" },
];

/** 단일 글자 지목(전·답·대 등)은 완전일치로만 토지 판정한다(부분일치 오탐 방지). */
export const LAND_EXACT = new Set(["전", "답", "대", "임야", "잡종지", "과수원", "목장용지", "대지"]);
