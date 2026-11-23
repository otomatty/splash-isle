// 開発用: Worker の応答を再現し、ログイン・ファイル選択・島に着くまでを実際の入力で検査する。
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import './test-local-saves.mjs';

const url = new URL(process.argv[2] ?? 'http://localhost:4173/');
url.searchParams.set('debug', '');
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
  protocolTimeout: 180000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'],
});
const legacyKey = 'splash-isle-save-v1';
const legacySave = { v: 1, gems: 2, revealed: 10, shells: [4], stars: 0, portals: 0, playMs: 17000, bestMs: null, updatedAt: 1000 };
const errors = [];

async function openPage(api, disableWebGL = false, localFiles = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluateOnNewDocument((key, save, disableWebGL, localFiles) => {
    if (!sessionStorage.getItem('fixture-ready')) {
      localStorage.setItem(key, JSON.stringify(save));
      for (const [name, data] of Object.entries(localFiles)) localStorage.setItem(name, JSON.stringify(data));
      sessionStorage.setItem('fixture-ready', '1');
    }
    window.webglRequests = 0;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (/webgl/i.test(type)) {
        window.webglRequests++;
        if (disableWebGL) return null;
      }
      return getContext.call(this, type, ...args);
    };
  }, legacyKey, legacySave, disableWebGL, localFiles);
  await page.setRequestInterception(true);
  page.on('request', async (request) => {
    const path = new URL(request.url()).pathname;
    if (!path.startsWith('/api/')) return request.continue();
    const reply = await api(path, request);
    await request.respond({ contentType: 'application/json', ...reply });
  });
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  return page;
}

async function click(page, id) {
  try {
    await page.locator('#' + id).click();
  } catch (cause) {
    throw new Error(id + ' を押せませんでした', { cause });
  }
}
const visible = (page, id) => page.waitForSelector('#' + id, { visible: true });
const waitForGame = (page) => page.waitForFunction(() => window.__splash?.mode === 'playing', { timeout: 120000 });
const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
const json = (data) => ({ status: 200, body: JSON.stringify(data) });
const activeSlot = (page) => page.$eval('#title [aria-pressed="true"]', (button) => button.id);

async function checkLightweight(page) {
  const state = await page.evaluate(() => ({
    contexts: window.webglRequests,
    game: typeof window.__splash,
    worldRequests: performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname)
      .filter((path) => /\/(?:gameplay[.-]|three[._-]|src\/world\/)/i.test(path)),
  }));
  assert.deepEqual(state, { contexts: 0, game: 'undefined', worldRequests: [] }, 'メニュー・プロローグは3Dを読み込まない');
}

