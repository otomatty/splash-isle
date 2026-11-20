/** クライアントから届いたセーブデータを検証して、決まった形だけを通す */
export interface SaveData {
  v: 1;
  gems: number;
  revealed: number;
  shells: number[];
  stars: number;
  portals: number;
  playMs: number;
  bestMs: number | null;
  updatedAt: number;
}

/** ヒカリ石14個ぶんのビット列の最大値 */
export const GEMS_ALL = (1 << 14) - 1;

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

export function parseSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  if (!isInt(r.gems, 0, GEMS_ALL) || !isInt(r.revealed, 0, 31) || !isInt(r.stars, 0, 255)) return null;
  // 入口の状態は後から足した項目なので、古いセーブでは無いことがある
  const portals = r.portals === undefined ? 0 : r.portals;
  if (!isInt(portals, 0, 7)) return null;
  if (!Array.isArray(r.shells) || r.shells.length > 256) return null;
  const shells: number[] = [];
  for (const s of r.shells) {
    if (!isInt(s, 0, 255)) return null;
    if (!shells.includes(s)) shells.push(s);
  }
  const playMs = typeof r.playMs === 'number' && Number.isFinite(r.playMs) ? Math.max(0, Math.min(Math.floor(r.playMs), 360_000_000)) : 0;
  const bestMs = typeof r.bestMs === 'number' && Number.isFinite(r.bestMs) && r.bestMs > 0 ? Math.min(Math.floor(r.bestMs), 360_000_000) : null;
  const updatedAt = typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? Math.max(0, Math.floor(r.updatedAt)) : Date.now();
  return { v: 1, gems: r.gems, revealed: r.revealed, shells, stars: r.stars, portals, playMs, bestMs, updatedAt };
}
