/**
 * Google ログイン（OAuth 2.0 認可コードフロー + PKCE、OpenID Connect）
 *   1. /api/auth/login    … state・nonce・PKCE の検証値を HttpOnly Cookie に入れて Google へリダイレクト
 *   2. /api/auth/callback … state を照合 → 認可コードをトークンに交換 → ID トークンの署名と中身を検証
 *                            → ユーザーを登録／更新 → セッション Cookie を発行
 */
import { HttpError, base64url, base64urlDecode, json, parseCookies, randomToken, safeEqual, sha256 } from './http';
import { clearCookie, cookieNames, createSession, purgeExpiredSessions, setCookie } from './session';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

function redirectUri(url: URL): string {
  return `${url.origin}/api/auth/callback`;
}

export function loginAvailable(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export async function beginLogin(env: Env, url: URL): Promise<Response> {
  if (!loginAvailable(env)) return json({ error: 'oauth_not_configured' }, 503);
  const state = randomToken(24);
  const nonce = randomToken(24);
  const verifier = randomToken(48);
  const challenge = base64url(await sha256(verifier));
  const q = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(url),
    response_type: 'code',
    scope: 'openid profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${AUTH_URL}?${q.toString()}`,
      'Set-Cookie': setCookie(cookieNames(url).oauth, `${state}.${nonce}.${verifier}`, 600, url),
      'Cache-Control': 'no-store',
    },
  });
}

export async function finishLogin(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const names = cookieNames(url);
  const fail = (reason: string): Response => {
    console.log(JSON.stringify({ message: 'login failed', reason }));
    return new Response(null, {
      status: 302,
      headers: { Location: '/?login=failed', 'Set-Cookie': clearCookie(names.oauth, url), 'Cache-Control': 'no-store' },
    });
  };
  if (!loginAvailable(env)) return fail('not_configured');

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const [cState, cNonce, cVerifier] = (parseCookies(request)[names.oauth] ?? '').split('.');
  if (!code || !state || !cState || !cNonce || !cVerifier) return fail(url.searchParams.get('error') ?? 'missing_params');
  if (!(await safeEqual(state, cState))) return fail('state_mismatch');

  // 認可コード → トークン
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(url),
      grant_type: 'authorization_code',
      code_verifier: cVerifier,
    }),
  });
  if (!tokenRes.ok) {
    await tokenRes.body?.cancel();
    return fail(`token_exchange_${tokenRes.status}`);
  }
  const token = (await tokenRes.json()) as { id_token?: string };
  if (!token.id_token) return fail('no_id_token');

  let claims: IdClaims;
  try {
    claims = await verifyIdToken(token.id_token, env.GOOGLE_CLIENT_ID, cNonce);
  } catch (e) {
    return fail(e instanceof HttpError ? e.code : 'id_token_invalid');
  }

  // ユーザーを登録／更新（保存するのは表示名とアイコンだけ。メールアドレスは受け取らない）
  const now = Date.now();
  const name = (claims.name ?? claims.given_name ?? 'プレイヤー').slice(0, 24);
  const picture = typeof claims.picture === 'string' && claims.picture.startsWith('https://') ? claims.picture.slice(0, 512) : null;
  const row = await env.DB.prepare(
    `INSERT INTO users (id, google_sub, name, picture, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
     ON CONFLICT(google_sub) DO UPDATE SET name = excluded.name, picture = excluded.picture, updated_at = excluded.updated_at
     RETURNING id`,
  )
    .bind(crypto.randomUUID(), claims.sub, name, picture, now)
    .first<{ id: string }>();
  if (!row) return fail('user_upsert_failed');

  const sessionCookie = await createSession(env, row.id, url);
  ctx.waitUntil(purgeExpiredSessions(env));

  const headers = new Headers({ Location: '/', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', sessionCookie);
  headers.append('Set-Cookie', clearCookie(names.oauth, url));
  return new Response(null, { status: 302, headers });
}

interface IdClaims {
  iss: string;
  aud: string;
  sub: string;
  exp: number;
  nonce?: string;
  name?: string;
  given_name?: string;
  picture?: string;
}

interface Jwk extends JsonWebKey {
  kid?: string;
}

/** ID トークン（JWT, RS256）を Google の公開鍵で検証する */
async function verifyIdToken(idToken: string, clientId: string, nonce: string): Promise<IdClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new HttpError(400, 'jwt_malformed');
  const dec = new TextDecoder();
  const header = JSON.parse(dec.decode(base64urlDecode(parts[0]))) as { alg?: string; kid?: string };
  const claims = JSON.parse(dec.decode(base64urlDecode(parts[1]))) as IdClaims;
  if (header.alg !== 'RS256' || !header.kid) throw new HttpError(400, 'jwt_alg');

  // 公開鍵はエッジでキャッシュする（Google は定期的に鍵を入れ替える）
  const res = await fetch(JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(502, 'jwks_unavailable');
  }
  const { keys } = (await res.json()) as { keys: Jwk[] };
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new HttpError(400, 'jwt_unknown_key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64urlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new HttpError(400, 'jwt_signature');

  if (!ISSUERS.includes(claims.iss)) throw new HttpError(400, 'jwt_issuer');
  if (claims.aud !== clientId) throw new HttpError(400, 'jwt_audience');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now() - 60_000) throw new HttpError(400, 'jwt_expired');
  if (!claims.nonce || !(await safeEqual(claims.nonce, nonce))) throw new HttpError(400, 'jwt_nonce');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new HttpError(400, 'jwt_subject');
  return claims;
}
