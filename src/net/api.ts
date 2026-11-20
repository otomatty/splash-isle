import { sanitizeSave, type SaveData, type SaveSlot } from '../game/state';

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

async function call<T>(path: string, init?: Pick<RequestInit, 'method' | 'headers' | 'body'>): Promise<T | null> {
  if (STANDALONE) return null;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(path, {
      credentials: 'same-origin',
      signal: controller.signal,
      ...init,
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
    if (!res.ok) return null;
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

function savePath(slot: SaveSlot): string {
  return slot === 'A' ? '/api/save' : '/api/save/' + slot;
}

function ownerHeaders(owner?: string): Record<string, string> {
  return owner === undefined ? {} : { 'X-Splash-Owner': owner };
}

async function readSlot(slot: SaveSlot = 'A', owner?: string): Promise<{ save: SaveData | null } | null> {
  const r = await call<{ save: unknown }>(savePath(slot), { headers: ownerHeaders(owner) });
  if (!r) return null;
  if (r.save === null) return { save: null };
  const save = sanitizeSave(r.save);
  return save ? { save } : null;
}

export const api = {
  /** サーバーが使えるか・ログイン中かを調べる */
  async me(): Promise<{ available: boolean; loginAvailable: boolean; user: User | null }> {
    const r = await call<{ user: User | null; loginAvailable?: boolean }>('/api/me');
    return { available: r !== null, loginAvailable: r !== null && r.loginAvailable !== false, user: r?.user ?? null };
  },
  login(): void {
    window.location.href = '/api/auth/login';
  },
  async logout(): Promise<boolean> {
    const r = await call<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
    return r?.ok === true;
  },
  readSlot,
  async loadSave(slot: SaveSlot = 'A', owner?: string): Promise<SaveData | null> {
    return (await readSlot(slot, owner))?.save ?? null;
  },
  async putSave(save: SaveData, slot: SaveSlot = 'A', owner?: string): Promise<boolean> {
    const r = await call<{ ok: boolean }>(savePath(slot), { method: 'PUT', headers: ownerHeaders(owner), body: JSON.stringify({ save }) });
    return !!r?.ok;
  },
  async leaderboard(): Promise<RankEntry[] | null> {
    const r = await call<{ entries: RankEntry[] }>('/api/leaderboard');
    return r?.entries ?? null;
  },
};
