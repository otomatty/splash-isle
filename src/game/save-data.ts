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
  /** 船の導入を見終えて町に着いたか。持ち物が空のままでも続きを選べる。 */
  introComplete: boolean;
  /** このファイルを明示的に最初からやり直した時刻。旧セーブと最初の冒険は 0。 */
  resetAt: number;
  /** 同じ時刻に始めた別々のやり直しを区別する。旧形式と最初の冒険は未指定。 */
  runId?: string;
  updatedAt: number;
}

export function validRunId(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|[1-9][0-9]*)-[0-9a-f]{32}$/.test(value);
}

/** resetAtが等しいときは桁数・辞書順で比較。固定長の乱数の前に、先頭ゼロのない世代番号がある。 */
export function compareRuns(a: SaveData, b: SaveData): number {
  if (a.resetAt !== b.resetAt) return a.resetAt < b.resetAt ? -1 : 1;
  const left = a.runId ?? '', right = b.runId ?? '';
  return left.length - right.length || (left < right ? -1 : left > right ? 1 : 0);
}

/** 同じ冒険で別々に取ったものを合わせる。やり直しをまたぐのはベストタイムだけ。 */
export function mergeSaves(a: SaveData, b: SaveData): SaveData {
  const bestMs = a.bestMs === null ? b.bestMs : b.bestMs === null ? a.bestMs : Math.min(a.bestMs, b.bestMs);
  const order = compareRuns(a, b);
  if (order) {
    const newer = order > 0 ? a : b;
    return { ...newer, shells: [...newer.shells], bestMs };
  }
  return {
    v: 1, resetAt: a.resetAt, runId: a.runId, bestMs,
    gems: a.gems | b.gems, revealed: a.revealed | b.revealed,
    stars: a.stars | b.stars, portals: a.portals | b.portals,
    shells: [...new Set([...a.shells, ...b.shells])].sort((x, y) => x - y),
    introComplete: a.introComplete || b.introComplete,
    playMs: Math.max(a.playMs, b.playMs),
    updatedAt: Math.max(a.updatedAt, b.updatedAt),
  };
}