async function guest() {
  const page = await openPage(() => ({ status: 503, body: '{}' }));
  await click(page, 'btnGuest');
  await visible(page, 'title');
  // 標準ゲームパッドの十字キー右。メニューが実際のフォーカスと選択を一緒に動かす。
  await page.evaluate(() => {
    const pad = { connected: true, mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
    window.dispatchEvent(new Event('gamepadconnected'));
    // B にフォーカスが移った瞬間に離し、長押しとして次のファイルに進むのを防ぐ。
    document.getElementById('slotB').addEventListener('focus', () => { pad.buttons[15].pressed = false; }, { once: true });
    pad.buttons[15].pressed = true;
  });
  await page.waitForFunction(() => document.activeElement.id === 'slotB' && document.activeElement.getAttribute('aria-pressed') === 'true');
  await page.evaluate(() => {
    delete navigator.getGamepads;
    window.dispatchEvent(new Event('gamepaddisconnected'));
  });
  await click(page, 'btnSettings');
  await visible(page, 'settings');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#settings', { hidden: true });
  await click(page, 'slotA');
  assert.match(await page.$eval('#btnPlay', (el) => el.textContent), /つづき/);

  // 旧Aを最初から遊びたい場合も、導入をキャンセルした時点では以前の冒険を保持する。
  await click(page, 'btnNew');
  await click(page, 'cancelRestart');
  await visible(page, 'title');
  assert.equal((await stored(page, legacyKey)).gems, legacySave.gems);
  await click(page, 'btnNew');
  await click(page, 'confirmRestart');
  await visible(page, 'prologue');
  await click(page, 'storyMenu');
  await visible(page, 'title');
  assert.equal((await stored(page, legacyKey)).gems, legacySave.gems);

  await click(page, 'slotB');
  await click(page, 'btnPlay');
  await visible(page, 'prologue');
  const first = await page.$eval('#prologue', (el) => el.innerText);
  await click(page, 'storyNext');
  assert.notEqual(await page.$eval('#prologue', (el) => el.innerText), first);
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction((text) => document.getElementById('prologue').innerText === text, {}, first);
  await page.keyboard.press('Escape');
  await visible(page, 'title');
  assert.equal(await stored(page, legacyKey + '-B'), null);
  await checkLightweight(page);

  await click(page, 'btnPlay');
  await click(page, 'storyNext');
  await click(page, 'storyNext');
  await checkLightweight(page);
  await click(page, 'storyNext');
  await waitForGame(page);
  assert.equal(await page.evaluate(() => window.webglRequests > 0), true);
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key))?.introComplete, {}, legacyKey + '-B');
  assert.equal((await stored(page, legacyKey)).gems, legacySave.gems);
  assert.equal(await stored(page, legacyKey + '-C'), null);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await click(page, 'btnGuest');
  await click(page, 'slotB');
  assert.match(await page.$eval('#btnPlay', (el) => el.textContent), /つづき/);
  await checkLightweight(page);
  await page.browserContext().close();
  console.log('ok  ゲストのA/B/C、旧セーブ、導入の前後とキャンセル、初回上陸後の再読み込み');
}

async function unavailableGraphics() {
  const page = await openPage(() => json({ user: null, loginAvailable: false }), true);
  await click(page, 'btnGuest');
  await click(page, 'slotA');
  await click(page, 'btnNew');
  await click(page, 'confirmRestart');
  await click(page, 'storyNext');
  await click(page, 'storyNext');
  await checkLightweight(page);
  await click(page, 'storyNext');
  await page.waitForFunction(() => window.webglRequests > 0);
  await page.waitForSelector('#loading', { hidden: true });
  const previous = await stored(page, legacyKey);
  assert.equal(previous.gems, legacySave.gems);
  assert.deepEqual(previous.shells, legacySave.shells);
  await page.browserContext().close();
  console.log('ok  WebGL非対応でも導入を読め、上陸に失敗しても以前の冒険を保持する');
}

// Workerと同じく、読んだ版と一致する書き込みだけを受理する。別端末の書き込みも版を進める。
function cloudFiles(account, initial) {
  const rows = Object.fromEntries(['A', 'B', 'C'].map((slot) =>
    [slot, { save: initial[slot] ?? null, revision: initial[slot] ? 1 : 0 }]));
  const reads = [], writes = [];
  function commit(slot, save) {
    rows[slot] = { save, revision: rows[slot].revision + 1 };
  }
  function respond(path, request) {
    const file = path.match(/^\/api\/save(?:\/([BC]))?$/);
    if (!file) return { status: 404, body: '{}' };
    const slot = file[1] ?? 'A', row = rows[slot];
    assert.equal(request.headers()['x-splash-owner'], account.id);
    if (request.method() === 'GET') {
      reads.push(slot);
      return json(row);
    }
    assert.equal(request.method(), 'PUT');
    const { save, revision } = JSON.parse(request.postData());
    assert.ok(Number.isSafeInteger(revision) && revision >= 0, '保存には読み込んだ版が付く');
    const conflict = revision !== row.revision || (save.resetAt ?? 0) < (row.save?.resetAt ?? 0);
    writes.push({ slot, save, revision, conflict });
    if (conflict) return { status: 409, body: JSON.stringify({ error: 'save_conflict', ...row }) };
    commit(slot, save);
    return json({ ok: true, revision: rows[slot].revision });
  }
  return { rows, reads, writes, commit, respond };
}

