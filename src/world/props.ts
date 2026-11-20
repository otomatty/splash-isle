import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm, lerp, vnoise } from '../engine/noise';

/** 位置・Y回転・拡縮から行列を作る小道具 */
export function M(x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  _e.set(rx, ry, rz, 'YXZ');
  _qq.setFromEuler(_e);
  return m.compose(_p.set(x, y, z), _qq, _s.set(sx, sy, sz));
}
const _e = new THREE.Euler();
const _qq = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _c3 = new THREE.Color();

export interface PaintOpts {
  /** 下端をどれだけ暗くするか（疑似アンビエントオクルージョン）。1 で無効 */
  ao?: number;
  /** 上端の色（指定すると下→上のグラデーション） */
  top?: THREE.ColorRepresentation;
  /** 頂点ごとの色ムラの強さ */
  jitter?: number;
  /** 頂点の位置から色を決める関数（模様の塗り分け用）。out を書き換える */
  paint?: (x: number, y: number, z: number, out: THREE.Color) => void;
}

/**
 * 頂点カラー付きのジオメトリを1つにまとめるバッチ。
 * 島の建物や小物は数個のドローコールに収まる。
 */
export class GeoBatch {
  private readonly parts: THREE.BufferGeometry[] = [];
  readonly base = new THREE.Matrix4();
  private readonly tmp = new THREE.Matrix4();

