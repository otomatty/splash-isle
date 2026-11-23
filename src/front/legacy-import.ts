import { formatTime, GEM_COUNT, hasAdventure, mergeSaves, sameSave, sanitizeSave, type SaveData } from '../game/state';
import type { User } from '../net/api';

const sourceKey = 'splash-isle-save-v1';
const receiptKey = 'splash-isle-legacy-import-v1';
const link = document.getElementById('btnImportLegacy') as HTMLButtonElement;
const dialog = document.getElementById('legacyImportDialog') as HTMLDialogElement;
const confirm = document.getElementById('confirmImportLegacy') as HTMLButtonElement;
const cancel = document.getElementById('cancelImportLegacy') as HTMLButtonElement;
const error = document.getElementById('legacyImportError')!;

type Offer = { owner: User; current: SaveData; apply: (legacy: SaveData) => boolean };
let offer: Offer | null = null;
let preview: { owner: string; source: string } | null = null;

function readCandidate(target: Offer): { source: string; save: SaveData } | null {
  try {
    // 旧版の正本は変更しない。途中で閉じた場合の予約は予約したアカウントだけが再開できる。
    const receipt = localStorage.getItem(receiptKey);
    if (receipt !== null && receipt !== 'pending:' + target.owner.id) return null;
    const source = localStorage.getItem(sourceKey);
    if (!source) return null;
    const raw = JSON.parse(source);
    // 現行のゲストAは同じキーに保存されるので、補完前に旧版の必須項目と型を確かめる。
    if (!raw || typeof raw !== 'object' || raw.v !== 1 || 'introComplete' in raw || 'resetAt' in raw || 'runId' in raw ||
        !Array.isArray(raw.shells) || !['gems', 'revealed', 'stars', 'portals', 'playMs', 'updatedAt'].every(k => Number.isFinite(raw[k])) ||
        !(raw.bestMs === null || Number.isFinite(raw.bestMs))) return null;
    const save = sanitizeSave(raw);
    if (!save || !hasAdventure(save)) return null;
    const current = target.current;
    const merged = mergeSaves(current, { ...save, resetAt: current.resetAt, runId: current.runId });
    if (sameSave(merged, current)) return null;
    return { source, save };
  } catch {
    return null;
  }
}

function refresh(): void {
  const candidate = offer && readCandidate(offer);
  link.classList.toggle('hidden', !candidate);
  if (dialog.open && (!candidate || preview?.owner !== offer?.owner.id || preview?.source !== candidate.source)) dialog.close();
}

/** ログイン中でファイルAの照合が済んだときだけ、利用者の確認を受け付ける。 */
export function offerLegacyImport(owner: User | null, currentA: SaveData | undefined, apply: (legacy: SaveData) => boolean): void {
  offer = owner && currentA ? { owner, current: currentA, apply } : null;
  refresh();
}

function stats(save: SaveData): string[] {
  const count = (bits: number) => bits.toString(2).replace(/0/g, '').length;
  return [`${count(save.gems)} / ${GEM_COUNT}`, `${save.shells.length}`, `${count(save.stars)} / 8`, `${count(save.portals)} / 3`,
    formatTime(save.playMs), save.bestMs === null ? '―' : formatTime(save.bestMs)];
}

link.onclick = () => {
  if (!offer || dialog.open) return;
  const candidate = readCandidate(offer);
  if (!candidate) { refresh(); return; }
  preview = { owner: offer.owner.id, source: candidate.source };
  document.getElementById('legacyImportOwner')!.textContent = `取り込み先は「${offer.owner.name}」さんのファイルAです。`;
  const rows = dialog.querySelector('tbody')!;
  const current = stats(offer.current), legacy = stats(candidate.save);
  rows.replaceChildren();
  ['ヒカリ石', '貝がら', 'ヒトデ', '開いた入口', 'プレイ時間', 'ベストタイム'].forEach((label, i) => {
    const row = rows.insertRow(), heading = document.createElement('th');
    heading.scope = 'row'; heading.textContent = label;
    row.append(heading);
    row.insertCell().textContent = current[i];
    row.insertCell().textContent = legacy[i];
  });
  error.textContent = '';
  dialog.showModal();
  cancel.focus({ preventScroll: true });
  dialog.scrollTop = 0;
};

cancel.onclick = () => dialog.close();
dialog.addEventListener('close', () => {
  if (dialog.open) return; // 直前の close イベントを待たずに開き直す場合がある。
  preview = null;
  if (link.classList.contains('hidden') && !document.getElementById('title')!.classList.contains('hidden')) {
    document.querySelector<HTMLButtonElement>('#title .slot-tile[aria-pressed="true"]')?.focus();
  }
});

confirm.onclick = async () => {
  const inspected = preview;
  if (!inspected || !dialog.open) return;
  confirm.disabled = true;
  function transfer(): void {
    const target = offer;
    const candidate = target && readCandidate(target);
    if (!target || !candidate || !dialog.open || inspected !== preview || inspected?.owner !== target.owner.id || inspected.source !== candidate.source) {
      refresh(); return;
    }
    // 先に予約を確保し、所有者付きのAに永続化できた時点で完了にする。旧キーには書かない。
    localStorage.setItem(receiptKey, 'pending:' + target.owner.id);
    if (!target.apply(candidate.save)) {
      localStorage.removeItem(receiptKey);
      error.textContent = 'ファイルAに保存できませんでした。ブラウザの保存領域とログイン状態を確認して、もう一度お試しください。';
      return;
    }
    localStorage.setItem(receiptKey, 'imported');
    if (dialog.open) dialog.close();
    refresh();
  }
  try {
    if (navigator.locks) await navigator.locks.request(receiptKey, transfer);
    else transfer();
  } catch {
    error.textContent = 'ブラウザの保存領域を利用できません。旧セーブはこの端末に残っています。';
  } finally {
    confirm.disabled = false;
  }
};

window.addEventListener('storage', ({ key }) => {
  if (key === null || key === sourceKey || key === receiptKey) refresh();
});
