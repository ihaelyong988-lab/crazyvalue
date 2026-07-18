"use client";

import { useEffect, useState } from "react";
import type { Meta } from "@/types/auction";

// 기준일 바 전용 경량 로더 — meta.json 하나만 읽는다.
// 상세·안내처럼 물건 데이터가 필요 없는 화면이 지역 17개 파일을 내려받지 않게 분리(§13 규칙 4).

let metaCache: Meta | null = null;
let metaInflight: Promise<Meta> | null = null;

function isMeta(v: unknown): v is Meta {
  const m = v as Meta;
  return (
    !!m &&
    typeof m.crawledAt === "string" &&
    typeof m.nextUpdateAt === "string" &&
    typeof m.totalCount === "number" &&
    typeof m.countsByRegion === "object"
  );
}

export async function readMeta(): Promise<Meta> {
  if (metaCache) return metaCache;
  if (!metaInflight) {
    metaInflight = (async () => {
      const res = await fetch("/data/meta.json");
      if (!res.ok) throw new Error(`meta.json 응답 ${res.status}`);
      const json: unknown = await res.json();
      if (!isMeta(json)) throw new Error("meta.json 형식 오류");
      metaCache = json;
      return json;
    })();
    metaInflight.catch(() => {
      metaInflight = null;
    });
  }
  return metaInflight;
}

export function useMeta(): { meta: Meta | null; failed: boolean } {
  const [state, setState] = useState<{ meta: Meta | null; failed: boolean }>({
    meta: metaCache,
    failed: false,
  });
  useEffect(() => {
    let alive = true;
    readMeta()
      .then((meta) => alive && setState({ meta, failed: false }))
      .catch(() => alive && setState({ meta: null, failed: true }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
