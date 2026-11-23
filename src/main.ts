import { ALL_GEMS, GEM_COUNT, SLOT_IDS, compareRuns, hasAdventure, loadLocal, mergeSaves, restartSave, sameSave, saveLocal, type SaveData, type SaveSlot } from './game/state';
import { ACCOUNT_CHANGED, api, STANDALONE, type SlotSnapshot, type User } from './net/api';
import { Panels } from './front/panels';
import { offerLegacyImport } from './front/legacy-import';
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
let accountChanged = false;
let visit = 0;
const files = new Map<SaveSlot, SaveData>();
const cloud = new Map<SaveSlot, SlotSnapshot>();
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
  if (accountChanged || failedReads.size || failedWrites.size) {
    note.textContent = accountChanged ? 'ログイン状態が変わりました。現在のアカウントを確認してください。' : failedReads.size ? '一部のファイルを読み込めませんでした。' : '記録はこの端末に保存しました。クラウドと同期できていません。';
    const retry = document.createElement('button');
    retry.id = 'retrySaves';
    retry.textContent = accountChanged ? 'アカウントを確認' : 'もう一度同期';
    retry.onclick = () => { if (accountChanged) void recheckAccount(); else void refreshFiles(); };
    note.append(' ', retry);
  }
}

function renderFiles(): void {
  const saved = files.get(selected);
  const ready = !fetching && !signingOut && !accountChanged && saved !== undefined && !failedReads.has(selected);
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
  const owner = user, session = visit;
  const currentA = screen === 'files' && !accountChanged && !fetching && !signingOut && !failedReads.has('A') ? files.get('A') : undefined;
  offerLegacyImport(owner, currentA, legacy => {
    const current = files.get('A');
    if (!owner || visit !== session || !current || screen !== 'files' || fetching || signingOut || failedReads.has('A')) return false;
    // 明示して選んだ旧記録だけを、今のファイルAの冒険へ取り込む。
    const latest = mergeSaves(current, loadLocal('A', owner.id));
    if (!currentA || compareRuns(latest, currentA) !== 0) return false;
    const merged = mergeSaves(latest, { ...legacy, resetAt: latest.resetAt, runId: latest.runId });
    if (!saveLocal(merged, 'A', owner.id)) return false;
    files.set('A', merged);
    selected = 'A';
    queueUpload('A');
    renderFiles();
    return true;
  });
}

function needsUpload(local: SaveData, remote: SaveData | null): boolean {
  return remote ? !sameSave(local, remote) : hasAdventure(local) || local.bestMs !== null || local.resetAt !== 0;
}

/** メモリと同じ所有者の端末記録を両方見る。別タブの確定した記録も巻き戻さない。 */
function currentFile(slot: SaveSlot): SaveData {
  const disk = loadLocal(slot, user?.id);
  const cached = files.get(slot);
  return cached ? mergeSaves(disk, cached) : disk;
}

function queueUpload(slot: SaveSlot): void {
  if (!user || accountChanged || failedReads.has(slot) || pending.has(slot)) return;
  const session = visit;
  const owner = user.id;
  const upload = async () => {
    let conflicts = 0;
    while (session === visit && !accountChanged) {
      const remote = cloud.get(slot);
      const desired = files.get(slot);
      if (!remote || !desired) return;
      if (!needsUpload(desired, remote.save)) {
        failedWrites.delete(slot);
        return;
      }
      const result = await api.putSave(desired, slot, owner, remote.revision);
      if (session !== visit) return;
      if (result === ACCOUNT_CHANGED) { accountChanged = true; return; }
      if (!result) { failedWrites.add(slot); return; }
      if (result.ok) {
        cloud.set(slot, { save: desired, revision: result.revision });
        failedWrites.delete(slot);
      } else {
        cloud.set(slot, { save: result.save, revision: result.revision });
        const local = currentFile(slot);
        const merged = result.save ? mergeSaves(local, result.save) : local;
        files.set(slot, merged);
        saveLocal(merged, slot, owner);
        // 複数の端末が保存を続ける場合はいったん止め、最新の統合結果を再試行に残す。
        if (++conflicts >= 4 && needsUpload(merged, result.save)) { failedWrites.add(slot); return; }
      }
    }
  };
  const task = upload();
  pending.set(slot, task);
  void task.then(() => {
    if (pending.get(slot) === task) pending.delete(slot);
    if (session === visit && screen === 'files') { renderFiles(); status(); }
  });
}

function record(save: SaveData, sync: boolean): void {
  if (!playing) return;
  const merged = mergeSaves(currentFile(playing), save);
  files.set(playing, merged);
  saveLocal(merged, playing, user?.id);
  if (sync) queueUpload(playing);
}

function enterMenu(message = ''): void {
  playing = null;
  show('files');
  renderFiles();
  status(message);
  button('slot' + selected).focus();
}

