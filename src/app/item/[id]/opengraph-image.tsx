import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { findItem } from "@/lib/data-server";
import { discountPct, formatDateKr, formatKrw } from "@/lib/format";

// OG 공유 카드(기획안 §4.4-17 · §8 Phase 4.4) — 물건별 동적 1200×630, 서버 코드 최소 원칙의 유일한 예외(§5.1).
// 비차단 원칙: 물건 부재·폰트 결손·렌더 예외 시 Navy 단색+워드마크 기본 카드를 반환하고 throw하지 않는다.
// 정적 생성 계약은 상세 페이지와 동일(dynamicParams=false) — 파라미터 목록은 페이지의 generateStaticParams를 따른다.
export const dynamicParams = false;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const NAVY = "#0F2A43";
const PAPER = "#FAFAF8";
const ACCENT = "#2456A6";

// satori는 .woff2를 지원하지 않는다 — pretendard 패키지의 정적 .otf를 node:fs로 읽어 주입한다(§6 셀프호스팅).
// 실재 확인 경로: node_modules/pretendard/dist/public/static/Pretendard-{Regular,Bold}.otf (Vercel 리눅스에서도 dependencies라 존재)
const FONT_DIR = join(process.cwd(), "node_modules", "pretendard", "dist", "public", "static");

interface OgFont {
  name: string;
  data: Buffer;
  weight: 400 | 700;
  style: "normal";
}

let fontsInflight: Promise<OgFont[]> | null = null;

function loadFonts(): Promise<OgFont[]> {
  if (!fontsInflight) {
    fontsInflight = Promise.all([
      readFile(join(FONT_DIR, "Pretendard-Regular.otf")),
      readFile(join(FONT_DIR, "Pretendard-Bold.otf")),
    ]).then(([regular, bold]): OgFont[] => [
      { name: "Pretendard", data: regular, weight: 400, style: "normal" },
      { name: "Pretendard", data: bold, weight: 700, style: "normal" },
    ]);
    fontsInflight.catch(() => {
      fontsInflight = null; // 실패 시 다음 렌더에서 재시도 가능하게 초기화
    });
  }
  return fontsInflight;
}

/** 기본 카드 — Navy 단색 + 워드마크(§1.1 병용 규범). 폰트 결손 시 라틴 워드마크만으로 강등 렌더. */
function defaultCard(fonts: OgFont[] | null): ImageResponse {
  const brand = fonts ? (
    <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
      <span style={{ color: "#FFFFFF", fontSize: 88, fontWeight: 700, letterSpacing: -2 }}>
        미친가치
      </span>
      <span style={{ color: "rgba(255,255,255,0.72)", fontSize: 34, fontWeight: 400 }}>
        CrazyValue
      </span>
    </div>
  ) : (
    <span style={{ color: "#FFFFFF", fontSize: 76, fontWeight: 700 }}>CrazyValue</span>
  );
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: NAVY,
        }}
      >
        {brand}
      </div>
    ),
    fonts ? { ...size, fonts } : { ...size },
  );
}

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  let fonts: OgFont[] | null = null;
  try {
    fonts = await loadFonts();
  } catch {
    fonts = null;
  }
  try {
    const { id } = await params;
    const item = await findItem(decodeURIComponent(id));
    if (!item || !fonts) return defaultCard(fonts);
    const pct = discountPct(item.priceRatio);

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            backgroundColor: NAVY,
            padding: "64px 80px",
            fontFamily: "Pretendard",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <span style={{ color: "#FFFFFF", fontSize: 42, fontWeight: 700, letterSpacing: -1 }}>
              미친가치
            </span>
            <span style={{ color: "rgba(255,255,255,0.72)", fontSize: 22, fontWeight: 400 }}>
              CrazyValue
            </span>
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 36,
              color: "rgba(255,255,255,0.85)",
              fontSize: 38,
              fontWeight: 400,
            }}
          >
            {`${item.region} ${item.district} ${item.category}`}
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 44 }}>
            <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 28, fontWeight: 400 }}>
              감정가
            </span>
            <span
              style={{
                color: "rgba(255,255,255,0.65)",
                fontSize: 32,
                fontWeight: 400,
                textDecoration: "line-through",
              }}
            >
              {formatKrw(item.appraisalPrice)}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 8 }}>
            <span style={{ color: "#FFFFFF", fontSize: 96, fontWeight: 700, letterSpacing: -2 }}>
              {formatKrw(item.minPrice)}
            </span>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                backgroundColor: ACCENT,
                color: "#FFFFFF",
                fontSize: 30,
                fontWeight: 700,
                padding: "10px 24px",
                borderRadius: 12,
              }}
            >
              {`감정가 대비 -${pct}%`}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              marginTop: 40,
              color: PAPER,
              fontSize: 30,
              fontWeight: 400,
            }}
          >
            {`매각기일 ${formatDateKr(item.saleDate)} · 유찰 ${item.failCount}회`}
          </div>
        </div>
      ),
      { ...size, fonts },
    );
  } catch {
    return defaultCard(fonts);
  }
}
