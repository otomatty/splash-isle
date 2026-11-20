import * as THREE from 'three';
import { mulberry32, vnoise } from '../engine/noise';

/**
 * 地面の「スミ（汚れ）」。広場まわりを覆うマスクテクスチャで、
 * 水をかけると消えていく。見た目（地形シェーダー）と判定（CPU 側の配列）で同じデータを使う。
 */
export class Goop {
  readonly size = 256;
  readonly world = 96; // マスクが覆う一辺の長さ（m）
  readonly data: Uint8Array;
  readonly tex: THREE.DataTexture;
  readonly rect = new THREE.Vector4();
  private readonly minX: number;
  private readonly minZ: number;
  private readonly scale: number;
  private dirty = false;
  private initialData: Uint8Array | null = null;
  initial = 0;
  remaining = 0;

  constructor(cx: number, cz: number) {
    this.data = new Uint8Array(this.size * this.size);
    this.minX = cx - this.world / 2;
    this.minZ = cz - this.world / 2;
    this.scale = this.size / this.world;
    this.rect.set(this.minX, this.minZ, 1 / this.world, 1 / this.world);
    this.tex = new THREE.DataTexture(this.data, this.size, this.size, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.needsUpdate = true;
  }

  /** 不規則な形のスミだまりを描く */
  paintBlob(x: number, z: number, r: number, seed: number): void {
    const s = this.scale, n = this.size;
    const i0 = Math.max(1, Math.floor((x - r * 1.5 - this.minX) * s)), i1 = Math.min(n - 2, Math.ceil((x + r * 1.5 - this.minX) * s));
    const j0 = Math.max(1, Math.floor((z - r * 1.5 - this.minZ) * s)), j1 = Math.min(n - 2, Math.ceil((z + r * 1.5 - this.minZ) * s));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const wx = this.minX + (i + 0.5) / s, wz = this.minZ + (j + 0.5) / s;
        const d = Math.hypot(wx - x, wz - z);
        const rr = r * (0.72 + 0.6 * vnoise(wx * 0.45, wz * 0.45, seed));
        const v = Math.max(0, Math.min(1, (rr - d) / 0.9 + 0.5));
        const k = j * n + i;
        const nv = Math.round(v * 255);
        if (nv > this.data[k]) this.data[k] = nv;
      }
    }
    this.dirty = true;
  }

  /** 建物などの下にあるスミを消す（洗えない場所に残らないように） */
  eraseRect(cx: number, cz: number, hx: number, hz: number, cos: number, sin: number, margin: number): void {
    const s = this.scale, n = this.size;
    const br = Math.hypot(hx, hz) + margin;
    const i0 = Math.max(0, Math.floor((cx - br - this.minX) * s)), i1 = Math.min(n - 1, Math.ceil((cx + br - this.minX) * s));
    const j0 = Math.max(0, Math.floor((cz - br - this.minZ) * s)), j1 = Math.min(n - 1, Math.ceil((cz + br - this.minZ) * s));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = this.minX + (i + 0.5) / s - cx, dz = this.minZ + (j + 0.5) / s - cz;
        const lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;
        if (Math.abs(lx) <= hx + margin && Math.abs(lz) <= hz + margin) this.data[j * n + i] = 0;
      }
    }
    this.dirty = true;
  }

  /** 条件に合う場所のスミを消す（水の中など、洗えない場所に残さないため） */
  eraseWhere(test: (x: number, z: number) => boolean): void {
    const n = this.size;
    for (let k = 0; k < n * n; k++) {
      if (this.data[k] === 0) continue;
      if (test(this.minX + ((k % n) + 0.5) / this.scale, this.minZ + (Math.floor(k / n) + 0.5) / this.scale)) this.data[k] = 0;
    }
    this.dirty = true;
  }

  eraseCircle(cx: number, cz: number, r: number): void {
    this.clean(cx, cz, r, 10);
  }

  /** 初期配置を確定して、汚れの総量を数える */
  finalize(): void {
    let c = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i] > 127) c++;
    this.initial = c;
    this.remaining = c;
    this.initialData = this.data.slice();
    this.dirty = true;
  }

  /** 最初の汚れた状態に戻す（はじめから遊ぶとき） */
  reset(): void {
    if (this.initialData) this.data.set(this.initialData);
    this.remaining = this.initial;
    this.dirty = true;
  }

  /** 円形に洗い流す。strength は中心での減少量（0〜1 以上）。消えたマス数を返す */
  clean(x: number, z: number, r: number, strength: number): number {
    const s = this.scale, n = this.size;
    const fx = (x - this.minX) * s, fz = (z - this.minZ) * s, fr = r * s;
    if (fx < -fr || fz < -fr || fx > n + fr || fz > n + fr) return 0;
    const i0 = Math.max(0, Math.floor(fx - fr)), i1 = Math.min(n - 1, Math.ceil(fx + fr));
    const j0 = Math.max(0, Math.floor(fz - fr)), j1 = Math.min(n - 1, Math.ceil(fz + fr));
    let cleaned = 0;
    const data = this.data;
    for (let j = j0; j <= j1; j++) {
      const dz = j + 0.5 - fz;
      for (let i = i0; i <= i1; i++) {
        const dx = i + 0.5 - fx;
        const d = Math.sqrt(dx * dx + dz * dz) / fr;
        if (d >= 1) continue;
        const k = j * n + i;
        const old = data[k];
        if (old === 0) continue;
        const nv = Math.max(0, old - Math.round(255 * strength * (1 - d * d)));
        if (old > 127 && nv <= 127) cleaned++;
        data[k] = nv;
      }
    }
    if (cleaned > 0) this.remaining -= cleaned;
    this.dirty = true;
    return cleaned;
  }

  /** その地点がスミで汚れているか */
  at(x: number, z: number): boolean {
    const i = Math.floor((x - this.minX) * this.scale), j = Math.floor((z - this.minZ) * this.scale);
    if (i < 0 || j < 0 || i >= this.size || j >= this.size) return false;
    return this.data[j * this.size + i] > 127;
  }

  /** きれいになった割合（0〜1） */
  get progress(): number {
    return this.initial === 0 ? 1 : 1 - Math.max(0, this.remaining) / this.initial;
  }

  clearAll(): void {
    this.data.fill(0);
    this.remaining = 0;
    this.dirty = true;
  }

  /** 変更があったフレームだけ GPU へ転送する */
  flush(): void {
    if (this.dirty) {
      this.tex.needsUpdate = true;
      this.dirty = false;
    }
  }

  /** 残っている汚れの場所をいくつか返す（残りわずかのときの案内用） */
  findRemaining(out: THREE.Vector3): boolean {
    const n = this.size;
    for (let k = 0; k < n * n; k++) {
      if (this.data[k] > 127) {
        out.set(this.minX + ((k % n) + 0.5) / this.scale, 0, this.minZ + (Math.floor(k / n) + 0.5) / this.scale);
        return true;
      }
    }
    return false;
  }
}

export function scatterGoop(goop: Goop, cx: number, cz: number, seed: number): void {
  const rnd = mulberry32(seed);
  // 広場に大小のスミだまりを散らす（中央の噴水まわりは少し空ける）
  const blobs = 15;
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + rnd() * 0.5;
    const d = 6.5 + rnd() * 11;
    const r = 2.2 + rnd() * 2.6;
    goop.paintBlob(cx + Math.cos(a) * d, cz + Math.sin(a) * d, r, 40 + i);
  }
}
