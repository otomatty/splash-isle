// 開発用の自動テスト: ヘッドレス Chrome 上でゲームを早送りし、
// 「町 → 入口を洗って開ける → ステージ選択 → クリアで町へ戻る」を全14個ぶん通して確かめる
import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://localhost:4173/?debug';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
  protocolTimeout: 600000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/502|Failed to load resource/.test(m.text())) errors.push(m.text()); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden'), { timeout: 120000 });

const result = await page.evaluate(async () => {
  const g = window.__splash;
  const out = { checks: [] };
  const check = (name, ok, extra) => out.checks.push([ok ? 'ok  ' : 'FAIL', name, extra ?? '']);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  localStorage.clear();
  document.getElementById('btnPlay').click();
  await sleep(1200);
  // 以降は描画を止め、時間を手動で進める
  window.requestAnimationFrame = () => 0;
  g.gfx.render = () => {};
  let now = performance.now() + 100000;
  const key = (c, d = true) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c }));
  const tick = () => { now += 1000 / 60; g.last = now - 1000 / 60; g.frame(now); };
  const run = (sec, fn) => { const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { if (fn && fn(i / 60) === false) return i / 60; tick(); } return sec; };
  const P = g.player, B = P.body;
  const bits = (n) => n.toString(2).replace(/0/g, '').length;
  const waitPlay = () => run(10, () => g.mode !== 'playing');
  const tp = (x, z, dy = 0) => { const y = g.cur.area.colliders.surfaceBelow(x, 300, z) + dy; P.teleport(x, y, z, 0); g.cam.snap(x, y, z, 0); run(0.2); };
  const touch = (v) => { P.teleport(v.x, v.y - 0.6, v.z, 0); run(0.12); };

  // ── 基本の動き ──
  tp(0, 11); const y0 = B.y; let maxY = y0;
  key('Space'); run(1.2, () => { maxY = Math.max(maxY, B.y); }); key('Space', false);
  out.jumpHeight = +(maxY - y0).toFixed(2);
  check('ジャンプの高さが 1.8〜2.2m', out.jumpHeight > 1.8 && out.jumpHeight < 2.2, out.jumpHeight);

  // ── 町: 最初から時計塔がスミに覆われている ──
  const portals = g.town.portals;
  const st = () => portals.list.map((p) => p.state).join(',');
  check('最初は 時計塔だけスミ、ほかは眠ったまま', st() === 'gooped,sealed,sealed', st());
  // 水を実際に噴射して洗い流す
  const p0 = portals.list[0];
  P.teleport(p0.front.x + Math.sin(p0.def.yaw) * 5, p0.front.y - 0.8, p0.front.z + Math.cos(p0.def.yaw) * 5, 0);
  g.cam.snap(B.x, B.y, B.z, p0.def.yaw); g.cam.pitch = 0.1; run(0.3);
  key('KeyF');
  out.washSec = +run(30, () => { g.cam.yaw = p0.def.yaw; g.cam.pitch = 0.1; if (P.tank < 20) P.tank = 100; return p0.state !== 'open'; }).toFixed(1);
  key('KeyF', false);
  check('水をかけ続けると入口がひらく', p0.state === 'open' && (g.save.portals & 1) === 1, `${out.washSec}秒`);
  waitPlay();

  // 手動で進めるゲームの時計と切り離し、暗転・地区の取得・組み立ての完了まで待つ。
  const waitForArea = async () => {
    const deadline = performance.now() + 30000;
    while (g.switching) {
      if (performance.now() > deadline) throw new Error('エリアの読み込みが完了しませんでした');
      await sleep(25);
    }
  };

  // ── 入口に飛びこむ → ステージ選択 ──
  const enter = async (idx, episode) => {
    const p = portals.list[idx];
    p.cooldown = 0;
    P.teleport(p.front.x, p.front.y - 0.8, p.front.z, 0);
    run(0.3);
    if (g.mode !== 'select') return false;
    const btns = [...document.querySelectorAll('#epList button')];
    if (btns[episode].disabled) return 'locked';
    btns[episode].click();
    await waitForArea();
    run(0.3);
    return g.stage && g.stage.episode === episode;
  };
  const backToTown = async () => { await waitForArea(); run(0.3); };
  // ステージの目標を達成してヒカリ石を取る
  const clear = async () => {
    const a = g.cur.area, m = a.missions[0];
    if (m.kind === 'clean') { a.goop.clean(a.goop.rect.x + 48, a.goop.rect.y + 48, 70, 10); run(0.2); waitPlay(); }
    if (m.kind === 'defeat') { for (const en of g.cur.enemies.list) if (en.alive) g.cur.enemies.damage(en, 20, 1, 0); run(0.2); waitPlay(); }
    if (m.kind === 'collect') { for (const s of a.starfish) touch(s); run(0.2); waitPlay(); }
    const shown = g.cur.items.isRevealed(m.gem);
    touch(a.gems[0].pos);
    run(8, () => g.mode === 'cutscene' && !g.switching);
    await backToTown();
    return shown;
  };

  // 1つ目のエリア: ステージ2・3は最初は選べない
  P.teleport(p0.front.x, p0.front.y - 0.8, p0.front.z, 0); p0.cooldown = 0; run(0.3);
  check('入口に入るとステージ選択が出る', g.mode === 'select' && !document.getElementById('episodes').classList.contains('hidden'));
  const locked = [...document.querySelectorAll('#epList button')].map((b) => b.disabled);
  check('ステージは順番に解放（最初は1だけ）', locked.join() === 'false,true,true', locked.join());
  document.getElementById('btnEpBack').click(); run(0.3);
  check('「やめる」で町に残る', g.mode === 'playing' && !g.stage);

  const order = [];
  for (let ep = 0; ep < 3; ep++) {
    const ok = await enter(0, ep);
    const name = g.cur.area.name, title = g.cur.area.missions[0]?.title;
    const shown = ok === true ? await clear() : false;
    order.push(`${name}${ep + 1}`);
    check(`ゆけむり山 ステージ${ep + 1}「${title}」をクリアして町へ戻る`, ok === true && shown && !g.stage && (g.save.gems & (1 << (5 + ep))) !== 0, `gems=${bits(g.save.gems)}`);
    waitPlay();
  }
  check('ヒカリ石3個で 港の倉庫がスミに覆われる', st() === 'open,gooped,sealed', st());

  // 町のヒカリ石を取りながら 2つ目・3つ目の入口を開ける
  const town = g.town.area;
  touch(town.gems[1].pos); run(8, () => g.mode !== 'playing'); waitPlay();
  touch(town.gems[3].pos); run(8, () => g.mode !== 'playing'); waitPlay();
  check('ヒカリ石5個で 石の門もスミに覆われる', st() === 'open,gooped,gooped', `${st()} gems=${bits(g.save.gems)}`);
  for (const i of [1, 2]) { portals.list[i].hp = 0.001; const f = portals.list[i].front; portals.hitTest(f.x, f.y + 1.4, f.z); run(0.2); waitPlay(); }
  check('3つの入口がすべてひらく', st() === 'open,open,open' && g.save.portals === 7, st());
  for (const idx of [1, 2]) {
    for (let ep = 0; ep < 3; ep++) {
      const ok = await enter(idx, ep);
      const name = g.cur.area.name, title = g.cur.area.missions[0]?.title;
      const shown = ok === true ? await clear() : false;
      check(`${name} ステージ${ep + 1}「${title}」をクリアして町へ戻る`, ok === true && shown && !g.stage, `gems=${bits(g.save.gems)}`);
      waitPlay();
    }
  }
  // 町の残り3つ（掃除・ヒトデ・スミボウ）
  town.goop.clean(0, 0, 60, 10); run(0.2); waitPlay();
  for (const en of g.town.enemies.list) if (en.alive) g.town.enemies.damage(en, 20, 1, 0);
  run(0.2); waitPlay();
  for (const s of town.starfish) touch(s);
  run(0.2); waitPlay();
  check('町の3条件でヒカリ石が出現', (g.save.revealed & 31) === 31, g.save.revealed);
  for (const id of [0, 2, 4]) { touch(town.gems[id].pos); run(8, () => g.mode === 'cutscene'); run(0.2); }
  run(1);
  out.final = { gems: bits(g.save.gems), mode: g.mode, best: g.save.bestMs, time: document.getElementById('endTime').textContent };
  check('14個そろうとエンディング', g.save.gems === 16383 && g.mode === 'ending' && !document.getElementById('ending').classList.contains('hidden'), JSON.stringify(out.final));
  const saved = JSON.parse(localStorage.getItem('splash-isle-save-v1') ?? '{}');
  check('セーブに 14個・入口3つ・ベストタイムが残る', saved.gems === 16383 && saved.portals === 7 && saved.bestMs > 0, `${saved.gems},${saved.portals}`);
  return out;
});
for (const [s, name, extra] of result.checks) console.log(`  ${s} ${name}${extra ? `  (${extra})` : ''}`);
const failed = result.checks.filter((c) => c[0] === 'FAIL').length;
console.log(`\n${result.checks.length - failed} passed, ${failed} failed`);
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
