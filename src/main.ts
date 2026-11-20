import { ALL_GEMS, GEM_COUNT, SLOT_IDS, hasAdventure, loadLocal, mergeSaves, restartSave, saveLocal, type SaveData, type SaveSlot } from './game/state';
import { api, STANDALONE, type User } from './net/api';
import { Panels } from './front/panels';
import { installMenuGamepad } from './front/menu-gamepad';
import { showPrologue } from './front/story';
import type { Game } from './gameplay';

const el = (id: string) => document.getElementById(id)!;
const button = (id: string) => el(id) as HTMLButtonElement;
const canvas = el('game') as HTMLCanvasElement;
type Screen = 'login' | 'files' | 'story' | 'loading' | 'game';
let screen: Screen = 'login';
let game: Game | undefined;
let user: User | null = null;
let online = false;
let loginAvailable = false;
let selected: SaveSlot = 'A';
let playing: SaveSlot | null = null;
let fetching = false;
let signingOut = false;
let visit = 0;
const files = new Map<SaveSlot, SaveData>();
const pending = new Map<SaveSlot, Promise<void>>();
const failedReads = new Set<SaveSlot>();
const failedWrites = new Set<SaveSlot>();

const panels = new Panels(() => user, () => game?.refreshSettings(),
  () => game?.graphicsDescription ?? '島に入ると、選んだ画質で表示されます。');

const canRank = () => online && (user !== null || loginAvailable);
const refreshMenuGamepad = installMenuGamepad(() => screen, panels);

function show(next: Screen): void {
  screen = next;
  for (const [id, view] of [['login', 'login'], ['title', 'files'], ['loading', 'loading'], ['game', 'game']]) {
    el(id).classList.toggle('hidden', view !== next);
  }
  refreshMenuGamepad();
}

function status(message = ''): void {
  const note = el('menuStatus');
  note.replaceChildren(message);
  if (message || fetching || signingOut) return;
  if (failedReads.size || failedWrites.size) {
    note.textContent = failedReads.size ? '一部のファイルを読み込めませんでした。' : '記録はこの端末に保存しました。クラウドと同期できていません。';
    const retry = document.createElement('button');
    retry.id = 'retrySaves';
    retry.textContent = 'もう一度同期';
    retry.onclick = () => void refreshFiles();
    note.append(' ', retry);
  }
}

function renderFiles(): void {
  const saved = files.get(selected);
  const ready = !fetching && !signingOut && saved !== undefined && !failedReads.has(selected);
  for (const slot of SLOT_IDS) {
    const tile = button('slot' + slot);
    const data = files.get(slot);
    const occupied = data && hasAdventure(data);
    tile.setAttribute('aria-pressed', String(selected === slot));
    tile.disabled = signingOut;
    tile.querySelector('.slot-state')!.textContent = fetching ? 'よみこみ中…' : failedReads.has(slot) ? '通信エラー' :
      !occupied ? '空きファイル' : data.gems === ALL_GEMS ? 'クリア' : '冒険のつづき';
    tile.querySelector('.slot-count')!.textContent = !fetching && !failedReads.has(slot) && occupied
      ? 'ヒカリ石 ' + data.gems.toString(2).replace(/0/g, '').length + ' / ' + GEM_COUNT : '';
  }
  for (const id of ['btnRank', 'btnHow', 'btnSettings']) button(id).disabled = signingOut;
  button('exitAccount').disabled = fetching || signingOut;
  button('btnPlay').disabled = !ready;
  button('btnPlay').textContent = saved && hasAdventure(saved) ? 'つづきから' : 'はじめから';
  button('btnNew').classList.toggle('hidden', !(ready && hasAdventure(saved)));
  button('btnRank').classList.toggle('hidden', !canRank());
}

