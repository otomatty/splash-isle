import { heightAt } from './terrain';

/** 直方体の当たり判定（Y軸まわりの回転つき）。動く足場にも使う */
export interface Box {
  cx: number; cy: number; cz: number;
  hx: number; hy: number; hz: number;
  cos: number; sin: number;
  /** このステップで動いた量（動く足場がプレイヤーを運ぶため） */
  dx: number; dy: number; dz: number;
  br: number; // 水平方向の外接半径（大まかな判定用）
}

/** 円柱の当たり判定（縦向き） */
export interface Cyl {
  x: number; z: number; y0: number; y1: number; r: number;
}

/** 立っている場所の情報 */
export interface Contact {
  grounded: boolean;
  onTerrain: boolean;
  platform: Box | null;
  hitWall: boolean;
  hitHead: boolean;
}

export class Colliders {
  readonly boxes: Box[] = [];
  readonly cyls: Cyl[] = [];

  addBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yaw = 0): Box {
    const b: Box = {
      cx, cy, cz, hx: sx / 2, hy: sy / 2, hz: sz / 2,
      cos: Math.cos(yaw), sin: Math.sin(yaw), dx: 0, dy: 0, dz: 0,
      br: Math.hypot(sx / 2, sz / 2),
    };
    this.boxes.push(b);
    return b;
  }

  addCyl(x: number, z: number, y0: number, y1: number, r: number): Cyl {
    const c: Cyl = { x, z, y0, y1, r };
    this.cyls.push(c);
    return c;
  }

  /** 点が何かの内部にあるか（水の粒・カメラの判定用） */
  pointInside(x: number, y: number, z: number, margin = 0): boolean {
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (y > b.cy + b.hy + margin || y < b.cy - b.hy - margin) continue;
      const dx = x - b.cx, dz = z - b.cz;
      if (dx > b.br + margin || dx < -b.br - margin || dz > b.br + margin || dz < -b.br - margin) continue;
      const lx = dx * b.cos - dz * b.sin;
      const lz = dx * b.sin + dz * b.cos;
      if (Math.abs(lx) <= b.hx + margin && Math.abs(lz) <= b.hz + margin) return true;
    }
    const cyls = this.cyls;
    for (let i = 0; i < cyls.length; i++) {
      const c = cyls[i];
      if (y > c.y1 + margin || y < c.y0 - margin) continue;
      const dx = x - c.x, dz = z - c.z;
      const rr = c.r + margin;
      if (dx * dx + dz * dz <= rr * rr) return true;
    }
    return false;
  }

  /** 指定位置の真下にある一番高い「立てる面」の高さ（影やスポーン位置用） */
  surfaceBelow(x: number, y: number, z: number): number {
    let best = heightAt(x, z);
    for (const b of this.boxes) {
      const top = b.cy + b.hy;
      if (top > y + 0.05 || top <= best) continue;
      const dx = x - b.cx, dz = z - b.cz;
      const lx = dx * b.cos - dz * b.sin;
      const lz = dx * b.sin + dz * b.cos;
      if (Math.abs(lx) <= b.hx && Math.abs(lz) <= b.hz) best = top;
    }
    for (const c of this.cyls) {
      if (c.y1 > y + 0.05 || c.y1 <= best) continue;
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz <= c.r * c.r) best = c.y1;
    }
    return best;
  }
}

/** 当たり判定を受ける縦長カプセル状の体（位置は足元） */
export interface Body {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  radius: number;
  height: number;
  /** 前ステップの足元の高さ（上から乗ったかどうかの判定に使う） */
  prevY: number;
}

const contact: Contact = { grounded: false, onTerrain: false, platform: null, hitWall: false, hitHead: false };

/**
 * 体を箱・円柱・地形に対して押し戻す。
 * 「前のステップで上面より上にいた → 着地」「下から当たった → 頭をぶつける」「それ以外 → 横へ押し出す」
 * という単純で頑健なルールにしている。
 */
