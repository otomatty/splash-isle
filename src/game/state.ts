/** セーブデータ（localStorage とクラウドで同じ形） */
export interface SaveData {
  v: 1;
  /** 取得済みのヒカリ石（ビット列） */
  gems: number;
  /** 出現済みのヒカリ石（ビット列） */
  revealed: number;
  /** 取得済みの貝がらの番号 */
  shells: number[];
  /** 取得済みのヒトデ（ビット列。町のぶん） */
  stars: number;
  /** ひらいた入口（ビット列） */
  portals: number;
  /** 今回の挑戦のプレイ時間（ミリ秒） */
  playMs: number;
  /** 全クリアの最短時間（ミリ秒）。未クリアは null */
  bestMs: number | null;
  updatedAt: number;
}

export const GEM_COUNT = 14;
/** 町で手に入るヒカリ石の数（番号 0〜4） */
export const TOWN_GEMS = 5; // 番号 0〜4 が町のぶん
export const ALL_GEMS = (1 << GEM_COUNT) - 1;
/** 最初から見えているヒカリ石（灯台・沖の岩） */
export const INITIAL_REVEALED = (1 << 1) | (1 << 3);
const KEY = 'splash-isle-save-v1';
const SETTINGS_KEY = 'splash-isle-settings-v1';

export function newSave(bestMs: number | null = null): SaveData {
  return { v: 1, gems: 0, revealed: INITIAL_REVEALED, shells: [], stars: 0, portals: 0, playMs: 0, bestMs, updatedAt: Date.now() };
}

/** 外から来たデータを安全な形に整える（壊れた値は捨てる） */
export function sanitizeSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;
  const int = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);
  const shells = Array.isArray(r.shells) ? Array.from(new Set(r.shells.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < 256))).slice(0, 256) : [];
  const best = typeof r.bestMs === 'number' && Number.isFinite(r.bestMs) && r.bestMs > 0 ? Math.floor(r.bestMs) : null;
  return {
    v: 1,
    gems: int(r.gems, ALL_GEMS),
    revealed: (int(r.revealed, ALL_GEMS) & 31) | INITIAL_REVEALED,
    shells,
    stars: int(r.stars, 255),
    portals: int(r.portals, 7),
    playMs: int(r.playMs, 1000 * 60 * 60 * 100),
    bestMs: best,
    updatedAt: int(r.updatedAt, Number.MAX_SAFE_INTEGER),
  };
}

export function loadLocal(): SaveData {
  try {
    const s = localStorage.getItem(KEY);
    if (s) return sanitizeSave(JSON.parse(s)) ?? newSave();
  } catch {
    /* プライベートモードなどで保存領域が使えない場合はメモリ上だけで進める */
  }
  return newSave();
}

export function saveLocal(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* 保存できない環境では何もしない */
  }
}

/** ローカルとクラウドのセーブを統合する。進んでいるほうを採用し、ベストタイムは速いほう */
export function mergeSaves(a: SaveData, b: SaveData): SaveData {
  const count = (n: number) => n.toString(2).replace(/0/g, '').length;
  const pa = count(a.gems) * 1000 + count(a.stars) * 10 + a.shells.length;
  const pb = count(b.gems) * 1000 + count(b.stars) * 10 + b.shells.length;
  const base = pb > pa || (pb === pa && b.updatedAt > a.updatedAt) ? b : a;
  const bests = [a.bestMs, b.bestMs].filter((x): x is number => x !== null);
  return { ...base, shells: [...base.shells], portals: a.portals | b.portals, bestMs: bests.length ? Math.min(...bests) : null };
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