function queueUpload(slot: SaveSlot, data: SaveData): void {
  if (!user || failedReads.has(slot)) return;
  const session = visit;
  const owner = user.id;
  const upload = (pending.get(slot) ?? Promise.resolve()).then(async () => {
    if (visit !== session) return;
    const ok = await api.putSave(data, slot, owner);
    if (visit !== session) return;
    if (ok) failedWrites.delete(slot);
    else failedWrites.add(slot);
    if (screen === 'files') status();
  });
  pending.set(slot, upload);
  void upload.then(() => { if (pending.get(slot) === upload) pending.delete(slot); });
}

function record(save: SaveData, sync: boolean): void {
  if (!playing) return;
  const snapshot = { ...save, shells: [...save.shells] };
  files.set(playing, snapshot);
  saveLocal(snapshot, playing, user?.id);
  if (sync) queueUpload(playing, snapshot);
}

function enterMenu(message = ''): void {
  playing = null;
  show('files');
  renderFiles();
  status(message);
  button('slot' + selected).focus();
}

async function refreshFiles(): Promise<void> {
  if (fetching || signingOut) return;
  fetching = true;
  const session = visit;
  const owner = user?.id;
  renderFiles();
  status('冒険の記録をよみこんでいます…');
  await Promise.all(SLOT_IDS.map(async (slot) => {
    await pending.get(slot);
    if (session !== visit) return;
    const local = files.get(slot) ?? loadLocal(slot, owner);
    if (!owner) { files.set(slot, local); return; }
    const remote = await api.readSlot(slot, owner);
    if (session !== visit) return;
    if (!remote) { failedReads.add(slot); return; }
    failedReads.delete(slot);
    const merged = remote.save ? mergeSaves(local, remote.save) : local;
    files.set(slot, merged);
    if (!hasAdventure(merged) && !merged.bestMs && !merged.resetAt) return;
    saveLocal(merged, slot, owner);
    if (JSON.stringify(remote.save) !== JSON.stringify(merged)) queueUpload(slot, merged);
    else failedWrites.delete(slot);
  }));
  if (session !== visit) return;
  fetching = false;
  renderFiles();
  status();
}

async function exitAccount(): Promise<void> {
  if (fetching || signingOut || screen !== 'files') return;
  signingOut = true;
  button('exitAccount').disabled = true;
  renderFiles();
  await Promise.all(pending.values());
  if (user && !await api.logout()) {
    signingOut = false;
    button('exitAccount').disabled = false;
    renderFiles();
    status('ログアウトできませんでした。通信状態を確認してもう一度お試しください。');
    return;
  }
  visit++;
  signingOut = fetching = false;
  user = null;
  files.clear();
  failedReads.clear();
  failedWrites.clear();
  show('login');
  void checkSession();
}

function openFiles(account: User | null): void {
  visit++;
  user = account;
  selected = 'A';
  const name = document.createElement('span');
  name.textContent = account ? account.name + ' さん' : 'ゲスト';
  const exit = document.createElement('button');
  exit.id = 'exitAccount';
  exit.textContent = account ? 'ログアウト' : 'ログイン画面へ';
  exit.onclick = () => void exitAccount();
  el('account').replaceChildren(name, exit);
  enterMenu();
  void refreshFiles();
}

async function checkSession(): Promise<void> {
  for (const id of ['btnLogin', 'btnGuest']) {
    const action = button(id);
    action.disabled = true;
    action.classList.add('hidden');
  }
  el('loginNote').textContent = 'ログイン状態を確認しています…';
  const session = await api.me();
  online = session.available;
  loginAvailable = session.loginAvailable;
  if (session.user) { openFiles(session.user); return; }
  const login = button('btnLogin'), guest = button('btnGuest');
  login.classList.toggle('hidden', !loginAvailable);
  guest.classList.toggle('hidden', loginAvailable);
  login.disabled = !loginAvailable;
  guest.disabled = loginAvailable;
  const url = new URL(location.href);
  const failed = url.searchParams.get('login') === 'failed';
  if (failed) {
    url.searchParams.delete('login');
    history.replaceState(null, '', url.href);
  }
  el('loginNote').textContent = failed ? 'ログインできませんでした。もう一度お試しください。' : loginAvailable
    ? '冒険の記録はアカウントに保存されます。'
    : STANDALONE || online ? '冒険の記録はこのブラウザに保存されます。' : 'オフラインで遊べます。記録はこのブラウザに保存されます。';
  (loginAvailable ? login : guest).focus({ preventScroll: true });
}