async function collectShell(page, id) {
  await page.evaluate((id) => {
    const game = window.__splash;
    const at = game.town.area.shells[id];
    game.player.teleport(at.x, at.y - 0.6, at.z, 0);
  }, id);
  await page.waitForFunction((id) => window.__splash.town.items.shellList.includes(id), {}, id);
}

async function cloud() {
  let signedIn = false;
  const account = { id: 'test-account', name: 'テストの島民', picture: null };
  const future = Date.now() + 60 * 60 * 1000;
  const server = cloudFiles(account, {
    A: { ...legacySave, gems: 4, updatedAt: future },
    C: { ...legacySave, gems: 8, resetAt: future, runId: '0-' + '1'.repeat(32), introComplete: true },
  });
  const { rows, reads, writes } = server;
  const delayed = Promise.withResolvers(), readingB = Promise.withResolvers();
  const page = await openPage(async (path, request) => {
    if (path === '/api/me') return json({ user: signedIn ? account : null });
    if (path === '/api/auth/login') {
      signedIn = true;
      return { status: 302, headers: { location: url.href } };
    }
    if (path === '/api/save/B' && request.method() === 'GET') {
      readingB.resolve();
      await delayed.promise;
    }
    return server.respond(path, request);
  }, false, { [legacyKey + ':account:' + account.id]: { ...legacySave, gems: 4, shells: [4, 13], updatedAt: 100 } });

  await visible(page, 'login');
  await page.waitForSelector('#btnGuest', { hidden: true });
  await checkLightweight(page);
  await click(page, 'btnLogin');
  await Promise.race([readingB.promise, new Promise((_, reject) => {
    setTimeout(() => reject(new Error('クラウドBの読み込みが始まりません')), 30000).unref();
  })]);
  assert.ok(signedIn);
  assert.equal(await page.evaluate(() => {
    const play = document.getElementById('btnPlay');
    return !!play.getClientRects().length && !play.disabled;
  }), false, 'クラウドが読める前に空枠を開始させない');
  delayed.resolve();
  await visible(page, 'title');
  assert.deepEqual([...new Set(reads)].sort(), ['A', 'B', 'C']);
  await page.focus('#slotC');
  await page.keyboard.press('Space');
  assert.equal(await activeSlot(page), 'slotC');
  // やり直しを確認しても、導入中に他端末が別の冒険を始めたCは消さない。
  await click(page, 'btnNew');
  await click(page, 'confirmRestart');
  await visible(page, 'prologue');
  server.commit('C', { ...rows.C.save, shells: [22], runId: '0-' + '2'.repeat(32) });
  for (let i = 0; i < 3; i++) await click(page, 'storyNext');
  await visible(page, 'title');
  assert.deepEqual(rows.C.save.shells, [22]);
  assert.ok(!writes.some((write) => write.slot === 'C'));
  await click(page, 'slotB');
  await click(page, 'btnPlay');
  await visible(page, 'prologue');
  await page.keyboard.press('Escape');
  await visible(page, 'title');
  assert.equal(rows.B.save, null);
  assert.ok(!writes.some((write) => write.slot === 'B'));
  await checkLightweight(page);

  // 過去の形式のクラウドAを選ぶ。ゲストAにある別の進捗を混ぜず、導入も繰り返さない。
  await click(page, 'slotA');
  // 選択画面を表示しているあいだに、別端末が拾った貝も上陸直前の読み込みで復元する。
  server.commit('A', { ...rows.A.save, shells: [...rows.A.save.shells, 14] });
  await click(page, 'btnPlay');
  await waitForGame(page);
  const resumed = await page.evaluate(() => window.__splash.save);
  assert.equal(resumed.gems, 4);
  assert.ok(resumed.shells.includes(13), '旧端末にしかない貝が、進んだ時計のクラウドに上書きされない');
  assert.ok(resumed.shells.includes(14), '選択後のクラウド進捗も上陸時に復元される');
  assert.equal((await stored(page, legacyKey)).gems, 2);
  // 別端末だけが持つ石・ヒトデ・貝と、時計が遅いこの端末で実際に拾う貝が重なる。
  server.commit('A', { ...rows.A.save, gems: 12, stars: 8, shells: [...rows.A.save.shells, 9], updatedAt: future + 100 });
  const merged = page.waitForResponse((res) => res.status() === 200 && res.request().method() === 'PUT' &&
    new URL(res.url()).pathname === '/api/save' && rows.A.save.shells.includes(5));
  await collectShell(page, 5);
  await page.keyboard.press('Escape');
  await merged;
  const staleWrite = writes.find((write) => write.slot === 'A' && write.conflict && write.save.shells.includes(5));
  assert.ok(staleWrite && staleWrite.save.updatedAt < future + 100);
  assert.equal(rows.A.save.gems, 12);
  assert.equal(rows.A.save.stars, 8);
  for (const shell of [4, 5, 9, 13, 14]) assert.ok(rows.A.save.shells.includes(shell));
  const versionAfterPause = rows.A.revision;
  await click(page, 'btnToTitle');
  await visible(page, 'title');
  assert.equal(await activeSlot(page), 'slotA');
  const idle = await page.evaluate(async () => {
    const game = window.__splash, previous = game.gfx.renderer.info.render.frame;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return game.mode === 'idle' && previous === game.gfx.renderer.info.render.frame;
  });
  assert.ok(idle, 'タイトルに戻るとゲームの描画が止まる');
  assert.equal(rows.A.revision, versionAfterPause, 'ポーズからタイトルへ戻るだけなら再送しない');
  await click(page, 'slotB');
  await click(page, 'btnPlay');
  const savedB = page.waitForResponse((response) =>
    response.request().method() === 'PUT' && new URL(response.url()).pathname === '/api/save/B');
  for (let i = 0; i < 3; i++) await click(page, 'storyNext');
  await waitForGame(page);
  await savedB;
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key))?.introComplete, {}, legacyKey + '-B:account:' + account.id);
  assert.equal(await page.evaluate(() => window.__splash.save.gems), 0);
  assert.equal(await stored(page, legacyKey + '-B'), null);
  // 別の端末がファイルを最初から遊び直したあと、古いタブの自動保存が旧世代の貝を復活させない。
  server.commit('B', { ...rows.B.save, resetAt: future, updatedAt: future, gems: 1, shells: [12] });
  const resetConflict = page.waitForResponse((res) => res.status() === 409 && new URL(res.url()).pathname === '/api/save/B');
  await collectShell(page, 6);
  await page.keyboard.press('Escape');
  await resetConflict;
  await click(page, 'btnToTitle');
  await visible(page, 'title');
  assert.equal(await activeSlot(page), 'slotB');
  await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key))?.gems === 1, {}, legacyKey + '-B:account:' + account.id);
  assert.equal(rows.B.save.gems, 1);
  assert.deepEqual(rows.B.save.shells, [12]);
  assert.equal(rows.A.save.gems, 12);
  assert.equal(rows.C.save.gems, 8);
  assert.ok(!writes.some((write) => write.slot === 'C'));
  await page.browserContext().close();
  console.log('ok  ログイン、旧端末からの再開、時計がずれた端末の同時保存、やり直し前の古いタブの保護');
}

