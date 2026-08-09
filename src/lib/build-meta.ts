import metaJson from "../../public/data/meta.json";

// 기준일은 런타임에 받아오는 값이 아니라 빌드 산출물이다(2026-08-09 확정).
//
// 왜 바꿨나: 예전에는 화면이 fetch("/data/meta.json")로 기준일을 읽었다. 그 요청은 서비스워커를
// 거치고(sw.ts NetworkFirst 3초), 망이 느리거나 끊긴 순간에는 캐시된 옛 날짜가 첫 화면에 올라갔다.
// 그리고 앱은 한 번 올라간 값을 절대 교체하지 않았다(옛 use-meta.ts의 pending 설계) — 망이 복구돼도
// 앱을 다시 열어도 옛 날짜가 그대로였다. 실브라우저 재현 완료: 08-02 값이 08-07 배포 위에서 영구 고착.
//
// 데이터는 저장소에 커밋돼 배포와 함께 나간다. 그러니 빌드 시점이 이미 crawledAt을 안다 —
// 받아올 이유가 없다. 받아오지 않으면 캐시도 레이스도 없다.
//
// 이 모듈은 서버 컴포넌트에서만 import한다. 클라이언트에서 쓰면 JSON이 브라우저 번들에 실린다.
export interface BuildMeta {
  /** 수집 시각(ISO, KST 오프셋 포함). 화면 기준일 바가 표기하는 값. */
  crawledAt: string;
  /** 직전에도 수집 대상이던 매각기일에서 새로 등장한 물건 수. 옛 산출물에는 없다. */
  newCount?: number;
}

export const buildMeta: BuildMeta = metaJson;
