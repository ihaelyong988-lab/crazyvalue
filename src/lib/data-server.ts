import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  MetaSchema,
  REGIONS,
  RegionFileSchema,
  type AuctionItem,
  type Meta,
} from "@/types/auction";

// 서버 전용 로더 — /item/[id]의 메타(OG)·초기 렌더에서만 사용한다(§5.2).

const dataDir = join(process.cwd(), "public", "data");

async function readRegion(key: string): Promise<AuctionItem[]> {
  try {
    const raw = JSON.parse(await readFile(join(dataDir, `${key}.json`), "utf8"));
    const parsed = RegionFileSchema.safeParse(raw);
    return parsed.success ? parsed.data : [];
  } catch {
    return []; // 파일 결손은 빈 목록으로 흡수 — 앱은 빈 화면이 되지 않는다(§4.5 안정성)
  }
}

export async function loadAllItems(): Promise<AuctionItem[]> {
  const all = await Promise.all(REGIONS.map((r) => readRegion(r.key)));
  return all.flat();
}

export async function findItem(id: string): Promise<AuctionItem | null> {
  // id 접두가 지역 키("{regionKey}-…")면 해당 파일만 읽는다.
  const prefix = id.split("-")[0];
  if (REGIONS.some((r) => r.key === prefix)) {
    const items = await readRegion(prefix);
    return items.find((i) => i.id === id) ?? null;
  }
  const items = await loadAllItems();
  return items.find((i) => i.id === id) ?? null;
}

export async function loadMeta(): Promise<Meta | null> {
  try {
    return MetaSchema.parse(JSON.parse(await readFile(join(dataDir, "meta.json"), "utf8")));
  } catch {
    return null;
  }
}