async function legacyImport() {
  const account = { id: 'legacy-owner', name: '島民', picture: null };
  const ownerKey = legacyKey + ':account:' + account.id;
  const resetAt = 100000;
  const active = { ...legacySave, gems: 4, stars: 8, shells: [9], bestMs: 210000, introComplete: true, resetAt, runId: '0-' + '3'.repeat(32) };
  const old = { ...legacySave, bestMs: 180000 };
  const server = cloudFiles(account, { A: active, B: active });
  let unavailableRead = true, unavailableWrite = true;
  let signedIn = account, service = server;
  const page = await openPage((path, request) => {
    if (path === '/api/me') return json({ user: signedIn });
    if (path === '/api/save' && (request.method() === 'GET' ? unavailableRead : unavailableWrite)) {
      return { status: 503, body: '{}' };
    }
    return service.respond(path, request);
  }, false, { [legacyKey]: old });

  await visible(page, 'retrySaves');
  await page.waitForSelector('#btnImportLegacy', { hidden: true });
  assert.equal(await page.$eval('#btnPlay', (b) => b.disabled), true);
  unavailableRead = false;
  await click(page, 'retrySaves');
  await visible(page, 'btnImportLegacy');
  const writesBeforeCancel = server.writes.length;
  await click(page, 'btnImportLegacy');
  await visible(page, 'legacyImportDialog');
  await click(page, 'cancelImportLegacy');
  await page.waitForSelector('#legacyImportDialog', { hidden: true });
  assert.deepEqual(server.rows.A.save, active);
  assert.equal((await stored(page, ownerKey)).gems, active.gems);
  assert.deepEqual(await stored(page, legacyKey), old);
  assert.equal(server.writes.length, writesBeforeCancel);

  await click(page, 'btnImportLegacy');
  // 端末の保存領域が一度だけ満杯になった場合にも、原本とやり直す手段を確保する。
  await page.evaluate((key) => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (this === localStorage && (name === key || name.startsWith('splash-isle-journal:' + encodeURIComponent(key) + ':'))) {
        Storage.prototype.setItem = setItem;
        throw new DOMException('Storage full', 'QuotaExceededError');
      }
      return setItem.call(this, name, value);
    };
  }, ownerKey);
  await click(page, 'confirmImportLegacy');
  await page.waitForFunction(() => document.getElementById('legacyImportError').textContent.length > 0);
  assert.equal((await stored(page, ownerKey)).gems, active.gems);
  assert.deepEqual(await stored(page, legacyKey), old);
  assert.equal(server.writes.length, writesBeforeCancel);
  await click(page, 'confirmImportLegacy');
  await visible(page, 'retrySaves');
  assert.deepEqual(server.rows.A.save, active);
  const pending = await stored(page, ownerKey);
  assert.equal(pending.gems, 6);
  assert.equal(pending.stars, 8);
  assert.deepEqual([...pending.shells].sort((a, b) => a - b), [4, 9]);
  assert.equal(pending.bestMs, 180000);
  assert.equal(pending.resetAt, resetAt);
  assert.equal(pending.runId, active.runId);
  assert.deepEqual(await stored(page, legacyKey), old);

  // 保存に失敗したままブラウザを閉じても、原本と所有者別の未送信記録を保持して同期できる。
  await page.reload({ waitUntil: 'domcontentloaded' });
  await visible(page, 'retrySaves');
  unavailableWrite = false;
  const uploaded = page.waitForResponse((res) => res.request().method() === 'PUT' && res.status() === 200 &&
    new URL(res.url()).pathname === '/api/save');
  await click(page, 'retrySaves');
  await uploaded;
  await page.waitForSelector('#btnImportLegacy', { hidden: true });
  assert.equal(server.rows.A.save.gems, pending.gems);
  assert.equal(server.rows.A.save.resetAt, resetAt);
  assert.equal(server.rows.A.save.runId, active.runId);
  assert.deepEqual(server.rows.B.save, active);
  assert.equal(server.rows.C.save, null);
  assert.deepEqual(await stored(page, legacyKey), old);

  // 同じ端末で別のアカウントに入り直しても、取り込み済みの旧記録を二重に配らない。
  signedIn = { ...account, id: 'another-owner' };
  service = cloudFiles(signedIn, {});
  await page.reload({ waitUntil: 'domcontentloaded' });
  await visible(page, 'title');
  await page.waitForFunction(() => !document.getElementById('btnPlay').disabled);
  await page.waitForSelector('#btnImportLegacy', { hidden: true });
  assert.equal(service.rows.A.save, null);
  await page.browserContext().close();

  // 同じブラウザキーにある現行ゲストの冒険は、旧版の記録の移行対象にしない。
  const empty = cloudFiles(account, {});
  const modern = await openPage((path, request) => path === '/api/me'
    ? json({ user: account }) : empty.respond(path, request), false, { [legacyKey]: { ...old, introComplete: true, resetAt: 0 } });
  await visible(modern, 'title');
  await modern.waitForFunction(() => !document.getElementById('btnPlay').disabled);
  await modern.waitForSelector('#btnImportLegacy', { hidden: true });
  await modern.browserContext().close();
  console.log('ok  旧ブラウザAの明示的な取り込み、キャンセル、通信失敗からの再開、現行ゲストとの区別');
}

