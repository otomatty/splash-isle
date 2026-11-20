import * as THREE from 'three';
import { formatTime } from './state';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const DROP_SVG = '<svg class="heart" viewBox="0 0 24 30"><path d="M12 2c5 7 9 11 9 16a9 9 0 0 1-18 0c0-5 4-9 9-16z"/></svg>';

export interface MissionView {
  title: string;
  detail: string;
  done: boolean;
  /** いま挑戦中のステージか */
  now?: boolean;
}

/** 画面上の表示（DOM）をまとめて扱う */
export class Hud {
  private readonly root = $('hud');
  private readonly hearts: HTMLElement[] = [];
  private readonly gemCount = $('gemCount');
  private readonly shellCount = $('shellCount');
  private readonly starCount = $('starCount');
  private readonly timer = $('timer');
  private readonly tank = this.root.querySelector<HTMLElement>('.tank')!;
  private readonly tankFill = $('tankFill');
  private readonly hoverRing = $('hoverRing');
  private readonly objective = $('objective');
  private readonly toastEl = $('toast');
  private readonly bubble = $('bubble');
  private readonly bubbleName = $('bubbleName');
  private readonly bubbleText = $('bubbleText');
  private readonly fps = $('fps');
  private readonly hint = $('hint');
  private toastTimer = 0;
  private lastObjective = '';
  private lastBubble = '';
  private lastShells = -1;
  private lastStars = -1;
  private lastStarTotal = -1;
  private lastHp = -1;
  private lastGems = -1;
  private lastTimer = '';
  private readonly v = new THREE.Vector3();

  show(on: boolean): void {
    this.root.classList.toggle('hidden', !on);
    $('touch').classList.toggle('hidden', !on);
  }

  setHearts(hp: number, max: number): void {
    if (hp === this.lastHp) return;
    this.lastHp = hp;
    const h = $('hearts');
    if (this.hearts.length !== max) {
      h.innerHTML = '';
      this.hearts.length = 0;
      for (let i = 0; i < max; i++) {
        h.insertAdjacentHTML('beforeend', DROP_SVG);
        this.hearts.push(h.lastElementChild as HTMLElement);
      }
    }
    this.hearts.forEach((el, i) => el.classList.toggle('off', i >= hp));
  }

  setGems(count: number): void {
    if (count === this.lastGems) return;
    this.gemCount.textContent = String(count);
    if (this.lastGems >= 0) this.pop(this.gemCount.parentElement!);
    this.lastGems = count;
  }

  setCounts(shells: number, stars: number, starTotal: number): void {
    if (starTotal !== this.lastStarTotal) {
      // ヒトデのないステージでは数を出さない
      const box = this.starCount.parentElement!;
      box.classList.toggle('hidden', starTotal === 0);
      box.querySelector('small')!.textContent = `/${starTotal}`;
      this.lastStarTotal = starTotal;
      this.lastStars = -1;
    }
    if (shells !== this.lastShells) {
      this.shellCount.textContent = String(shells);
      if (this.lastShells >= 0) this.pop(this.shellCount.parentElement!);
      this.lastShells = shells;
    }
    if (stars !== this.lastStars) {
      this.starCount.textContent = String(stars);
      if (this.lastStars >= 0) this.pop(this.starCount.parentElement!);
      this.lastStars = stars;
    }
  }

  private pop(el: HTMLElement): void {
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  setTank(ratio: number, hoverLeft: number, hovering: boolean): void {
    this.tankFill.style.height = `${Math.round(ratio * 100)}%`;
    this.tank.classList.toggle('low', ratio < 0.18);
    this.hoverRing.classList.toggle('show', hovering || hoverLeft < 0.99);
    this.hoverRing.style.setProperty('--w', `${Math.max(0, Math.round(hoverLeft * 100))}%`);
  }

  setTimer(ms: number, visible: boolean): void {
    const s = visible ? formatTime(ms) : '';
    if (s === this.lastTimer) return;
    this.lastTimer = s;
    this.timer.textContent = s;
    this.timer.style.visibility = visible ? 'visible' : 'hidden';
  }

  setObjective(html: string): void {
    if (html === this.lastObjective) return;
    this.lastObjective = html;
    this.objective.innerHTML = html;
  }

  toast(text: string, seconds = 3): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), seconds * 1000);
  }

  setHint(text: string | null): void {
    this.hint.classList.toggle('hidden', !text);
    if (text) this.hint.textContent = text;
  }

  /** 住人の吹き出しを、頭上の3D位置に合わせて表示する */
  setBubble(name: string | null, text: string, world: THREE.Vector3 | null, camera: THREE.Camera): void {
    if (!name || !world) {
      if (this.lastBubble) { this.bubble.classList.add('hidden'); this.lastBubble = ''; }
      return;
    }
    const v = this.v.copy(world).project(camera);
    if (v.z > 1 || v.z < -1) { this.bubble.classList.add('hidden'); this.lastBubble = ''; return; }
    const key = name + text;
    if (key !== this.lastBubble) {
      this.bubbleName.textContent = name;
      this.bubbleText.textContent = text;
      this.bubble.classList.remove('hidden');
      this.lastBubble = key;
    }
    const w = this.root.clientWidth, h = this.root.clientHeight;
    const x = Math.min(Math.max((v.x * 0.5 + 0.5) * w, 170), w - 170);
    const y = Math.max((-v.y * 0.5 + 0.5) * h - 16, 110);
    this.bubble.style.left = `${x}px`;
    this.bubble.style.top = `${y}px`;
  }

  setFps(text: string | null): void {
    this.fps.classList.toggle('hidden', text === null);
    if (text !== null) this.fps.textContent = text;
  }

  renderMissions(list: MissionView[]): void {
    $('missions').innerHTML = list
      .map((m) => `<li class="${m.done ? 'done' : ''}${m.now ? ' now' : ''}"><i>✓</i><span>${m.title}</span><small>${m.detail}</small></li>`)
      .join('');
  }
}

export { $ };
