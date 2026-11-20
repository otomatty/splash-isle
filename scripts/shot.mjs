// 開発用: ヘッドレス Chrome でゲームを開き、任意の操作をしてスクリーンショットを撮る
// 使い方: node scripts/shot.mjs [--w 1280 --h 720 --dpr 1 --url URL] 以降は順に実行: --play（ゲストで上陸）/ --eval "<JS>" / --wait ms / --snap 名前
import puppeteer from 'puppeteer-core';
import { startGuestGame, useOfflineGuest } from './play-guest.mjs';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const W = Number(opt('w', 1280)), H = Number(opt('h', 720));
const url = opt('url', 'http://localhost:4173/?debug');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', `--window-size=${W},${H}`, '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: Number(opt('dpr', 1)), hasTouch: args.includes('--touch') });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
if (args.includes('--play')) await useOfflineGuest(page);
await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('#title:not(.hidden), #btnLogin:enabled:not(.hidden), #btnGuest:enabled:not(.hidden)', { visible: true });
mkdirSync('shots', { recursive: true });
for (let i = 0; i < args.length; i++) {
  const a = args[i], v = args[i + 1];
  if (a === '--play') await startGuestGame(page);
  else if (a === '--eval') {
    const r = await page.evaluate(`(async () => { const g = window.__splash; ${v} })()`);
    if (r !== undefined) console.log('eval →', typeof r === 'string' ? r : JSON.stringify(r));
  } else if (a === '--wait') await sleep(Number(v));
  else if (a === '--snap') await page.screenshot({ path: `shots/${v}.png` });
}
const bad = logs.filter((l) => /error|warn/i.test(l) && !/GL Driver|KHR_parallel|502/.test(l));
console.log(bad.length ? bad.slice(0, 30).join('\n') : 'console: clean');
await browser.close();
