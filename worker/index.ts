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
import { compareRuns, mergeSaves, type SaveData } from '../src/game/save-data';

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
    const owner = request.headers.get('X-Splash-Owner');
    if (!owner) throw new HttpError(428, 'owner_required');
    const user = await currentUser(request, env);
    if (user?.id !== owner) throw new HttpError(409, 'account_changed');
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
    const latest = async () => {
      const select = slot === 'A'
        ? env.DB.prepare('SELECT data, revision FROM saves WHERE user_id = ?').bind(user.id)
        : env.DB.prepare('SELECT data, revision FROM save_slots WHERE user_id = ? AND slot = ?').bind(user.id, slot);
      const row = await select.first<{ data: string; revision: number }>();
      if (!row) return { save: null, revision: 0 };
      const save = parseSave(JSON.parse(row.data));
      if (!save) throw new HttpError(500, 'invalid_stored_save');
      return { save, revision: row.revision };
    };
    if (method === 'GET') return json(await latest());
    if (method === 'PUT') {
      const body = await readJson(request, 16 * 1024) as { save?: unknown; revision?: unknown } | null;
      const save = parseSave(body?.save);
      if (!save) throw new HttpError(400, 'invalid_save');
      const revision = body?.revision;
      if (revision !== undefined && (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)) {
        throw new HttpError(400, 'invalid_revision');
      }
      // ランキングに載せるのは、全クリア済みで現実的なタイムだけ
      const best = save.gems === GEMS_ALL && save.bestMs !== null && save.bestMs >= 60_000 ? save.bestMs : null;
      const table = slot === 'A' ? 'saves' : 'save_slots';
      const columns = slot === 'A' ? 'user_id' : 'user_id, slot';
      const values = slot === 'A' ? '?1' : '?1, ?6';
      const key = slot === 'A' ? 'user_id = ?1' : 'user_id = ?1 AND slot = ?6';
      const write = async (next: SaveData, expected: number) => {
        const args = [user.id, JSON.stringify(next), next.gems, best, Date.now()];
        if (slot !== 'A') args.push(slot);
        const query = expected === 0
          ? `INSERT INTO ${table} (${columns}, data, gems, best_time_ms, updated_at)
             VALUES (${values}, ?2, ?3, ?4, ?5) ON CONFLICT(${columns}) DO NOTHING RETURNING revision`
          : `UPDATE ${table} SET
               data = CASE WHEN json_extract(data, '$.bestMs') > 0 AND
                    (json_extract(?2, '$.bestMs') IS NULL OR json_extract(data, '$.bestMs') < json_extract(?2, '$.bestMs'))
                  THEN json_set(?2, '$.bestMs', json_extract(data, '$.bestMs')) ELSE ?2 END,
               gems = ?3, updated_at = ?5, revision = revision + 1,
               best_time_ms = CASE WHEN ?4 IS NULL THEN best_time_ms WHEN best_time_ms IS NULL THEN ?4
                                   ELSE MIN(best_time_ms, ?4) END
             WHERE ${key} AND revision = ?${args.length + 1}
               AND (COALESCE(json_extract(data, '$.resetAt'), 0), length(COALESCE(json_extract(data, '$.runId'), '')),
                    COALESCE(json_extract(data, '$.runId'), ''))
                <= (json_extract(?2, '$.resetAt'), length(COALESCE(json_extract(?2, '$.runId'), '')),
                    COALESCE(json_extract(?2, '$.runId'), ''))
             RETURNING revision`;
        if (expected !== 0) args.push(expected);
        const row = await env.DB.prepare(query).bind(...args).first<{ revision: number }>();
        return row ? json({ ok: true, revision: row.revision }) : null;
      };
      if (revision !== undefined) {
        const result = await write(save, revision);
        return result ?? json({ error: 'save_conflict', ...await latest() }, 409);
      }
      // 旧クライアントは版を送らない。サーバーで同じ冒険の収集物を合わせ、読んだ版にだけ保存する。
      let current = await latest();
      for (let attempt = 0; attempt < 3; attempt++) {
        if (current.save && compareRuns(current.save, save) > 0) break;
        const next = current.save ? mergeSaves(current.save, save) : save;
        const result = await write(next, current.revision);
        if (result) return result;
        current = await latest();
      }
      return json({ error: 'save_conflict', ...current }, 409);
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
