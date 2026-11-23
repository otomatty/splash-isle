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

async function call<T>(path: string, init?: Pick<RequestInit, 'method' | 'headers' | 'body'>, acceptedStatuses: readonly number[] = []): Promise<T | null> {
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
    if (!res.ok && !acceptedStatuses.includes(res.status)) return null;
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

export interface SlotSnapshot {
  save: SaveData | null;
  revision: number;
}

export const ACCOUNT_CHANGED = 'account_changed';
function changedAccount(result: { error?: string } | null): boolean {
  return result?.error === ACCOUNT_CHANGED || result?.error === 'not_signed_in';
}

export type SaveResult = typeof ACCOUNT_CHANGED | { ok: true; revision: number } | ({ ok: false } & SlotSnapshot);

function validRevision(revision: unknown): revision is number {
  return typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0;
}

function parseSlot(r: { save?: unknown; revision?: unknown } | null): SlotSnapshot | null {
  if (!r || !validRevision(r.revision)) return null;
  if (r.save === null) return r.revision === 0 ? { save: null, revision: 0 } : null;
  const save = sanitizeSave(r.save);
  return save && r.revision > 0 ? { save, revision: r.revision } : null;
}

async function readSlot(slot: SaveSlot = 'A', owner?: string): Promise<SlotSnapshot | typeof ACCOUNT_CHANGED | null> {
  const r = await call<{ error?: string; save?: unknown; revision?: unknown }>(savePath(slot), { headers: ownerHeaders(owner) }, [401, 409]);
  return owner !== undefined && changedAccount(r) ? ACCOUNT_CHANGED : parseSlot(r);
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
  async logout(owner: string): Promise<boolean | typeof ACCOUNT_CHANGED> {
    const r = await call<{ ok?: boolean; error?: string }>('/api/auth/logout', { method: 'POST', headers: ownerHeaders(owner) }, [401, 409]);
    return changedAccount(r) ? ACCOUNT_CHANGED : r?.ok === true;
  },
  readSlot,
  async loadSave(slot: SaveSlot = 'A', owner?: string): Promise<SaveData | null> {
    const result = await readSlot(slot, owner);
    return result && result !== ACCOUNT_CHANGED ? result.save : null;
  },
  async putSave(save: SaveData, slot: SaveSlot, owner: string, revision: number): Promise<SaveResult | null> {
    if (!validRevision(revision)) return null;
    const r = await call<{ ok?: boolean; error?: string; save?: unknown; revision?: unknown }>(savePath(slot), {
      method: 'PUT', headers: ownerHeaders(owner), body: JSON.stringify({ save, revision }),
    }, [401, 409]);
    if (changedAccount(r)) return ACCOUNT_CHANGED;
    if (r?.ok === true && validRevision(r.revision) && r.revision > 0) return { ok: true, revision: r.revision };
    const latest = r?.error === 'save_conflict' ? parseSlot(r) : null;
    return latest ? { ok: false, ...latest } : null;
  },
  async leaderboard(): Promise<RankEntry[] | null> {
    const r = await call<{ entries: RankEntry[] }>('/api/leaderboard');
    return r?.entries ?? null;
  },
};
