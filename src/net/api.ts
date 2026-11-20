import { sanitizeSave, type SaveData } from '../game/state';

export interface User {
  id: string;
  name: string;
  picture: string | null;
}

export interface RankEntry {
  rank: number;
  name: string;
  bestMs: number;
  me: boolean;
}

/** 1ファイル版（サーバーなし）では API を使わない */
export const STANDALONE = import.meta.env.VITE_STANDALONE === '1';

async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (STANDALONE) return null;
  try {
    const res = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) return null;
    return (await res.json()) as T;
  } catch {
    return null; // オフラインやサーバー停止時はゲストとして続行
  }
}

export const api = {
  /** サーバーが使えるか・ログイン中かを調べる */
  async me(): Promise<{ available: boolean; user: User | null }> {
    const r = await call<{ user: User | null }>('/api/me');
    return { available: r !== null, user: r?.user ?? null };
  },
  login(): void {
    window.location.href = '/api/auth/login';
  },
  async logout(): Promise<void> {
    await call('/api/auth/logout', { method: 'POST' });
  },
  async loadSave(): Promise<SaveData | null> {
    const r = await call<{ save: unknown }>('/api/save');
    return r ? sanitizeSave(r.save) : null;
  },
  async putSave(save: SaveData): Promise<boolean> {
    const r = await call<{ ok: boolean }>('/api/save', { method: 'PUT', body: JSON.stringify({ save }) });
    return !!r?.ok;
  },
  async leaderboard(): Promise<RankEntry[] | null> {
    const r = await call<{ entries: RankEntry[] }>('/api/leaderboard');
    return r?.entries ?? null;
  },
};