async function readFile(slot: SaveSlot): Promise<SaveData | null> {
  const session = visit, owner = user?.id;
  await pending.get(slot);
  if (session !== visit) return null;
  const remote = owner ? await api.readSlot(slot, owner) : null;
  if (session !== visit) return null;
  if (remote === ACCOUNT_CHANGED) { accountChanged = true; return null; }
  if (owner && !remote) { failedReads.add(slot); return null; }
  failedReads.delete(slot);
  const local = currentFile(slot);
  const merged = remote?.save ? mergeSaves(local, remote.save) : local;
  files.set(slot, merged);
  if (remote) {
    cloud.set(slot, remote);
    if (remote.save || needsUpload(merged, null)) saveLocal(merged, slot, owner);
    if (needsUpload(merged, remote.save)) queueUpload(slot);
    else failedWrites.delete(slot);
  }
  return merged;
}

async function refreshFiles(): Promise<void> {
  if (accountChanged || fetching || signingOut) return;
  fetching = true;
  const session = visit;
  renderFiles();
  status('冒険の記録をよみこんでいます…');
  await Promise.all(SLOT_IDS.map(readFile));
  if (session !== visit) return;
  fetching = false;
  renderFiles();
  status();
}

function leaveAccount(): void {
  // 前のアカウントの応答は visit で切り離し、送信待ちや版番号を次のアカウントに渡さない。
  visit++;
  signingOut = fetching = accountChanged = false;
  playing = null;
  user = null;
  files.clear();
  cloud.clear();
  pending.clear();
  failedReads.clear();
  failedWrites.clear();
  el('account').replaceChildren();
  offerLegacyImport(null, undefined, () => false);
  show('login');
}

async function recheckAccount(): Promise<void> {
  if (fetching || signingOut || screen !== 'files') return;
  const session = ++visit;
  pending.clear(); // 照合の前に送った要求は、同じユーザーに戻っていても反映しない。
  fetching = true;
  renderFiles();
  status('現在のアカウントを確認しています…');
  const actual = await api.me();
  if (session !== visit) return;
  fetching = false;
  if (!actual.available) { renderFiles(); status(); return; }
  if (actual.user && actual.user.id === user?.id) {
    accountChanged = false;
    await refreshFiles();
    return;
  }
  leaveAccount();
  displaySession(actual);
}

async function exitAccount(): Promise<void> {
  if (fetching || signingOut || screen !== 'files') return;
  const session = visit;
  signingOut = true;
  renderFiles();
  await Promise.all(pending.values());
  if (session !== visit) return;
  if (user) {
    const result = await api.logout(user.id);
    if (session !== visit) return;
    if (result === ACCOUNT_CHANGED) {
      accountChanged = true;
      signingOut = false;
      await recheckAccount();
      return;
    }
    if (!result) {
      signingOut = false;
      renderFiles();
      status('ログアウトできませんでした。通信状態を確認してもう一度お試しください。');
      return;
    }
  }
  leaveAccount();
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
  const generation = visit;
  const session = await api.me();
  if (generation === visit) displaySession(session);
}

function displaySession(session: Awaited<ReturnType<typeof api.me>>): void {
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

async function land(slot: SaveSlot, firstPage?: SaveData): Promise<void> {
  if (screen !== 'story' && screen !== 'files') return;
  show('loading');
  el('loadingText').textContent = '島を読み込んでいます…';
  try {
    const previous = await readFile(slot);
    if (!previous) { enterMenu(); return; }
    if (firstPage && (compareRuns(firstPage, previous) !== 0 || (!hasAdventure(firstPage) && hasAdventure(previous)))) {
      enterMenu('ほかの端末でファイルが更新されました。もう一度選んでください。');
      return;
    }
    if (!game) {
      const { Game } = await import('./gameplay');
      const instance = new Game(canvas, {
        panels, canRank, onSave: record, onMenu: () => enterMenu(),
        onError: () => enterMenu('島の表示を中断しました。もう一度ファイルを選んでください。'),
      });
      await instance.init();
      game = instance;
    }
    const save = firstPage && hasAdventure(previous) ? restartSave(previous) : { ...previous };
    if (firstPage) { save.introComplete = true; save.updatedAt = Math.max(Date.now(), save.resetAt); }
    playing = slot;
    show('game');
    game.startAdventure(save, user);
    if (new URLSearchParams(location.search).has('debug')) game.expose();
    if (firstPage) record(save, true);
  } catch (error) {
    console.error(error);
    enterMenu('島を表示できませんでした。WebGL が使えるブラウザで、もう一度お試しください。');
  }
}

function story(): void {
  const slot = selected;
  const firstPage = files.get(slot);
  if (!firstPage) return;
  show('story');
  showPrologue(() => void land(slot, firstPage), () => enterMenu());
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
  if (hasAdventure(save)) void land(selected);
  else story();
};
button('btnNew').onclick = confirmRestart;
for (const id of ['how', 'settings', 'rank'] as const) {
  const opener = button('btn' + id[0].toUpperCase() + id.slice(1));
  opener.onclick = () => panels.open(id, opener);
}
void checkSession();
