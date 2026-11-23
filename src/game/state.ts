import { mergeSaves, validRunId, type SaveData } from './save-data';
export { compareRuns, mergeSaves, type SaveData } from './save-data';

export const SLOT_IDS = ['A', 'B', 'C'] as const;
export type SaveSlot = typeof SLOT_IDS[number];

export const GEM_COUNT = 14;
/** 町で手に入るヒカリ石の数（番号 0〜4） */
export const TOWN_GEMS = 5; // 番号 0〜4 が町のぶん
export const ALL_GEMS = (1 << GEM_COUNT) - 1;
/** 最初から見えているヒカリ石（灯台・沖の岩） */
export const INITIAL_REVEALED = (1 << 1) | (1 << 3);
const KEY = 'splash-isle-save-v1';
const SETTINGS_KEY = 'splash-isle-settings-v1';

export function newSave(bestMs: number | null = null): SaveData {
  return { v: 1, gems: 0, revealed: INITIAL_REVEALED, shells: [], stars: 0, portals: 0, playMs: 0, bestMs, introComplete: false, resetAt: 0, updatedAt: Date.now() };
}

function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function restartSave(previous: SaveData): SaveData {
  const next = newSave(previous.bestMs);
  next.resetAt = Math.min(Number.MAX_SAFE_INTEGER, Math.max(next.updatedAt, previous.resetAt + 1, previous.updatedAt + 1));
  // 時刻が上限に達しても、次のやり直しは必ず親より新しい。別端末で同時なら乱数で決着する。
  const serial = next.resetAt === previous.resetAt && previous.runId ? BigInt(previous.runId.split('-')[0]) + 1n : 0n;
  next.runId = serial + '-' + randomId();
  next.updatedAt = next.resetAt;
  return next;
}

export function hasAdventure(save: SaveData): boolean {
  return save.introComplete || save.gems !== 0 || save.shells.length > 0 || save.stars !== 0 ||
    save.portals !== 0 || save.revealed !== INITIAL_REVEALED || save.playMs > 0;
}

/** 外から来たデータを安全な形に整える（壊れた値は捨てる） */
export function sanitizeSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  const int = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);
  const shells = Array.isArray(r.shells) ? Array.from(new Set(r.shells.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < 256))).slice(0, 256) : [];
  const best = typeof r.bestMs === 'number' && Number.isFinite(r.bestMs) && r.bestMs > 0 ? Math.floor(r.bestMs) : null;
  const save: SaveData = {
    v: 1,
    gems: int(r.gems, ALL_GEMS),
    revealed: (int(r.revealed, ALL_GEMS) & 31) | INITIAL_REVEALED,
    shells,
    stars: int(r.stars, 255),
    portals: int(r.portals, 7),
    playMs: int(r.playMs, 1000 * 60 * 60 * 100),
    bestMs: best,
    introComplete: r.introComplete === true,
    resetAt: int(r.resetAt, Number.MAX_SAFE_INTEGER),
    updatedAt: int(r.updatedAt, Number.MAX_SAFE_INTEGER),
  };
  if (r.runId !== undefined) {
    if (!save.resetAt || !validRunId(r.runId)) return null;
    save.runId = r.runId;
  }
  if (r.introComplete === undefined) save.introComplete = hasAdventure(save) || best !== null;
  return save;
}

// A は従来と同じキーを使い、既存のゲストの冒険もそのまま表示する。
function localKey(slot: SaveSlot, owner?: string): string {
  const base = slot === 'A' ? KEY : KEY + '-' + slot;
  return owner === undefined ? base : base + ':account:' + encodeURIComponent(owner);
}

/** 保存ごとに別のキーへ書く。統合元を消すのは、統合先が端末に残った後だけ。 */
function localCopies(key: string): { save: SaveData | null; sources: string[]; prefix: string } {
  const prefix = 'splash-isle-journal:' + encodeURIComponent(key) + ':';
  const sources: string[] = [];
  let save: SaveData | null = null;
  for (const name of [key, ...Object.keys(localStorage).filter(name => name.startsWith(prefix))]) {
    const raw = localStorage.getItem(name);
    if (!raw) continue;
    try {
      const part = sanitizeSave(JSON.parse(raw));
      if (!part) continue;
      save = save ? mergeSaves(save, part) : part;
      if (name !== key) sources.push(name);
    } catch { /* 壊れたコピーがあっても正常な記録を使う */ }
  }
  return { save, sources, prefix };
}

export function loadLocal(slot: SaveSlot = 'A', owner?: string): SaveData {
  try { return localCopies(localKey(slot, owner)).save ?? newSave(); }
  catch { return newSave(); }
}

export function saveLocal(data: SaveData, slot: SaveSlot = 'A', owner?: string): boolean {
  try {
    const key = localKey(slot, owner);
    const { save, sources, prefix } = localCopies(key);
    const value = JSON.stringify(save ? mergeSaves(save, data) : data);
    localStorage.setItem(prefix + randomId(), value);
    // 従来のキーにも同じ内容を置く。並行書き込みがあれば、別キーの確定コピーが両方を残す。
    try {
      for (const source of sources) localStorage.removeItem(source);
      localStorage.setItem(key, value);
    } catch { /* 確定コピーはすでに書けている。読み込み時には従来キーと合わせて復元する。 */ }
    return true;
  } catch {
    return false;
  }
}

/** 保存時刻と貝の並びは、書き込みが必要かどうかに影響しない。 */
export function sameSave(a: SaveData, b: SaveData): boolean {
  if (a.gems !== b.gems || a.revealed !== b.revealed || a.stars !== b.stars || a.portals !== b.portals ||
      a.introComplete !== b.introComplete || a.resetAt !== b.resetAt || a.runId !== b.runId || a.playMs !== b.playMs ||
      a.bestMs !== b.bestMs || a.shells.length !== b.shells.length) return false;
  const owned = new Set(a.shells);
  return b.shells.every(id => owned.has(id));
}

export interface Settings {
  quality: 'auto' | 'low' | 'medium' | 'high';
  sensitivity: number;
  invertY: boolean;
  volume: number;
  music: number;
  showFps: boolean;
}

export function loadSettings(): Settings {
  const def: Settings = { quality: 'auto', sensitivity: 1, invertY: false, volume: 0.8, music: 0.6, showFps: false };
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    if (s) {
      const r = JSON.parse(s) as Partial<Settings>;
      if (r.quality === 'auto' || r.quality === 'low' || r.quality === 'medium' || r.quality === 'high') def.quality = r.quality;
      if (typeof r.sensitivity === 'number') def.sensitivity = Math.max(0.2, Math.min(3, r.sensitivity));
      if (typeof r.invertY === 'boolean') def.invertY = r.invertY;
      if (typeof r.volume === 'number') def.volume = Math.max(0, Math.min(1, r.volume));
      if (typeof r.music === 'number') def.music = Math.max(0, Math.min(1, r.music));
      if (typeof r.showFps === 'boolean') def.showFps = r.showFps;
    }
  } catch {
    /* 既定値を使う */
  }
  return def;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* 保存できない環境では何もしない */
  }
}

export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60), s = total % 60;
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