export function resolveBody(world: Colliders, b: Body, wasGrounded: boolean): Contact {
  contact.grounded = false;
  contact.onTerrain = false;
  contact.platform = null;
  contact.hitWall = false;
  contact.hitHead = false;
  const pr = b.radius;
  const stepUp = wasGrounded ? 0.42 : 0.18;

  const boxes = world.boxes;
  for (let i = 0; i < boxes.length; i++) {
    const bx = boxes[i];
    const top = bx.cy + bx.hy, bot = bx.cy - bx.hy;
    if (b.y >= top || b.y + b.height <= bot) continue;
    const dx = b.x - bx.cx, dz = b.z - bx.cz;
    const reach = bx.br + pr;
    if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue;
    const lx = dx * bx.cos - dz * bx.sin;
    const lz = dx * bx.sin + dz * bx.cos;
    const ox = bx.hx + pr - Math.abs(lx);
    const oz = bx.hz + pr - Math.abs(lz);
    if (ox <= 0 || oz <= 0) continue;
    const prevTop = top - bx.dy;
    const overTop = Math.abs(lx) < bx.hx + pr * 0.5 && Math.abs(lz) < bx.hz + pr * 0.5;
    const falling = b.vy <= 0.01 || bx.dy > 0;
    if (overTop && falling && (b.prevY >= prevTop - 0.03 || top - b.y <= stepUp)) {
      b.y = top;
      b.vy = 0;
      contact.grounded = true;
      contact.platform = bx;
    } else if (falling && wasGrounded && top - b.y <= stepUp) {
      // 低い段差（階段・板の橋）: 縁に触れたら段の上へ乗り上げる
      const mx = bx.hx + pr * 0.45, mz = bx.hz + pr * 0.45;
      const nlx = lx > mx ? mx : lx < -mx ? -mx : lx;
      const nlz = lz > mz ? mz : lz < -mz ? -mz : lz;
      b.x = bx.cx + nlx * bx.cos + nlz * bx.sin;
      b.z = bx.cz - nlx * bx.sin + nlz * bx.cos;
      b.y = top;
      b.vy = 0;
      contact.grounded = true;
      contact.platform = bx;
    } else if (b.prevY + b.height <= bot - bx.dy + 0.05 && b.vy > 0) {
      b.y = bot - b.height;
      b.vy = 0;
      contact.hitHead = true;
    } else {
      // 横へ押し出す（めり込みの浅い軸を選ぶ）
      let nlx = lx, nlz = lz;
      if (ox < oz) nlx = lx + (lx >= 0 ? ox : -ox);
      else nlz = lz + (lz >= 0 ? oz : -oz);
      b.x = bx.cx + nlx * bx.cos + nlz * bx.sin;
      b.z = bx.cz - nlx * bx.sin + nlz * bx.cos;
      // 壁に向かう速度成分を消す
      const lvx = b.vx * bx.cos - b.vz * bx.sin;
      const lvz = b.vx * bx.sin + b.vz * bx.cos;
      let nvx = lvx, nvz = lvz;
      if (ox < oz) { if (lvx * lx < 0) nvx = 0; } else if (lvz * lz < 0) nvz = 0;
      b.vx = nvx * bx.cos + nvz * bx.sin;
      b.vz = -nvx * bx.sin + nvz * bx.cos;
      contact.hitWall = true;
    }
  }

  const cyls = world.cyls;
  for (let i = 0; i < cyls.length; i++) {
    const c = cyls[i];
    if (b.y >= c.y1 || b.y + b.height <= c.y0) continue;
    const dx = b.x - c.x, dz = b.z - c.z;
    const rr = c.r + pr;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) continue;
    const d = Math.sqrt(d2);
    if (d < c.r + pr * 0.5 && b.vy <= 0.01 && (b.prevY >= c.y1 - 0.03 || c.y1 - b.y <= stepUp)) {
      b.y = c.y1;
      b.vy = 0;
      contact.grounded = true;
    } else if (b.vy <= 0.01 && wasGrounded && c.y1 - b.y <= stepUp) {
      const k = d > 1e-4 ? (c.r + pr * 0.45) / d : 0;
      b.x = c.x + dx * k;
      b.z = c.z + dz * k;
      b.y = c.y1;
      b.vy = 0;
      contact.grounded = true;
    } else if (b.prevY + b.height <= c.y0 + 0.05 && b.vy > 0) {
      b.y = c.y0 - b.height;
      b.vy = 0;
      contact.hitHead = true;
    } else {
      const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
      b.x = c.x + nx * rr;
      b.z = c.z + nz * rr;
      const vn = b.vx * nx + b.vz * nz;
      if (vn < 0) { b.vx -= vn * nx; b.vz -= vn * nz; }
      contact.hitWall = true;
    }
  }

  // 地形
  const th = heightAt(b.x, b.z);
  if (!contact.grounded) {
    const snap = wasGrounded && b.vy <= 0.01 ? 0.3 : 0;
    if (b.y <= th + snap) {
      b.y = th;
      if (b.vy < 0) b.vy = 0;
      contact.grounded = true;
      contact.onTerrain = true;
    }
  } else if (b.y < th) {
    b.y = th;
    contact.onTerrain = true;
    contact.platform = null;
  }
  return contact;
}
