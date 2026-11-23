// 2つのタブが同じ内容を読み終えてから書き込む順序を固定し、ブラウザーを終了した後に残る記録を調べる。
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/game/state.ts', import.meta.url))],
  bundle: true, format: 'esm', write: false,
});
const { compareRuns, loadLocal, mergeSaves, newSave, restartSave, sanitizeSave, saveLocal } =
  await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].contents).toString('base64'));

const future = { ...newSave(), resetAt: Date.now() + 60000 };
const siblings = [restartSave(future), restartSave(future)];
assert.equal(siblings[0].resetAt, siblings[1].resetAt);
assert.notEqual(siblings[0].runId, siblings[1].runId);

const parent = { ...newSave(70000), introComplete: true, resetAt: Number.MAX_SAFE_INTEGER, updatedAt: Number.MAX_SAFE_INTEGER };
const a = { ...restartSave(parent), gems: 1, bestMs: 65000 };
const b = { ...restartSave(parent), gems: 2 };
assert.equal(a.resetAt, b.resetAt);
assert.notEqual(a.runId, b.runId);
const winner = compareRuns(a, b) > 0 ? a : b;
for (const merged of [mergeSaves(a, b), mergeSaves(b, a)]) {
  assert.equal(merged.runId, winner.runId);
  assert.equal(merged.gems, winner.gems, '別々にやり直した冒険の収集状態は混ざらない');
  assert.equal(merged.bestMs, 65000);
}
let latest = winner;
for (let i = 0; i < 24; i++) {
  const next = restartSave(latest);
  assert.equal(next.resetAt, Number.MAX_SAFE_INTEGER);
  assert.ok(compareRuns(next, latest) > 0);
  assert.equal(sanitizeSave(next).runId, next.runId);
  assert.equal(mergeSaves(next, { ...latest, gems: 8 }).gems, 0);
  latest = next;
}

let beforeWrite;
let unavailableKey;
class MemoryStorage {
  getItem(key) { return Object.hasOwn(this, key) ? this[key] : null; }
  setItem(key, value) {
    if (key === unavailableKey) throw new Error('Storage full');
    if (beforeWrite) {
      const otherTab = beforeWrite;
      beforeWrite = undefined;
      otherTab();
    }
    this[key] = value;
  }
  removeItem(key) { delete this[key]; }
}

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
try {
  const save = value => assert.equal(saveLocal(value, 'B', 'player-1'), true);
  const load = () => loadLocal('B', 'player-1');
  const initial = { ...newSave(), gems: 1, introComplete: true };
  save(initial);
  const reset = { ...restartSave(initial), gems: 2 };
  beforeWrite = () => save(reset);
  save({ ...initial, gems: 5, shells: [9] });
  assert.equal(load().runId, reset.runId);
  assert.equal(load().gems, 2);
  assert.deepEqual(load().shells, []);
  beforeWrite = () => save({ ...reset, gems: 6, shells: [3] });
  save({ ...reset, gems: 10, shells: [1] });
  assert.equal(load().gems, 14);
  assert.deepEqual(load().shells, [1, 3]);
  save(load());
  assert.equal(Object.keys(storage).length, 2, '並行書き込みの後は通常の保存で記録をまとめる');
  assert.equal(JSON.parse(storage.getItem('splash-isle-save-v1-B:account:player-1')).gems, 14, '従来のキーでも読み込める');
  unavailableKey = 'splash-isle-save-v1-B:account:player-1';
  save({ ...load(), stars: 64 });
  assert.equal(load().stars, 64, '追加コピーの容量が足りなくても確定済みの記録から読める');
  assert.equal(loadLocal('B', 'player-2').gems, 0);
} finally {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else delete globalThis.localStorage;
}
console.log('ok  並行するやり直しと端末保存・世代の上限・従来のキーからの読み込み');
