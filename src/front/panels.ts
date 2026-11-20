import { formatTime, loadSettings, saveSettings, type Settings } from '../game/state';
import { api, type User } from '../net/api';

type PanelId = 'how' | 'settings' | 'rank';

export class Panels {
  private current: HTMLElement | null = null;
  private opener: HTMLElement | null = null;
  private background: HTMLElement[] = [];
  private visit = 0;

  constructor(
    private readonly getUser: () => User | null,
    private readonly onSettings: () => void,
    private readonly graphicsInfo: () => string,
  ) {
    for (const id of ['How', 'Settings', 'Rank']) {
      document.getElementById('btn' + id + 'Close')!.onclick = () => this.close();
    }
    document.getElementById('settings')!.addEventListener('input', () => {
      const read = (id: string) => document.getElementById(id) as HTMLInputElement;
      const settings: Settings = {
        quality: read('setQuality').value as Settings['quality'],
        sensitivity: Number(read('setSens').value), invertY: read('setInvert').checked,
        volume: Number(read('setVolume').value), music: Number(read('setMusic').value), showFps: read('setFps').checked,
      };
      saveSettings(settings);
      this.onSettings();
      document.getElementById('gfxInfo')!.textContent = this.graphicsInfo();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.current) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
      }
      if (e.key === 'Tab') {
        const controls = this.current.querySelectorAll<HTMLElement>('button:not(:disabled), select, input');
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }, true);
  }

  get isOpen(): boolean { return this.current !== null; }

  open(id: PanelId, opener?: HTMLElement): void {
    if (this.isOpen) return;
    const panel = document.getElementById(id)!;
    this.current = panel;
    this.opener = opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const title = panel.querySelector('h2')!;
    title.id = id + 'Heading';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', title.id);
    this.background = Array.from(panel.parentElement!.children).filter((child): child is HTMLElement =>
      child instanceof HTMLElement && child !== panel && !child.inert && !child.classList.contains('hidden'));
    for (const child of this.background) child.inert = true;
    if (id === 'settings') this.showSettings();
    if (id === 'rank') void this.showRank(++this.visit);
    panel.classList.remove('hidden');
    panel.querySelector<HTMLElement>('select, input, button')?.focus();
  }

  close(): void {
    if (!this.current) return;
    this.visit++;
    this.current.classList.add('hidden');
    this.current = null;
    for (const child of this.background) child.inert = false;
    this.background = [];
    this.opener?.focus();
    this.opener = null;
  }

  private showSettings(): void {
    const s = loadSettings();
    const input = (id: string) => document.getElementById(id) as HTMLInputElement;
    input('setQuality').value = s.quality;
    input('setSens').value = String(s.sensitivity);
    input('setInvert').checked = s.invertY;
    input('setVolume').value = String(s.volume);
    input('setMusic').value = String(s.music);
    input('setFps').checked = s.showFps;
    document.getElementById('gfxInfo')!.textContent = this.graphicsInfo();
  }

  private async showRank(visit: number): Promise<void> {
    const list = document.getElementById('rankList')!;
    const note = (message: string) => {
      const row = document.createElement('li');
      row.className = 'note';
      row.textContent = message;
      list.append(row);
    };
    list.replaceChildren();
    note('よみこみ中…');
    const entries = await api.leaderboard();
    if (this.visit !== visit) return;
    list.replaceChildren();
    if (!entries) { note('ランキングを取得できませんでした。'); return; }
    if (!entries.length) note('まだ記録がありません。最初のクリアをめざそう！');
    for (const entry of entries) {
      const row = document.createElement('li');
      if (entry.me) row.className = 'me';
      const rank = document.createElement('i'), name = document.createElement('span'), time = document.createElement('b');
      rank.textContent = String(entry.rank); name.textContent = entry.name; time.textContent = formatTime(entry.bestMs);
      row.append(rank, name, time);
      list.append(row);
    }
    if (!this.getUser()) note('Googleでログインすると、クリアタイムを登録できます。');
  }
}
