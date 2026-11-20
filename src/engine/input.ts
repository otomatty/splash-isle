/**
 * 入力のまとめ役。キーボード＋マウス、ゲームパッド、タッチを同じ値に正規化する。
 *   move: -1〜1 のスティック値 / look: このフレームの視点移動量 / jump・spray・hover: 押しっぱなし状態
 */
export class Input {
  moveX = 0;
  moveY = 0;
  lookX = 0;
  lookY = 0;
  zoom = 0;
  jump = false;
  jumpPressed = false;
  spray = false;
  hover = false;
  pausePressed = false;
  anyPressed = false;
  /** 最後に使われた入力機器（操作ガイドの表示切り替え用） */
  device: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';
  sensitivity = 1;
  invertY = false;
  enabled = false;

  private readonly keys = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  private wheel = 0;
  private mouseL = false;
  private mouseR = false;
  private dragging = false;
  private jumpEdge = false;
  private pauseEdge = false;
  private anyEdge = false;
  private padJumpPrev = false;
  private padPausePrev = false;
  // タッチ
  private stickId = -1;
  private stickX0 = 0;
  private stickY0 = 0;
  private touchMX = 0;
  private touchMY = 0;
  private lookId = -1;
  private lookPX = 0;
  private lookPY = 0;
  private touchJump = false;
  private touchSpray = false;
  private touchHover = false;
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly touchUI: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.device = 'keyboard';
      this.anyEdge = true;
      if (e.code === 'Space') this.jumpEdge = true;
      if (e.code === 'KeyP' || e.code === 'Escape') this.pauseEdge = true;
      if (this.enabled && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseL = this.mouseR = false;
    });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      this.device = 'keyboard';
      if (document.pointerLockElement !== canvas) {
        this.requestLock();
        this.dragging = true; // ポインターロックが使えない環境ではドラッグで視点操作
      }
      if (e.button === 0) this.mouseL = true;
      if (e.button === 2) this.mouseR = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseL = false;
      if (e.button === 2) this.mouseR = false;
      this.dragging = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement === canvas || this.dragging) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    canvas.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => this.onLockChange?.(document.pointerLockElement === canvas));

    this.setupTouch();
  }

  requestLock(): void {
    try {
      const p = this.canvas.requestPointerLock() as unknown;
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => undefined);
    } catch {
      /* ポインターロック不可の環境（埋め込み表示など）ではドラッグ操作にフォールバック */
    }
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  private setupTouch(): void {
    const ui = this.touchUI;
    const stick = ui.querySelector<HTMLElement>('.stick')!;
    const knob = ui.querySelector<HTMLElement>('.knob')!;
    const bind = (sel: string, set: (v: boolean) => void) => {
      const el = ui.querySelector<HTMLElement>(sel)!;
      const on = (e: Event) => { e.preventDefault(); e.stopPropagation(); set(true); el.classList.add('on'); };
      const off = (e: Event) => { e.preventDefault(); e.stopPropagation(); set(false); el.classList.remove('on'); };
      el.addEventListener('touchstart', on, { passive: false });
      el.addEventListener('touchend', off, { passive: false });
      el.addEventListener('touchcancel', off, { passive: false });
    };
    bind('.btn-jump', (v) => { this.touchJump = v; if (v) this.jumpEdge = true; });
    bind('.btn-spray', (v) => (this.touchSpray = v));
    bind('.btn-hover', (v) => (this.touchHover = v));
    ui.querySelector<HTMLElement>('.btn-pause')!.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); this.pauseEdge = true; }, { passive: false });

    const start = (e: TouchEvent) => {
      this.device = 'touch';
      this.anyEdge = true;
      document.body.classList.add('touch');
      if (!this.enabled) return;
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < window.innerWidth * 0.42 && this.stickId < 0) {
          this.stickId = t.identifier;
          this.stickX0 = t.clientX;
          this.stickY0 = t.clientY;
          stick.style.left = `${t.clientX}px`;
          stick.style.top = `${t.clientY}px`;
          stick.classList.add('on');
        } else if (this.lookId < 0) {
          this.lookId = t.identifier;
          this.lookPX = t.clientX;
          this.lookPY = t.clientY;
        }
      }
      e.preventDefault();
    };
    const move = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.stickId) {
          const R = 56;
          let dx = t.clientX - this.stickX0, dy = t.clientY - this.stickY0;
          const d = Math.hypot(dx, dy);
          if (d > R) { dx *= R / d; dy *= R / d; }
          this.touchMX = dx / R;
          this.touchMY = dy / R;
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
        } else if (t.identifier === this.lookId) {
          this.mouseDX += (t.clientX - this.lookPX) * 2.2;
          this.mouseDY += (t.clientY - this.lookPY) * 2.2;
          this.lookPX = t.clientX;
          this.lookPY = t.clientY;
        }
      }
      e.preventDefault();
    };
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.stickId) {
          this.stickId = -1;
          this.touchMX = this.touchMY = 0;
          knob.style.transform = '';
          stick.classList.remove('on');
        } else if (t.identifier === this.lookId) {
          this.lookId = -1;
        }
      }
    };
    this.canvas.addEventListener('touchstart', start, { passive: false });
    this.canvas.addEventListener('touchmove', move, { passive: false });
    this.canvas.addEventListener('touchend', end);
    this.canvas.addEventListener('touchcancel', end);
  }

  /** 1フレームに1回呼ぶ。各機器の状態をまとめて公開用の値に反映する */
  poll(): void {
    const k = this.keys;
    let mx = 0, my = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) my -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) my += 1;
    let jump = k.has('Space');
    let spray = this.mouseL || k.has('KeyF') || k.has('KeyJ');
    let hover = this.mouseR || k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyE');
    let lx = this.mouseDX * 0.0024, ly = this.mouseDY * 0.0024;
    let zoom = this.wheel;

    // タッチ
    if (this.stickId >= 0) { mx = this.touchMX; my = this.touchMY; }
    jump = jump || this.touchJump;
    spray = spray || this.touchSpray;
    hover = hover || this.touchHover;

    // ゲームパッド（標準配置）
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected || gp.mapping !== 'standard') continue;
      const dz = (v: number) => (Math.abs(v) < 0.16 ? 0 : (v - Math.sign(v) * 0.16) / 0.84);
      const ax = dz(gp.axes[0] ?? 0), ay = dz(gp.axes[1] ?? 0);
      const rx = dz(gp.axes[2] ?? 0), ry = dz(gp.axes[3] ?? 0);
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      const used = ax || ay || rx || ry || gp.buttons.some((x) => x.pressed);
      if (used) { this.device = 'gamepad'; this.anyEdge = this.anyEdge || gp.buttons.some((x) => x.pressed); }
      if (ax || ay) { mx = ax; my = ay; }
      lx += rx * 0.045;
      ly += ry * 0.032;
      const pj = b(0);
      if (pj && !this.padJumpPrev) this.jumpEdge = true;
      this.padJumpPrev = pj;
      jump = jump || pj;
      spray = spray || b(7) || b(2);
      hover = hover || b(6) || b(5) || b(1);
      const pp = b(9);
      if (pp && !this.padPausePrev) this.pauseEdge = true;
      this.padPausePrev = pp;
      if (b(12)) zoom -= 0.2;
      if (b(13)) zoom += 0.2;
      break;
    }

    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.moveX = mx;
    this.moveY = my;
    this.lookX = lx * this.sensitivity;
    this.lookY = ly * this.sensitivity * (this.invertY ? -1 : 1);
    this.zoom = zoom;
    this.jump = jump;
    this.spray = spray;
    this.hover = hover;
    this.jumpPressed = this.jumpEdge;
    this.pausePressed = this.pauseEdge;
    this.anyPressed = this.anyEdge;
    this.jumpEdge = this.pauseEdge = this.anyEdge = false;
    this.mouseDX = this.mouseDY = 0;
    this.wheel = 0;
  }

  /** メニューを開いたときなどに押しっぱなし状態を捨てる */
  reset(): void {
    this.keys.clear();
    this.mouseL = this.mouseR = false;
    this.touchJump = this.touchSpray = this.touchHover = false;
    this.mouseDX = this.mouseDY = 0;
  }
}
