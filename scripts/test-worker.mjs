// Worker（API・Google ログイン）の結合テスト。
// 実際の Worker コードを Miniflare（ローカルの Workers ランタイム）で動かし、Google のトークン発行と公開鍵の
// エンドポイントだけを偽物に差し替えて、ログイン → セーブ → ランキング → ログアウトまでを通しで確かめる。
import mfpkg from 'miniflare';
const { Miniflare, Response: MfResponse, convertV4MiniflareOptions } = mfpkg;
import { build } from 'esbuild';
import { readdirSync, readFileSync } from 'node:fs';
import { generateKeyPairSync, createSign, createHash } from 'node:crypto';

const { outputFiles } = await build({ entryPoints: ['worker/index.ts'], bundle: true, format: 'esm', target: 'es2022', write: false });
const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const b64u = (x) => Buffer.from(x).toString('base64url');
const signJwt = (claims, key = privateKey, kid = 'test-key') => {
  const head = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })), body = b64u(JSON.stringify(claims));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url');
  return `${head}.${body}.${sig}`;
};

let nextIdToken = '';
let seenTokenRequest = null;
// Worker から外へ出るリクエストは全てここを通す（本物の Google には接続しない）
const outboundService = async (request) => {
  const u = new URL(request.url);
  if (u.href === 'https://oauth2.googleapis.com/token' && request.method === 'POST') {
    seenTokenRequest = await request.text();
    return MfResponse.json({ id_token: nextIdToken, access_token: 'x' });
  }
  if (u.href === 'https://www.googleapis.com/oauth2/v3/certs') return MfResponse.json({ keys: [jwk] });
  return new MfResponse('blocked', { status: 599 });
};

const workerOptions = (bindings) => convertV4MiniflareOptions({
    modules: true,
    script: outputFiles[0].text,
    compatibilityDate: '2026-11-01',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'test-db' },
    bindings,
    serviceBindings: { ASSETS: () => new MfResponse('<!doctype html>game', { headers: { 'content-type': 'text/html' } }) },
    outboundService,
  });
const mf = new Miniflare(workerOptions({ GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: 'test-secret' }));
const db = await mf.getD1Database('DB');
const applyMigration = async (file) => {
  const sql = readFileSync('migrations/' + file, 'utf8').replace(/--.*$/gm, '');
  for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
};
await applyMigration('0001_init.sql');

