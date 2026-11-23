import { validRunId, type SaveData } from '../src/game/save-data';

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
  if (r.introComplete !== undefined && typeof r.introComplete !== 'boolean') return null;
  const introComplete = r.introComplete ?? (playMs > 0 || r.gems !== 0 || (r.revealed & ~10) !== 0 ||
    shells.length > 0 || r.stars !== 0 || portals !== 0 || bestMs !== null);
  const resetAt = r.resetAt === undefined ? 0 : r.resetAt;
  if (!isInt(resetAt, 0, Number.MAX_SAFE_INTEGER)) return null;
  const runId = r.runId;
  if (runId !== undefined && (resetAt === 0 || !validRunId(runId))) return null;
  return { v: 1, gems: r.gems, revealed: r.revealed, shells, stars: r.stars, portals, playMs, bestMs,
    introComplete, resetAt, ...(runId === undefined ? {} : { runId }), updatedAt };
}
