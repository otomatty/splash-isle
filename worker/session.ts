import { parseCookies, randomToken, sha256Hex } from './http';

export interface SessionUser {
  id: string;
  name: string;
  picture: string | null;
}

const SESSION_DAYS = 30;

/**
 * Cookie 名。HTTPS では `__Host-` 接頭辞を付け、サブドメインなどから上書きされないようにする。
 * （ローカル開発の http://localhost では接頭辞なし）
 */
export function cookieNames(url: URL): { session: string; oauth: string } {
  const p = url.protocol === 'https:' ? '__Host-' : '';
  return { session: `${p}si_session`, oauth: `${p}si_oauth` };
}

export function setCookie(name: string, value: string, maxAgeSec: number, url: URL): string {
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

export function clearCookie(name: string, url: URL): string {
  return setCookie(name, '', 0, url);
}

/** セッションを発行して Set-Cookie の値を返す。DB にはトークンのハッシュだけを保存する */
export async function createSession(env: Env, userId: string, url: URL): Promise<string> {
  const token = randomToken(32);
  const now = Date.now();
  const ttl = SESSION_DAYS * 24 * 60 * 60;
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, now + ttl * 1000, now)
    .run();
  return setCookie(cookieNames(url).session, token, ttl, url);
}

export async function currentUser(request: Request, env: Env): Promise<SessionUser | null> {
  const url = new URL(request.url);
  const token = parseCookies(request)[cookieNames(url).session];
  if (!token || token.length > 128) return null;
  const row = await env.DB.prepare(
    `SELECT u.id AS id, u.name AS name, u.picture AS picture
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256Hex(token), Date.now())
    .first<SessionUser>();
  return row ?? null;
}

export async function destroySession(request: Request, env: Env): Promise<void> {
  const url = new URL(request.url);
  const token = parseCookies(request)[cookieNames(url).session];
  if (!token || token.length > 128) return;
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
}

export async function purgeExpiredSessions(env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Date.now()).run();
}
