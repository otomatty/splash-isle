// 開発用: Worker の応答を再現し、ログイン・ファイル選択・島に着くまでを実際の入力で検査する。
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

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

async function openPage(api, disableWebGL = false) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluateOnNewDocument((key, save, disableWebGL) => {
    if (!sessionStorage.getItem('fixture-ready')) {
      localStorage.setItem(key, JSON.stringify(save));
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
  }, legacyKey, legacySave, disableWebGL);
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

async function cloud() {
  let signedIn = false;
  const account = { id: 'test-account', name: 'テストの島民', picture: null };
  const saves = { A: { ...legacySave, gems: 4 }, B: null, C: { ...legacySave, gems: 8 } };
  const reads = [], writes = [];
  const delayed = Promise.withResolvers(), readingB = Promise.withResolvers();
  const page = await openPage(async (path, request) => {
    if (path === '/api/me') return json({ user: signedIn ? account : null });
    if (path === '/api/auth/login') {
      signedIn = true;
      return { status: 302, headers: { location: url.href } };
    }
    const file = path.match(/^\/api\/save(?:\/([BC]))?$/);
    if (file) {
      const slot = file[1] ?? 'A';
      if (request.method() === 'GET') {
        reads.push(slot);
        if (slot === 'B') {
          readingB.resolve();
          await delayed.promise;
        }
        return json({ save: saves[slot] });
      }
      assert.equal(request.method(), 'PUT');
      saves[slot] = JSON.parse(request.postData()).save;
      writes.push(slot);
      return json({ ok: true });
    }
    return { status: 404, body: '{}' };
  });

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
  await click(page, 'slotB');
  await click(page, 'btnPlay');
  await visible(page, 'prologue');
  await page.keyboard.press('Escape');
  await visible(page, 'title');
  assert.equal(saves.B, null);
  assert.equal(writes.includes('B'), false);
  await checkLightweight(page);

  // 過去の形式のクラウドAを選ぶ。ゲストAにある別の進捗を混ぜず、導入も繰り返さない。
  await click(page, 'slotA');
  await click(page, 'btnPlay');
  await waitForGame(page);
  assert.equal(await page.evaluate(() => window.__splash.save.gems), 4);
  assert.equal((await stored(page, legacyKey)).gems, 2);
  await page.keyboard.press('Escape');
  await click(page, 'btnToTitle');
  await visible(page, 'title');
  assert.equal(await activeSlot(page), 'slotA');
  const idle = await page.evaluate(async () => {
    const game = window.__splash, previous = game.gfx.renderer.info.render.frame;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return game.mode === 'idle' && previous === game.gfx.renderer.info.render.frame;
  });
  assert.ok(idle, 'タイトルに戻るとゲームの描画が止まる');
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
  await page.keyboard.press('Escape');
  await click(page, 'btnToTitle');
  await visible(page, 'title');
  assert.equal(await activeSlot(page), 'slotB');
  assert.equal(saves.B?.introComplete, true);
  assert.equal(saves.A.gems, 4);
  assert.equal(saves.C.gems, 8);
  assert.ok(!writes.includes('C'));
  await page.browserContext().close();
  console.log('ok  ログイン・遅いクラウド応答、3枠の読み書きと分離、導入済みファイルの再開');
}

try {
  await guest();
  await unavailableGraphics();
  if (url.protocol !== 'file:' && !process.argv.includes('--standalone')) await cloud();
  assert.deepEqual(errors, [], 'ブラウザエラー');
} finally {
  await browser.close();
}