const ORIGIN = 'https://game.test';
let pass = 0, failN = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ok   ${name}`); } else { failN++; console.log(`  FAIL ${name} ${extra}`); } };
const call = (path, init = {}, cookies = '') => mf.dispatchFetch(ORIGIN + path, { redirect: 'manual', ...init, headers: { ...(cookies ? { Cookie: cookies } : {}), ...(init.headers ?? {}) } });
const cookieOf = (res, name) => { for (const c of res.headers.getSetCookie()) if (c.startsWith(name + '=')) return c; return null; };
const val = (c) => c.split(';')[0];

console.log('静的アセットと未ログイン状態');
let r = await call('/');
check('/ はゲーム本体を返す', r.status === 200 && (await r.text()).includes('game'));
r = await call('/api/me');
const guestSession = await r.json();
check('/api/me は未ログインで user:null、OAuth 設定済みならログイン可能', r.status === 200 && guestSession.user === null && guestSession.loginAvailable === true);
r = await call('/api/save');
check('未ログインの /api/save は 401', r.status === 401); await r.arrayBuffer();
r = await call('/api/nope');
check('未知の API は 404 JSON', r.status === 404 && (await r.json()).error === 'not_found');

console.log('ログイン開始');
r = await call('/api/auth/login');
const loc = new URL(r.headers.get('location'));
const oauthCookie = cookieOf(r, '__Host-si_oauth');
check('Google へ 302 リダイレクト', r.status === 302 && loc.origin === 'https://accounts.google.com');
check('client_id / redirect_uri / scope が正しい', loc.searchParams.get('client_id') === CLIENT_ID && loc.searchParams.get('redirect_uri') === ORIGIN + '/api/auth/callback' && loc.searchParams.get('scope') === 'openid profile');
check('PKCE(S256) と state・nonce を付けている', loc.searchParams.get('code_challenge_method') === 'S256' && !!loc.searchParams.get('code_challenge') && !!loc.searchParams.get('state') && !!loc.searchParams.get('nonce'));
check('検証用 Cookie は __Host- / HttpOnly / Secure / SameSite=Lax', !!oauthCookie && /HttpOnly/.test(oauthCookie) && /Secure/.test(oauthCookie) && /SameSite=Lax/.test(oauthCookie) && /Path=\//.test(oauthCookie));
const [st, nonce, verifier] = val(oauthCookie).split('=')[1].split('.');
check('code_challenge は verifier の SHA-256', createHash('sha256').update(verifier).digest('base64url') === loc.searchParams.get('code_challenge'));
check('state は URL と Cookie で一致', st === loc.searchParams.get('state'));

const now = Math.floor(Date.now() / 1000);
const goodClaims = { iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'google-user-1', exp: now + 600, iat: now, nonce, name: 'テスト プレイヤー', picture: 'https://lh3.googleusercontent.com/a/test' };

console.log('不正なコールバックは拒否');
r = await call(`/api/auth/callback?code=abc&state=WRONG`, {}, val(oauthCookie));
check('state 不一致 → ログイン失敗', r.status === 302 && r.headers.get('location') === '/?login=failed' && !cookieOf(r, '__Host-si_session'));
r = await call(`/api/auth/callback?code=abc&state=${st}`);
check('Cookie なし → ログイン失敗', r.headers.get('location') === '/?login=failed');
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
nextIdToken = signJwt(goodClaims, other.privateKey);
r = await call(`/api/auth/callback?code=abc&state=${st}`, {}, val(oauthCookie));
check('別の鍵で署名された ID トークン → 失敗', r.headers.get('location') === '/?login=failed' && !cookieOf(r, '__Host-si_session'));
for (const [label, bad] of [['aud 違い', { aud: 'someone-else' }], ['iss 違い', { iss: 'https://evil.example' }], ['期限切れ', { exp: now - 3600 }], ['nonce 違い', { nonce: 'nope' }]]) {
  nextIdToken = signJwt({ ...goodClaims, ...bad });
  r = await call(`/api/auth/callback?code=abc&state=${st}`, {}, val(oauthCookie));
  check(`${label} → 失敗`, r.headers.get('location') === '/?login=failed' && !cookieOf(r, '__Host-si_session'));
}

console.log('正しいコールバックでログイン成立');
nextIdToken = signJwt(goodClaims);
r = await call(`/api/auth/callback?code=the-code&state=${st}`, {}, val(oauthCookie));
const sessCookie = cookieOf(r, '__Host-si_session');
check('302 で / に戻り、セッション Cookie を発行', r.status === 302 && r.headers.get('location') === '/' && !!sessCookie && /HttpOnly/.test(sessCookie) && /Secure/.test(sessCookie));
check('トークン交換に code・code_verifier・client_secret を送っている', /code=the-code/.test(seenTokenRequest) && seenTokenRequest.includes(`code_verifier=${verifier}`) && /client_secret=test-secret/.test(seenTokenRequest) && /grant_type=authorization_code/.test(seenTokenRequest));
const S = val(sessCookie);
r = await call('/api/me', {}, S);
const me = (await r.json()).user;
check('/api/me がユーザーを返す', me && me.name === 'テスト プレイヤー' && me.picture.startsWith('https://'));
const row = await db.prepare('SELECT token_hash FROM sessions').first();
check('DB にはトークンのハッシュだけを保存', row.token_hash !== S.split('=')[1] && row.token_hash === createHash('sha256').update(S.split('=')[1]).digest('hex'));

console.log('セーブとランキング');
const save = { v: 1, gems: 3, revealed: 11, shells: [0, 4, 9], stars: 5, portals: 1, playMs: 61000, bestMs: null, updatedAt: Date.now() };
// 本番にすでに存在する旧スキーマの A。二つ目の migration をその上に適用する。
await db.prepare('INSERT INTO saves (user_id, data, gems, updated_at) VALUES (?, ?, ?, ?)')
  .bind(me.id, JSON.stringify(save), save.gems, save.updatedAt).run();
for (const file of readdirSync('migrations').filter(f => f.endsWith('.sql') && f > '0001_init.sql').sort()) await applyMigration(file);
const getSlot = async (slot, cookie = S) => (await (await call('/api/save' + (slot ? '/' + slot : ''), {}, cookie)).json()).save;
const put = (body, cookies, origin = ORIGIN, slot = '', owner) => call('/api/save' + (slot ? '/' + slot : ''), {
  method: 'PUT', body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}), ...(owner === undefined ? {} : { 'X-Splash-Owner': owner }) },
}, cookies);
check('移行前のセーブが従来の URL と A の両方で読み出せる', (await getSlot('')).gems === 3 && (await getSlot('A')).shells.join() === '0,4,9');
check('B と C は A の進捗を引き継がず空で始まる', await getSlot('B') === null && await getSlot('C') === null);
r = await put({ save }, S, ORIGIN, 'D');
check('存在しないファイルへの保存は A に流れない', r.status === 404); await r.arrayBuffer();
r = await put({ save: { ...save, introComplete: 'true' } }, S, ORIGIN, 'C');
check('壊れた導入フラグは拒否する', r.status === 400); await r.arrayBuffer();
r = await put({ save }, S, 'https://evil.example');
check('別オリジンからの PUT は 403', r.status === 403); await r.arrayBuffer();
r = await put({ save }, S, null);
check('Origin なしの PUT は 403', r.status === 403); await r.arrayBuffer();
r = await put({ save: { ...save, gems: 99999 } }, S);
check('壊れたセーブは 400', r.status === 400); await r.arrayBuffer();
r = await put({ save: { ...save, shells: Array(5000).fill(1) }, pad: 'x'.repeat(20000) }, S);
check('大きすぎる本文は 413', r.status === 413); await r.arrayBuffer();
r = await put({ save: { ...save, portals: 9 } }, S);
check('入口の状態が範囲外なら 400', r.status === 400); await r.arrayBuffer();
const { portals: _omit, ...oldSave } = save;
r = await put({ save: oldSave }, S);
check('入口の項目がない古い形式のセーブも受け付ける', r.status === 200); await r.arrayBuffer();
r = await put({ save }, S);
check('正しいセーブは保存できる', r.status === 200 && (await r.json()).ok === true);
r = await call('/api/save', {}, S);
{ const back = (await r.json()).save; check('保存したセーブを読み戻せる（入口の状態も）', JSON.stringify(back.shells) === '[0,4,9]' && back.portals === 1); }
r = await call('/api/leaderboard', {}, S);
check('未クリアならランキングは空', (await r.json()).entries.length === 0);
r = await put({ save: { ...save, gems: 16383, revealed: 31, bestMs: 185000 } }, S); await r.arrayBuffer();
r = await put({ save: { ...save, gems: 16383, revealed: 31, bestMs: 240000 } }, S); await r.arrayBuffer();
r = await call('/api/leaderboard', {}, S);
let lb = (await r.json()).entries;
r = await put({ save: { ...save, gems: 31, revealed: 31, bestMs: 100000 } }, S); await r.arrayBuffer();
r = await call('/api/leaderboard', {}, S); lb = (await r.json()).entries;
check('14個そろっていない記録は載せない', lb.length === 1 && lb[0].bestMs === 185000);
check('クリアタイムが載り、遅い記録では上書きされない', lb.length === 1 && lb[0].bestMs === 185000 && lb[0].me === true && lb[0].rank === 1);
r = await put({ save: { ...save, gems: 16383, revealed: 31, bestMs: 5000 } }, S); await r.arrayBuffer();
r = await call('/api/leaderboard');
lb = (await r.json()).entries;
check('ありえない速さの記録は載せない／未ログインでも閲覧可', lb[0].bestMs === 185000 && lb[0].me === false);

const saveB = { ...save, gems: 16383, bestMs: 172000, introComplete: true, resetAt: 0, updatedAt: save.updatedAt + 30 };
r = await put({ save: saveB }, S, ORIGIN, 'B', me.id);
check('ユーザーを指定して本人の B に保存できる', r.status === 200 && (await r.json()).ok);
r = await call('/api/save/B', { headers: { 'X-Splash-Owner': me.id } }, S);
check('ユーザーを指定して本人の B を読める', r.status === 200 && (await r.json()).save.bestMs === saveB.bestMs);
const saveC = { ...save, gems: 0, stars: 0, portals: 0, shells: [], revealed: 10, playMs: 0, introComplete: true, resetAt: 0 };
r = await put({ save: saveC }, S, ORIGIN, 'C'); await r.arrayBuffer();
check('導入だけを見終えた C も三つのファイルを独立して読み戻せる',
  (await getSlot('')).bestMs === 5000 && (await getSlot('B')).bestMs === 172000 && (await getSlot('C')).introComplete === true);
const resetB = { ...saveC, introComplete: false, resetAt: saveB.updatedAt + 50, updatedAt: saveB.updatedAt + 50, bestMs: 172000 };
r = await put({ save: resetB }, S, ORIGIN, 'B'); await r.arrayBuffer();
r = await put({ save: { ...saveB, updatedAt: resetB.updatedAt + 500 } }, S, ORIGIN, 'B'); await r.arrayBuffer();
check('やり直し前のタブから遅れて届いた保存で B は復活せず、A・C は維持される',
  (await getSlot('B')).gems === 0 && (await getSlot('B')).resetAt === resetB.resetAt && (await getSlot('C')).introComplete && (await getSlot('')).gems === 16383);
const latestB = { ...resetB, introComplete: true, shells: [8], updatedAt: resetB.updatedAt + 10 };
r = await put({ save: latestB }, S, ORIGIN, 'B'); await r.arrayBuffer();
r = await put({ save: resetB }, S, ORIGIN, 'B'); await r.arrayBuffer();
check('同じ冒険の順番が前後した保存でも新しい進捗を維持する', (await getSlot('B')).shells.join() === '8');
r = await call('/api/leaderboard', {}, S);
lb = (await r.json()).entries;
check('三つの冒険からひとりの最速記録が残り、ファイルのやり直し後も維持される', lb.length === 1 && lb[0].bestMs === 172000);

console.log('2人目のユーザーと再ログイン');
r = await call('/api/auth/login');
const oc2 = cookieOf(r, '__Host-si_oauth'); const [st2, nonce2] = val(oc2).split('=')[1].split('.');
nextIdToken = signJwt({ ...goodClaims, sub: 'google-user-2', nonce: nonce2, name: 'ふたりめ' });
r = await call(`/api/auth/callback?code=c2&state=${st2}`, {}, val(oc2));
const S2 = val(cookieOf(r, '__Host-si_session'));
check('別のプレイヤーから B のセーブは見えない', await getSlot('B', S2) === null);
r = await call('/api/save/B', { headers: { 'X-Splash-Owner': me.id } }, S2);
check('別タブでログイン先が変わると前のユーザーとして読めない', r.status === 409 && (await r.json()).error === 'account_changed');
r = await put({ save }, S2, ORIGIN, 'B', me.id);
check('前のタブからの保存は 409 で拒否し、どちらの B も変更しない',
  r.status === 409 && (await r.json()).error === 'account_changed' && await getSlot('B', S2) === null && (await getSlot('B', S)).shells.join() === '8');
r = await put({ save: { ...save, gems: 16383, revealed: 31, bestMs: 150000 } }, S2); await r.arrayBuffer();
r = await call('/api/leaderboard', {}, S);
lb = (await r.json()).entries;
check('ランキングは速い順', lb.length === 2 && lb[0].name === 'ふたりめ' && lb[1].me === true && lb[1].rank === 2);
check('ユーザーは Google の sub ごとに1行', (await db.prepare('SELECT COUNT(*) AS n FROM users').first()).n === 2);

console.log('ログアウト');
r = await call('/api/auth/logout', { method: 'POST' }, S);
check('Origin なしのログアウトは 403', r.status === 403); await r.arrayBuffer();
r = await call('/api/auth/logout', { method: 'POST', headers: { Origin: ORIGIN } }, S);
check('ログアウトで Cookie を消す', r.status === 200 && /Max-Age=0/.test(cookieOf(r, '__Host-si_session'))); await r.arrayBuffer();
r = await call('/api/me', {}, S);
check('ログアウト後は古い Cookie が無効', (await r.json()).user === null);

await mf.setOptions(workerOptions({}));
r = await call('/api/me');
const localSession = await r.json();
check('OAuth 未設定の Worker でもゲストで使え、ログイン機能は無効', r.status === 200 && localSession.user === null && localSession.loginAvailable === false);

console.log(`\n${pass} passed, ${failN} failed`);
await mf.dispose();
process.exit(failN ? 1 : 0);