async function changedAccount() {
  const first = { id: 'first', name: '最初の島民', picture: null };
  const second = { id: 'second', name: '次の島民', picture: null };
  const firstFiles = cloudFiles(first, { A: { ...legacySave, gems: 4 } });
  const secondFiles = cloudFiles(second, { A: { ...legacySave, gems: 8 } });
  let signedIn = first, switchOnRead = true;
  const rejected = [], logouts = [];
  const page = await openPage((path, request) => {
    if (path === '/api/me') return json({ user: signedIn });
    const owner = request.headers()['x-splash-owner'];
    if (switchOnRead && path === '/api/save' && request.method() === 'GET') {
      signedIn = second; // /me を読んだ直後、隣のタブで別アカウントに切り替えた。
      switchOnRead = false;
    }
    if (path === '/api/auth/logout') logouts.push({ owner, session: signedIn?.id });
    if (!signedIn) return { status: 401, body: JSON.stringify({ error: 'not_signed_in' }) };
    if (owner !== signedIn.id) {
      rejected.push({ path, owner });
      return { status: 409, body: JSON.stringify({ error: 'account_changed' }) };
    }
    if (path === '/api/auth/logout') {
      assert.equal(request.method(), 'POST');
      signedIn = null;
      return json({ ok: true });
    }
    return (signedIn === first ? firstFiles : secondFiles).respond(path, request);
  }, false, { [legacyKey + ':account:first']: { ...legacySave, gems: 1 } });

  await visible(page, 'retrySaves');
  assert.ok(rejected.some((r) => r.path === '/api/save' && r.owner === first.id));
  await click(page, 'retrySaves');
  const waitForAccount = (name) => page.waitForFunction((name) =>
    document.getElementById('account').textContent.includes(name) && !document.getElementById('btnPlay').disabled, {}, name);
  await waitForAccount(second.name);
  assert.equal((await stored(page, legacyKey + ':account:second')).gems, 8);
  assert.equal(secondFiles.writes.length, 0);

  signedIn = first; // 表示中の second のログアウトで、新たに使っている first のセッションを壊さない。
  await click(page, 'exitAccount');
  await waitForAccount(first.name);
  assert.equal(signedIn, first);
  assert.deepEqual(logouts, [{ owner: second.id, session: first.id }]);
  await click(page, 'exitAccount');
  await visible(page, 'btnLogin');
  assert.equal(signedIn, null);
  assert.deepEqual(logouts[1], { owner: first.id, session: first.id });

  signedIn = second;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAccount(second.name);
  signedIn = null; // 別のタブでログアウト済みなら、401を確認してログイン画面へ戻る。
  await click(page, 'exitAccount');
  await visible(page, 'btnLogin');
  assert.deepEqual(logouts[2], { owner: second.id, session: undefined });
  await page.browserContext().close();
  console.log('ok  別タブでアカウントが切り替わった後の再同期とログアウトの保護');
}

try {
  await guest();
  await unavailableGraphics();
  if (url.protocol !== 'file:' && !process.argv.includes('--standalone')) {
    await cloud();
    await legacyImport();
    await changedAccount();
  }
  assert.deepEqual(errors, [], 'ブラウザエラー');
} finally {
  await browser.close();
}
