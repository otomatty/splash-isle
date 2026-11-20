// 開発用: ジャンプ＋ホバーで届く範囲（到達曲線）を実測し、全エリアの足場・間欠泉・橋が実際に通れるかを検証する
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, protocolTimeout: 600000, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(process.argv[2] ?? 'http://localhost:4173/?debug', { waitUntil: 'load' });
await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('hidden'), { timeout: 120000 });
const r = await page.evaluate(async () => {
  const g = window.__splash; localStorage.clear();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  document.getElementById('btnPlay').click(); await sleep(1200);
  window.requestAnimationFrame = () => 0; g.gfx.render = () => {};
  let now = performance.now() + 100000;
  const key = (c, d = true) => window.dispatchEvent(new KeyboardEvent(d ? 'keydown' : 'keyup', { code: c }));
  const tick = () => { now += 1000 / 60; g.last = now - 1000 / 60; g.frame(now); };
  const P = g.player, B = P.body;
  const out = [];
  const check = (name, ok, extra) => out.push([ok ? 'ok  ' : 'FAIL', name, extra ?? '']);
  const f1 = (n) => +n.toFixed(1);
  const hAt = (x, z) => g.cur.area.colliders.surfaceBelow(x, 400, z);

  // ── 到達曲線: 静止した足場から助走してジャンプ（→ 頂点付近からホバー） ──
  const curve = (useHover) => {
    const m = g.town.area.movers[0].box;
    const y0 = m.cy + m.hy;
    P.teleport(m.cx - 1.2, y0, m.cz, 0); P.tank = 100; g.cam.snap(B.x, B.y, B.z, 0);
    g.cam.yaw = -Math.PI / 2;
    for (let i = 0; i < 10; i++) tick();
    key('KeyW', true);
    let x0 = null; const pts = [];
    for (let i = 0; i < 400; i++) {
      if (x0 === null && B.x >= m.cx + m.hx - 0.15) { key('Space', true); x0 = m.cx + m.hx; }
      if (x0 !== null && !P.grounded) {
        if (useHover && B.vy < 1.0 && !P.hovering && P.hoverLeft > 0.99) { key('Space', false); tick(); key('Space', true); }
        pts.push([B.x - x0, B.y - y0]);
        if (B.y - y0 < -4) break;
      }
      tick();
    }
    key('Space', false); key('KeyW', false);
    return pts;
  };
  const cJ = curve(false), cH = curve(true);
  const reach = (pts, rise) => { let best = -1; for (let i = 1; i < pts.length; i++) if (pts[i][1] >= rise && pts[i][1] <= pts[i - 1][1] + 1e-6) best = Math.max(best, pts[i][0]); if (best < 0) for (const p of pts) if (p[1] >= rise) best = Math.max(best, p[0]); return best; };
  check('到達曲線を測定', cJ.length > 10 && cH.length > 10, `平地ジャンプ ${f1(reach(cJ, 0))}m / ホバー込み ${f1(reach(cH, 0))}m`);

  // 足場の列が順に渡れるか（動く足場は、待てば来るいちばん良い瞬間で評価）
  const rect = (x, z, hx, hz, top) => ({ x, z, hx, hz, top });
  const fromMover = (m) => ({ x: m.bx, z: m.bz, hx: m.box.hx, hz: m.box.hz, top: m.by, ax: m.ax, ay: m.ay, az: m.az });
  const gapRect = (a, b) => Math.hypot(Math.max(0, Math.abs(a.x - b.x) - a.hx - b.hx), Math.max(0, Math.abs(a.z - b.z) - a.hz - b.hz));
  const chain = (label, list) => {
    let worst = 99, worstInfo = '', jumpOnly = true;
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      let best = -99, info = '', bestJ = -99;
      for (let sa = -1; sa <= 1; sa += 0.25) for (let sb = -1; sb <= 1; sb += 0.25) {
        // 同じ足場に乗ったまま次へ移る列（ゴンドラなど）は位相がそろう
        const A = { ...a, x: a.x + (a.ax ?? 0) * sa, z: a.z + (a.az ?? 0) * sa, top: a.top + (a.ay ?? 0) * sa };
        const Bb = { ...b, x: b.x + (b.ax ?? 0) * sb, z: b.z + (b.az ?? 0) * sb, top: b.top + (b.ay ?? 0) * sb };
        const gap = gapRect(A, Bb), rise = Bb.top - A.top;
        const mH = reach(cH, rise) - gap, mJ = reach(cJ, rise) - gap;
        if (mH > best) { best = mH; info = `すき間${f1(gap)}m 高低差${f1(rise)}m`; }
        bestJ = Math.max(bestJ, mJ);
      }
      if (bestJ < 0.2) jumpOnly = false;
      if (best < worst) { worst = best; worstInfo = `${i}→${i + 1}: ${info}`; }
    }
    check(`${label}（${list.length - 1}区間）`, worst > 1.0, `いちばん厳しい所 ${worstInfo} 余裕${f1(worst)}m${jumpOnly ? '・ホバーなしでも可' : '・ホバー必要'}`);
  };
  // 目標地点へ歩く・間欠泉で飛ぶ、を実際に操作して確かめる
  const walk = (tx, tz, sec) => { key('KeyW', true); for (let i = 0; i < sec * 60; i++) { g.cam.yaw = Math.atan2(B.x - tx, B.z - tz); tick(); if (Math.hypot(B.x - tx, B.z - tz) < 0.8) break; } key('KeyW', false); for (let i = 0; i < 20; i++) tick(); };
  const place = (x, z) => { const y = hAt(x, z); P.teleport(x, y, z, 0); g.cam.snap(x, y, z, 0); P.tank = 100; for (let i = 0; i < 12; i++) tick(); };
  const geyser = (label, idx, tx, tz, needY) => {
    const L = g.cur.area.launchers[idx];
    place(L.x, L.z);
    let launched = false, maxY = B.y, landed = null;
    key('KeyW', true);
    for (let i = 0; i < 60 * 14; i++) {
      g.cam.yaw = Math.atan2(B.x - tx, B.z - tz);
      // 噴き上がるまでは間欠泉の上で待つ
      if (!launched) { key('KeyW', false); if (B.vy > 10) { launched = true; key('KeyW', true); } }
      tick(); maxY = Math.max(maxY, B.y);
      if (launched && P.grounded && B.vy <= 0) { landed = B.y; break; }
    }
    key('KeyW', false);
    check(label, launched && landed !== null && landed >= needY - 0.6, `最高到達 ${f1(maxY)}m → 着地 ${landed === null ? 'なし' : f1(landed)}m（必要 ${needY}m）`);
  };
  const go = async (k, e) => { g.mode = 'playing'; g.enterArea(k, e); await sleep(900); for (let i = 0; i < 20; i++) tick(); };

  // ═══ 町 ═══
  const town = g.town.area;
  const pier = rect(town.pierEnd.x - 5, 0, 5, 1.65, town.pierEnd.y);
  chain('町: 桟橋 → 浮きブロック → 沖の岩', [pier, ...town.movers.map(fromMover), rect(193, 42, 3.0, 3.0, 12.2)]);
  const steps = town.colliders.boxes.filter((b) => Math.abs(b.hx - 0.9) < 1e-6 && Math.abs(b.hz - 0.775) < 1e-6).sort((a, b) => a.cy - b.cy);
  const stepRect = (s, hx = 0.75, hz = 0.75) => rect(s.cx, s.cz, hx, hz, s.cy + s.hy);
  const base = rect(steps[0].cx + 1.5, steps[0].cz + 1.5, 1.5, 1.5, hAt(-104 + 6, -74));
  const deck = town.lampTop.y - 2.0 + 0.4;
  const lastA = Math.atan2(steps[10].cz + 74, steps[10].cx + 104);
  chain('町: 灯台のらせん足場 → 回廊', [base, ...steps.map((s) => stepRect(s)), rect(-104 + Math.cos(lastA) * 3.4, -74 + Math.sin(lastA) * 3.4, 0.9, 0.9, deck)]);
  place(0, 30); walk(-98, -70, 40);
  check('町: 広場から灯台の丘の上まで歩いて行ける', Math.hypot(B.x + 104, B.z + 74) < 14 && B.y > 28, `到達 (${f1(B.x)}, ${f1(B.y)}, ${f1(B.z)})`);
  place(100, 0); walk(town.pierEnd.x - 2, 0, 30);
  check('町: 港から桟橋の先まで歩いて行ける', B.x > town.pierEnd.x - 4 && Math.abs(B.y - 1.5) < 0.3, `到達 (${f1(B.x)}, ${f1(B.y)})`);
  for (const p of g.town.portals.list) {
    const yaw = p.def.yaw;
    place(p.front.x + Math.sin(yaw) * 6, p.front.z + Math.cos(yaw) * 6);
    const before = Math.hypot(B.x - p.front.x, B.z - p.front.z);
    walk(p.front.x, p.front.z, 6);
    check(`町: ${p.def.label}の入口の前まで歩いて行ける`, Math.hypot(B.x - p.front.x, B.z - p.front.z) < 1.3, `${f1(before)}m → ${f1(Math.hypot(B.x - p.front.x, B.z - p.front.z))}m`);
  }

  // ═══ ゆけむり山 ═══
  await go('volcano', 0);
  {
    const a = g.cur.area;
    const tier = (r) => hAt(r, 0.01);
    place(0, 90); walk(40.6, 52, 30); walk(29.6, 37.8, 30);
    check('ゆけむり山: ふもとから坂道で2段目へ歩いて上がれる', B.y > 14, `高さ ${f1(B.y)}m`);
    geyser('ゆけむり山: 間欠泉① 1段目→2段目', 0, 0, 0, 15.2);
    geyser('ゆけむり山: 間欠泉② 2段目→3段目', 1, 0, 0, 27.2);
    geyser('ゆけむり山: 間欠泉③ 3段目→火口のふち', 2, 0, 0, 39.0);
    geyser('ゆけむり山: 火口湖の間欠泉でふちへ戻れる', 3, -22, 7, 39.0);
    const rim = rect(19.6, 0, 2.0, 6, tier(21));
    chain('ゆけむり山: 火口のふち → 足場 → まんなかの岩', [rim, ...a.movers.map(fromMover), rect(0, 0, 1.9, 1.9, a.gems[0].pos.y - 1.7)]);
  }
  // ═══ サンゴ入り江 ═══
  await go('lagoon', 0);
  {
    const a = g.cur.area;
    place(0, 73); walk(-3.5, 9, 40);
    const swam = Math.hypot(B.x + 3.5, B.z - 9) < 2.5;
    walk(-3.5, 2.5, 10);
    check('サンゴ入り江: 浜から泳いで船へ、渡し板で甲板に上がれる', swam && Math.abs(B.y - 3.6) < 0.3, `到達 (${f1(B.x)}, ${f1(B.y)}, ${f1(B.z)})`);
    const ms = a.colliders.boxes.filter((b) => Math.abs(b.hx - 0.95) < 1e-6 && Math.abs(b.hz - 0.75) < 1e-6).sort((p, q) => p.cy - q.cy);
    const nest = a.gems[0].pos.y - 1.7;
    chain('サンゴ入り江: 甲板 → マストの足場 → 見張り台', [rect(ms[0].cx, ms[0].cz, 1.2, 1.2, 3.6), ...ms.map((s) => stepRect(s, 0.75, 0.75)), rect(0, 0, 1.2, 1.2, nest)]);
    geyser('サンゴ入り江: 間欠泉で北の岬の上へ', 0, 0, -74, 22);
  }
  // ═══ そよかぜ台地 ═══
  await go('plateau', 0);
  {
    const a = g.cur.area;
    const M = [{ x: 0, z: 62, r: 19, h: 8 }, { x: -50, z: 22, r: 15, h: 15 }, { x: -34, z: -40, r: 14, h: 23 }, { x: 30, z: -48, r: 13, h: 31 }, { x: 58, z: 6, r: 11, h: 40 }];
    const edge = (p, q, inset) => { const d = Math.hypot(q.x - p.x, q.z - p.z); return [p.x + ((q.x - p.x) / d) * (p.r - inset), p.z + ((q.z - p.z) / d) * (p.r - inset)]; };
    place(0, 93); walk(0, 76, 20);
    check('そよかぜ台地: ふもとから階段で村へ上がれる', Math.abs(B.y - 8) < 0.4, `高さ ${f1(B.y)}m`);
    const b0 = edge(M[0], M[1], 5), b1 = edge(M[1], M[0], 6);
    place(b0[0], b0[1]); walk(b1[0], b1[1], 30);
    check('そよかぜ台地: 吊り橋を歩いて2つ目の台地へ', Math.abs(B.y - 15) < 0.4, `高さ ${f1(B.y)}m`);
    const mv = a.movers.map(fromMover);
    const e = (i, j, top) => { const p = edge(M[i], M[j], 2.0); return rect(p[0], p[1], 1.4, 1.4, top); };
    chain('そよかぜ台地: 気球の足場（2つ目→3つ目）', [e(1, 2, 15), ...mv.slice(0, 5), e(2, 1, 23)]);
    // ゴンドラ: 乗る側・降りる側それぞれ、近づいた瞬間のすき間で評価
    const gon = mv[5];
    const near = (s, m, top) => { const p = edge(m, s < 0 ? M[3] : M[2], 0.6); const A = rect(p[0], p[1], 0.5, 0.5, top); const G = { ...gon, x: gon.x + gon.ax * s, z: gon.z + gon.az * s, top: gon.top + gon.ay * s, ax: 0, ay: 0, az: 0 }; return [A, G]; };
    const [A1, G1] = near(-1, M[2], 23), [A2, G2] = near(1, M[3], 31);
    chain('そよかぜ台地: ゴンドラに乗る', [A1, G1]);
    chain('そよかぜ台地: ゴンドラから降りる', [G2, A2]);
    chain('そよかぜ台地: 動く足場（4つ目→頂上）', [e(3, 4, 31), ...mv.slice(6, 11), e(4, 3, 40)]);
    geyser('そよかぜ台地: ふもとの間欠泉で3つ目の台地へ戻れる', 0, M[2].x, M[2].z, 23);
    geyser('そよかぜ台地: ふもとの間欠泉で4つ目の台地へ戻れる', 1, M[3].x, M[3].z, 31);
    // ゴンドラに乗ったまま運ばれるか
    const gm = a.movers[5];
    for (let i = 0; i < 2000; i++) { tick(); if (Math.abs(gm.box.dx) + Math.abs(gm.box.dz) < 0.004 && gm.box.cy + gm.box.hy < 24) break; }
    P.teleport(gm.box.cx, gm.box.cy + gm.box.hy, gm.box.cz, 0);
    let rode = 0, onTop = true;
    for (let i = 0; i < 60 * 7; i++) { tick(); rode = Math.max(rode, B.y); if (Math.hypot(B.x - gm.box.cx, B.z - gm.box.cz) > 1.5) onTop = false; }
    check('そよかぜ台地: ゴンドラに乗ると落ちずに運ばれる', onTop && rode > 30.3, `最高 ${f1(rode)}m`);
  }
  return out;
});
for (const [s, name, extra] of r) console.log(`  ${s} ${name}${extra ? `  (${extra})` : ''}`);
const failed = r.filter((c) => c[0] === 'FAIL').length;
console.log(`\n${r.length - failed} passed, ${failed} failed`);
if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
