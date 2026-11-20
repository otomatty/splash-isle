import type { Panels } from './panels';

type MenuScreen = 'login' | 'files' | 'story' | 'loading' | 'game';
const Key = { accept: 1, back: 2, left: 4, right: 8, up: 16, down: 32 } as const;

function connectedPad(): Gamepad | undefined {
  try {
    return Array.from(navigator.getGamepads?.() ?? []).find((pad): pad is Gamepad =>
      !!pad && pad.connected && pad.mapping === 'standard');
  } catch {
    // Gamepad API が埋め込み元の権限で無効な場合も、ほかの入力はそのまま使える。
    return undefined;
  }
}

function readButtons(pad: Gamepad): number {
  const pressed = (index: number) => pad.buttons[index]?.pressed;
  const [x = 0, y = 0] = pad.axes;
  let held = 0;
  if (pressed(0) || pressed(9)) held |= Key.accept;
  if (pressed(1)) held |= Key.back;
  if (pressed(14) || x < -0.55) held |= Key.left;
  if (pressed(15) || x > 0.55) held |= Key.right;
  if (pressed(12) || y < -0.55) held |= Key.up;
  if (pressed(13) || y > 0.55) held |= Key.down;
  return held;
}

function adjust(control: HTMLElement, step: number): boolean {
  if (control instanceof HTMLSelectElement) {
    control.selectedIndex = Math.max(0, Math.min(control.options.length - 1, control.selectedIndex + step));
  } else if (control instanceof HTMLInputElement && control.type === 'range') {
    if (step > 0) control.stepUp();
    else control.stepDown();
  } else return false;
  control.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

/** 表示中の操作部品から、押した方向に近いものを選ぶ。横並び・縦並びの両レイアウトに対応。 */
function moveFocus(active: HTMLElement, controls: HTMLElement[], dx: number, dy: number): void {
  if (dx && adjust(active, dx)) return;
  const origin = active.getBoundingClientRect();
  let closest: HTMLElement | undefined;
  let best = Infinity;
  for (const control of controls) {
    const rect = control.getBoundingClientRect();
    const x = (rect.left + rect.right - origin.left - origin.right) / 2;
    const y = (rect.top + rect.bottom - origin.top - origin.bottom) / 2;
    const ahead = x * dx + y * dy;
    if (ahead < 1) continue;
    const distance = ahead + 3 * Math.abs(x * dy - y * dx);
    if (distance < best) { best = distance; closest = control; }
  }
  if (closest) {
    closest.focus({ focusVisible: true } as FocusOptions);
    if (closest.matches('#slotA, #slotB, #slotC')) closest.click();
  }
}

/** 画面を切り替えたら戻り値を呼ぶ。プレイ中・待機中・未接続時はタイマーを持たない。 */
export function installMenuGamepad(getScreen: () => MenuScreen, panels: Panels): () => void {
  let timer: number | undefined;
  let previous = 0;
  let repeatAt = 0;
  const available = () => !document.hidden && getScreen() !== 'game' && getScreen() !== 'loading';

  function poll(): void {
    const pad = connectedPad();
    if (!pad || !available()) { refresh(); return; }
    const held = readButtons(pad);
    let edge = held & ~previous;
    const directions = held & (Key.left | Key.right | Key.up | Key.down);
    const now = performance.now();
    if (edge & directions) repeatAt = now + 420;
    else if (!directions) repeatAt = 0;
    else if (repeatAt && now >= repeatAt && !(held & (Key.accept | Key.back))) {
      edge |= directions;
      repeatAt = now + 150;
    }
    previous = held;
    if (!edge) return;

    const screen = getScreen();
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (edge & Key.back) {
      if (dialog) dialog.close();
      else if (panels.isOpen) panels.close();
      else if (screen === 'story') document.getElementById('storyMenu')?.click();
      return;
    }
    const panel = panels.isOpen ? document.querySelector<HTMLElement>('#app > [aria-modal="true"]:not(.hidden)') : null;
    const root = dialog ?? panel ?? document.getElementById(screen === 'files' ? 'title' : screen === 'story' ? 'prologue' : 'login');
    if (!root) return;
    const controls = Array.from(root.querySelectorAll<HTMLElement>('button:enabled, select:enabled, input:enabled'))
      .filter(control => !control.closest('[inert]') && control.getClientRects().length > 0);
    if (!controls.length) return;
    const active = controls.find(control => control === document.activeElement);
    if (!active) {
      controls[0].focus({ focusVisible: true } as FocusOptions);
    } else if (edge & Key.accept) {
      if (active instanceof HTMLSelectElement) adjust(active, active.selectedIndex + 1 < active.options.length ? 1 : -active.selectedIndex);
      else active.click();
    } else {
      const dx = edge & Key.left ? -1 : edge & Key.right ? 1 : 0;
      const dy = dx ? 0 : edge & Key.up ? -1 : edge & Key.down ? 1 : 0;
      moveFocus(active, controls, dx, dy);
    }
  }

  function refresh(): void {
    window.clearInterval(timer);
    timer = undefined;
    const pad = available() ? connectedPad() : undefined;
    if (!pad) return;
    repeatAt = 0;
    previous = readButtons(pad); // 直前の画面で押し続けた決定を引き継がない。
    timer = window.setInterval(poll, 60);
  }

  window.addEventListener('gamepadconnected', refresh);
  window.addEventListener('gamepaddisconnected', refresh);
  document.addEventListener('visibilitychange', refresh);
  refresh();
  return refresh;
}