  setBase(m: THREE.Matrix4): this {
    this.base.copy(m);
    return this;
  }

  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, local?: THREE.Matrix4, opts: PaintOpts = {}): this {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    geo.dispose();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const pos = g.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    _c.set(color);
    const hasTop = opts.top !== undefined;
    if (hasTop) _c2.set(opts.top!);
    const ao = opts.ao ?? 1;
    const jit = opts.jitter ?? 0;
    const h = Math.max(bb.max.y - bb.min.y, 1e-4);
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) - bb.min.y) / h;
      let r = _c.r, gg = _c.g, b = _c.b;
      if (opts.paint) {
        _c3.copy(_c);
        opts.paint(pos.getX(i), pos.getY(i), pos.getZ(i), _c3);
        r = _c3.r; gg = _c3.g; b = _c3.b;
      }
      if (hasTop) { r = lerp(r, _c2.r, t); gg = lerp(gg, _c2.g, t); b = lerp(b, _c2.b, t); }
      let k = lerp(ao, 1, Math.min(1, t * 1.6));
      if (jit > 0) k *= 1 + (vnoise(pos.getX(i) * 3.1 + i * 0.37, pos.getZ(i) * 3.1, 7) - 0.5) * jit;
      col[i * 3] = r * k; col[i * 3 + 1] = gg * k; col[i * 3 + 2] = b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.tmp.copy(this.base);
    if (local) this.tmp.multiply(local);
    g.applyMatrix4(this.tmp);
    this.parts.push(g);
    g = null!;
    return this;
  }

  get empty(): boolean {
    return this.parts.length === 0;
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false)!;
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt: number, rb: number, h: number, seg = 12, hs = 1, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, hs, open);
export const sph = (r: number, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
export const cone = (r: number, h: number, seg = 12) => new THREE.ConeGeometry(r, h, seg);

/** 風で揺れる頂点アニメーションをマテリアルに足す（高い位置ほど大きく揺れる） */
export function addSway(mat: THREE.Material, time: { value: number }, strength: number, heightScale: number): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 sw_o = instanceMatrix[3].xz;
        #else
          vec2 sw_o = vec2(0.0);
        #endif
        float sw_h = max(transformed.y, 0.0) * ${heightScale.toFixed(4)};
        float sw_k = sw_h * sw_h * ${strength.toFixed(4)};
        float sw_t = uTime * 1.25 + sw_o.x * 0.21 + sw_o.y * 0.17;
        transformed.x += (sin(sw_t) + 0.5 * sin(sw_t * 2.3 + transformed.z * 1.7)) * sw_k;
        transformed.z += (cos(sw_t * 0.8) + 0.5 * sin(sw_t * 1.9 + transformed.x * 1.3)) * sw_k * 0.7;`,
      );
  };
}

/** ヤシの木（幹＋2段の葉＋実）を1つのジオメトリとして作る */
export function buildPalmGeometry(): THREE.BufferGeometry {
  const b = new GeoBatch();
  const H = 6.6;
  // 幹: 節のふくらみと、上へ行くほど曲がるカーブ
  const trunk = cyl(0.16, 0.30, H, 9, 16);
  trunk.translate(0, H / 2, 0);
  const tp = trunk.getAttribute('position');
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i), t = y / H;
    const ring = 1 + 0.10 * Math.sin(t * 44);
    const flare = 1 + 0.5 * Math.exp(-t * 14);
    tp.setX(i, tp.getX(i) * ring * flare + 1.15 * t * t);
    tp.setZ(i, tp.getZ(i) * ring * flare);
  }
  trunk.computeVertexNormals();
  b.add(trunk, 0x6b4a2c, undefined, { top: 0x9a7448, ao: 0.6, jitter: 0.25 });
  const topX = 1.15;
  // 葉
  const frond = (len: number, tilt: number, droop: number, yaw: number, width: number) => {
    const seg = 14;
    const pos: number[] = [];
    const col: number[] = [];
    let px = 0.1, py = 0, a = tilt;
    const ds = len / seg;
    const rows: number[][] = [];
    for (let s = 0; s <= seg; s++) {
      const t = s / seg;
      const w = width * Math.pow(Math.sin(Math.PI * (0.06 + 0.94 * t)), 0.55) * (1 - 0.35 * t) * (s % 2 === 0 ? 1 : 0.72);
      const sag = w * 0.55;
      rows.push([px, py, w, sag, t]);
      a -= (droop / seg) * (0.6 + 0.8 * t);
      px += Math.cos(a) * ds;
      py += Math.sin(a) * ds;
    }
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const put = (x: number, y: number, z: number, g: number, t: number) => {
      pos.push(x * cy + z * sy, y, -x * sy + z * cy);
      const tip = t * t;
      col.push(lerp(0.05, 0.42, g) + tip * 0.22, lerp(0.22, 0.62, g) + tip * 0.1, lerp(0.04, 0.12, g));
    };
    for (let s = 0; s < seg; s++) {
      const [x0, y0, w0, g0, t0] = rows[s];
      const [x1, y1, w1, g1, t1] = rows[s + 1];
      for (const side of [-1, 1]) {
        // 中央の葉脈（明るい）→ 端（暗い）の2三角形
        const ax = x0, ay = y0, az = 0;
        const bx = x1, by = y1, bz = 0;
        const cx_ = x0, cy_ = y0 - g0, cz = side * w0;
        const dx = x1, dy = y1 - g1, dz = side * w1;
        if (side > 0) {
          put(ax, ay, az, 1, t0); put(cx_, cy_, cz, 0.25, t0); put(bx, by, bz, 1, t1);
          put(bx, by, bz, 1, t1); put(cx_, cy_, cz, 0.25, t0); put(dx, dy, dz, 0.25, t1);
        } else {
          put(ax, ay, az, 1, t0); put(bx, by, bz, 1, t1); put(cx_, cy_, cz, 0.25, t0);
          put(bx, by, bz, 1, t1); put(dx, dy, dz, 0.25, t1); put(cx_, cy_, cz, 0.25, t0);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.translate(topX, H - 0.05, 0);
    return g;
  };
  const fronds: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) fronds.push(frond(3.5 + (i % 3) * 0.25, 0.42 + (i % 2) * 0.16, 1.75, (i / 9) * Math.PI * 2 + 0.2, 0.62));
  for (let i = 0; i < 6; i++) fronds.push(frond(2.5, 1.05, 1.35, (i / 6) * Math.PI * 2 + 0.6, 0.48));
  // 実
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + 0.4;
    b.add(sph(0.17, 8, 6), 0x5a3d1f, M(topX + Math.cos(a) * 0.24, H - 0.22, Math.sin(a) * 0.24), { top: 0x8a6a35 });
  }
  b.add(sph(0.3, 8, 6), 0x4f6f24, M(topX, H - 0.02, 0, 0, 1, 0.8, 1));
  const body = b.build();
  const merged = mergeGeometries([body, ...fronds], false)!;
  merged.computeBoundingSphere();
  return merged;
}

/** ごつごつした岩 */
export function buildRockGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = fbm(x * 1.3 + seed, y * 1.3 + z * 1.1 + seed * 0.7, 3, seed);
    const k = 0.72 + n * 0.62;
    p.setXYZ(i, x * k, Math.max(y * k * 0.78, -0.35), z * k);
    const s = 0.34 + n * 0.36 + Math.max(0, y) * 0.12;
    col[i * 3] = s * 1.04; col[i * 3 + 1] = s * 0.97; col[i * 3 + 2] = s * 0.88;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const out = g;
  out.deleteAttribute('uv');
  out.computeVertexNormals(); // フラットシェーディングで岩らしい面を出す
  return out;
}

/** 低木 */
export function buildBushGeometry(): THREE.BufferGeometry {
  const b = new GeoBatch();
  const lump = (x: number, y: number, z: number, r: number, c: number, c2: number) => {
    const raw = new THREE.IcosahedronGeometry(r, 1);
    raw.deleteAttribute('normal');
    raw.deleteAttribute('uv');
    const g = mergeVertices(raw, 1e-4); // 頂点を共有させて、なめらかな陰影にする
    raw.dispose();
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const k = 0.82 + 0.36 * vnoise(p.getX(i) * 4 + x * 9, p.getY(i) * 4 + p.getZ(i) * 3, 11);
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.85, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    b.add(g, c, M(x, y, z), { top: c2, ao: 0.5 });
  };
  lump(0, 0.45, 0, 0.7, 0x1f5a1a, 0x5fa52c);
  lump(0.55, 0.36, 0.2, 0.5, 0x1c5318, 0x6bb030);
  lump(-0.45, 0.34, -0.3, 0.52, 0x245f1c, 0x58a028);
  lump(0.1, 0.3, -0.55, 0.42, 0x1f5a1a, 0x74b834);
  return b.build();
}

/** 草むら（細い葉の束） */
export function buildGrassTuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const blades = 6;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + i * 0.7;
    const lean = 0.10 + (i % 3) * 0.06;
    const h = 0.20 + (i % 4) * 0.05;
    const w = 0.04;
    const ox = Math.cos(a) * 0.12, oz = Math.sin(a) * 0.12;
    const px = Math.cos(a + 1.57) * w, pz = Math.sin(a + 1.57) * w;
    const tx = ox + Math.cos(a) * lean, tz = oz + Math.sin(a) * lean;
    pos.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, tx, h, tz);
    col.push(0.10, 0.33, 0.07, 0.10, 0.33, 0.07, 0.30, 0.56, 0.13);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // 法線は真上へ向けて、地面と同じ明るさで馴染ませる
  const nrm = new Float32Array(pos.length);
  for (let i = 0; i < nrm.length; i += 3) nrm[i + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return g;
}

/** 文字入りの板などに使うキャンバステクスチャ */
export function textTexture(lines: string[], opts: { w?: number; h?: number; bg?: string; fg?: string; font?: number } = {}): THREE.CanvasTexture {
  const w = opts.w ?? 512, h = opts.h ?? 256;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = opts.bg ?? '#e9d3a4';
  ctx.fillRect(0, 0, w, h);
  // 木目
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = '#7a5a30';
  for (let i = 0; i < 26; i++) {
    ctx.beginPath();
    const y = (i / 26) * h + Math.sin(i * 3.1) * 4;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(w * 0.3, y + 6, w * 0.6, y - 6, w, y + 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = opts.fg ?? '#4a2f14';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fs = opts.font ?? 84;
  ctx.font = `900 ${fs}px "Hiragino Maru Gothic ProN", "Zen Maru Gothic", "Yu Gothic", "Meiryo", sans-serif`;
  const lh = fs * 1.15;
  lines.forEach((ln, i) => ctx.fillText(ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * lh));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