async function land(slot: SaveSlot, fresh: boolean): Promise<void> {
  const previous = files.get(slot);
  if (!previous || (screen !== 'story' && screen !== 'files')) return;
  show('loading');
  el('loadingText').textContent = '島を読み込んでいます…';
  try {
    if (!game) {
      const { Game } = await import('./gameplay');
      const instance = new Game(canvas, {
        panels, canRank, onSave: record, onMenu: () => enterMenu(),
        onError: () => enterMenu('島の表示を中断しました。もう一度ファイルを選んでください。'),
      });
      await instance.init();
      game = instance;
    }
    const save = fresh && hasAdventure(previous) ? restartSave(previous) : { ...previous };
    if (fresh) { save.introComplete = true; save.updatedAt = Math.max(Date.now(), save.resetAt); }
    playing = slot;
    show('game');
    game.startAdventure(save, user);
    if (new URLSearchParams(location.search).has('debug')) game.expose();
    if (fresh) record(save, true);
  } catch (error) {
    console.error(error);
    enterMenu('島を表示できませんでした。WebGL が使えるブラウザで、もう一度お試しください。');
  }
}

function story(): void {
  const slot = selected;
  show('story');
  showPrologue(() => void land(slot, true), () => enterMenu());
}

function confirmRestart(): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'restart-dialog';
  const heading = document.createElement('h2');
  heading.id = 'restartHeading';
  heading.textContent = 'ファイル ' + selected + ' をはじめから遊ぶ？';
  dialog.setAttribute('aria-labelledby', heading.id);
  const detail = document.createElement('p');
  detail.textContent = '島に上陸すると、このファイルの冒険の記録が新しくなります。ベストタイムは残ります。';
  const cancel = document.createElement('button'), confirm = document.createElement('button');
  cancel.id = 'cancelRestart';
  cancel.textContent = 'もどる';
  confirm.id = 'confirmRestart';
  confirm.textContent = 'はじめから';
  cancel.onclick = () => dialog.close();
  confirm.onclick = () => dialog.close('restart');
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (dialog.returnValue === 'restart') story();
    else button('btnNew').focus();
  }, { once: true });
  dialog.append(heading, detail, cancel, confirm);
  document.body.append(dialog);
  dialog.showModal();
  cancel.focus();
}

button('btnLogin').onclick = () => api.login();
button('btnGuest').onclick = () => openFiles(null);
for (const [i, slot] of SLOT_IDS.entries()) {
  const tile = button('slot' + slot);
  tile.onclick = () => { selected = slot; renderFiles(); status(); };
  tile.onkeydown = (event) => {
    const index = { ArrowLeft: (i + 2) % 3, ArrowRight: (i + 1) % 3, Home: 0, End: 2 }[event.key];
    if (index === undefined) return;
    event.preventDefault();
    const next = button('slot' + SLOT_IDS[index]);
    next.focus(); next.click();
  };
}
button('btnPlay').onclick = () => {
  const save = files.get(selected);
  if (!save || button('btnPlay').disabled) return;
  if (hasAdventure(save)) void land(selected, false);
  else story();
};
button('btnNew').onclick = confirmRestart;
for (const id of ['how', 'settings', 'rank'] as const) {
  const opener = button('btn' + id[0].toUpperCase() + id.slice(1));
  opener.onclick = () => panels.open(id, opener);
}
void checkSession();
