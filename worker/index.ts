/**
 * スプラッシュ・アイル API（Cloudflare Workers）
 *   GET  /api/me              ログイン中のユーザー
 *   GET  /api/auth/login      Google のログイン画面へ
 *   GET  /api/auth/callback   Google からの戻り先
 *   POST /api/auth/logout     ログアウト
 *   GET  /api/save[/B|/C]     クラウドセーブの読み込み（省略時は A）
 *   PUT  /api/save[/B|/C]     クラウドセーブの保存
 *   GET  /api/leaderboard     クリアタイムのランキング
 * それ以外のパスは静的アセット（ゲーム本体）を返す。
 */
import { beginLogin, finishLogin, loginAvailable } from './auth';
import { clearCookie, cookieNames, currentUser, destroySession, type SessionUser } from './session';
import { HttpError, json, readJson } from './http';
import { GEMS_ALL, parseSave } from './save';

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, ctx, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code }, e.status);
      console.error(JSON.stringify({ message: 'unhandled error', path: url.pathname, error: e instanceof Error ? e.message : String(e) }));
      return json({ error: 'internal_error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
  const { pathname } = url;
  const method = request.method;

  // 状態を変える操作は同一オリジンからのリクエストだけ受け付ける（CSRF 対策）
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('Origin');
    if (origin !== url.origin) throw new HttpError(403, 'bad_origin');
  }

  if (pathname === '/api/auth/login' && method === 'GET') return beginLogin(env, url);
  if (pathname === '/api/auth/callback' && method === 'GET') return finishLogin(request, env, ctx, url);

  if (pathname === '/api/me' && method === 'GET') {
    const user = await currentUser(request, env);
    return json({ user: user ? publicUser(user) : null, loginAvailable: loginAvailable(env) });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    await destroySession(request, env);
    return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(cookieNames(url).session, url) });
  }

  if (pathname === '/api/save' || pathname.startsWith('/api/save/')) {
    const slot = pathname === '/api/save' ? 'A' : pathname.slice('/api/save/'.length);
    if (slot !== 'A' && slot !== 'B' && slot !== 'C') throw new HttpError(404, 'not_found');
    const user = await currentUser(request, env);
    if (!user) throw new HttpError(401, 'not_signed_in');
    const owner = request.headers.get('X-Splash-Owner');
    if (owner !== null && owner !== user.id) throw new HttpError(409, 'account_changed');
    if (method === 'GET') {
      const select = slot === 'A'
        ? env.DB.prepare('SELECT data FROM saves WHERE user_id = ?').bind(user.id)
        : env.DB.prepare('SELECT data FROM save_slots WHERE user_id = ? AND slot = ?').bind(user.id, slot);
      const row = await select.first<{ data: string }>();
      return json({ save: row ? (JSON.parse(row.data) as unknown) : null });
    }
    if (method === 'PUT') {
      const body = await readJson(request, 16 * 1024);
      const save = parseSave((body as { save?: unknown } | null)?.save);
      if (!save) throw new HttpError(400, 'invalid_save');
      // ランキングに載せるのは、全クリア済みで現実的なタイムだけ
      const best = save.gems === GEMS_ALL && save.bestMs !== null && save.bestMs >= 60_000 ? save.bestMs : null;
      const now = Date.now();
      // やり直し前や別タブから遅れて届いた保存は、新しい世代・時刻の冒険を巻き戻さない。
      const table = slot === 'A' ? 'saves' : 'save_slots';
      const columns = slot === 'A' ? 'user_id' : 'user_id, slot';
      const values = slot === 'A' ? '?1' : '?1, ?6';
      const version = (row: string) => `(COALESCE(json_extract(${row}.data, '$.resetAt'), 0), COALESCE(json_extract(${row}.data, '$.updatedAt'), 0))`;
      const fresh = `${version('excluded')} >= ${version(table)}`;
      const stmt = env.DB.prepare(
        `INSERT INTO ${table} (${columns}, data, gems, best_time_ms, updated_at) VALUES (${values}, ?2, ?3, ?4, ?5)
         ON CONFLICT(${columns}) DO UPDATE SET
           data = CASE WHEN ${fresh} THEN excluded.data ELSE ${table}.data END,
           gems = CASE WHEN ${fresh} THEN excluded.gems ELSE ${table}.gems END,
           best_time_ms = CASE
             WHEN excluded.best_time_ms IS NULL THEN ${table}.best_time_ms
             WHEN ${table}.best_time_ms IS NULL THEN excluded.best_time_ms
             ELSE MIN(${table}.best_time_ms, excluded.best_time_ms) END,
           updated_at = CASE WHEN ${fresh} THEN excluded.updated_at ELSE ${table}.updated_at END`,
      );
      const args = [user.id, JSON.stringify(save), save.gems, best, now];
      if (slot !== 'A') args.push(slot);
      await stmt.bind(...args).run();
      return json({ ok: true });
    }
    throw new HttpError(405, 'method_not_allowed');
  }

  if (pathname === '/api/leaderboard' && method === 'GET') {
    const user = await currentUser(request, env);
    const { results } = await env.DB.prepare(
      `WITH times AS (
         SELECT user_id, best_time_ms, updated_at FROM saves WHERE best_time_ms IS NOT NULL
         UNION ALL
         SELECT user_id, best_time_ms, updated_at FROM save_slots WHERE best_time_ms IS NOT NULL
       )
       SELECT u.id AS id, u.name AS name, MIN(t.best_time_ms) AS best
       FROM times t JOIN users u ON u.id = t.user_id
       GROUP BY u.id, u.name
       ORDER BY best ASC, MAX(t.updated_at) ASC, u.id ASC
       LIMIT 20`,
    ).all<{ id: string; name: string; best: number }>();
    const entries = results.map((r, i) => ({ rank: i + 1, name: r.name, bestMs: r.best, me: user?.id === r.id }));
    return json({ entries });
  }

  throw new HttpError(404, 'not_found');
}

function publicUser(u: SessionUser): { id: string; name: string; picture: string | null } {
  return { id: u.id, name: u.name, picture: u.picture };
}
