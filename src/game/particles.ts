import * as THREE from 'three';
import { heightAt } from '../world/terrain';
import type { Colliders } from '../world/colliders';
import type { Goop } from '../world/goop';

/** 粒の種類 */
export const P_SPRAY = 0; // 噴射した水（スミを洗い、敵に当たる）
export const P_JET = 1; // ホバーの噴流（弱く洗う）
export const P_SPLASH = 2; // しぶき
export const P_DUST = 3; // 砂ぼこり
export const P_SPARK = 4; // きらめき
export const P_INK = 5; // スミのしぶき
export const P_MIST = 6; // 水流のまわりの霧

const KIND = [0, 0, 0, 1, 2, 3, 4]; // シェーダー側の見た目の種類
const GRAV = [21, 16, 17, -0.6, 2.5, 16, 12];
const DRAG = [0.25, 1.2, 1.4, 2.6, 1.6, 1.0, 1.8];

/**
 * 全パーティクルを1回のドローコールで描くプール。
 * 配列を詰めて管理するので、生成・消滅でメモリ確保が起きない。
 */
export class Particles {
  readonly max = 2200;
  readonly points: THREE.Points;
  private n = 0;
  private readonly pos = new Float32Array(this.max * 3);
  private readonly vel = new Float32Array(this.max * 3);
  private readonly info = new Float32Array(this.max * 3); // size, alpha, kind
  private readonly life = new Float32Array(this.max);
  private readonly maxLife = new Float32Array(this.max);
  private readonly size = new Float32Array(this.max);
  private readonly type = new Uint8Array(this.max);
  private readonly posAttr: THREE.BufferAttribute;
  private readonly infoAttr: THREE.BufferAttribute;
  readonly uniforms = { uScale: { value: 600 } };
  /** 噴射した水が何かに当たったか調べるフック（敵など）。true を返すと粒は消える */
  onSprayHit: ((x: number, y: number, z: number) => boolean) | null = null;
  /** 水が地面のスミを洗い流したときの通知 */
  onClean: ((cells: number, x: number, y: number, z: number) => void) | null = null;
  private frame = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.infoAttr = new THREE.BufferAttribute(this.info, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.infoAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('aInfo', this.infoAttr);
    geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec3 aInfo;
        uniform float uScale;
        varying float vAlpha;
        varying float vKind;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aInfo.x * uScale / max(-mv.z, 0.1), 1.0, 160.0);
          vAlpha = aInfo.y;
          vKind = aInfo.z;
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying float vKind;
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(c, c);
          if (r2 > 1.0) discard;
          float soft = 1.0 - smoothstep(0.5, 1.0, r2);
          vec3 col;
          float a = vAlpha * soft;
          if (vKind < 0.5) {
            // 水滴: 淡い水色の球に、太陽側のハイライトと縁の明るさ
            float hl = smoothstep(0.6, 0.0, length(c - vec2(-0.28, -0.34)));
            float rim = smoothstep(0.35, 1.0, r2);
            col = mix(vec3(0.50, 0.86, 1.0), vec3(0.92, 0.99, 1.0), rim * 0.75);
            col += vec3(1.5) * hl * hl;
          } else if (vKind < 1.5) {
            col = vec3(0.88, 0.80, 0.62);
            a *= 0.55 * (1.0 - r2);
          } else if (vKind < 2.5) {
            float star = max(0.0, 1.0 - abs(c.x) * 6.0) + max(0.0, 1.0 - abs(c.y) * 6.0);
            col = vec3(3.2, 2.5, 0.9) * (0.5 + star);
            a *= (1.0 - r2);
          } else if (vKind < 3.5) {
            col = mix(vec3(0.14, 0.03, 0.22), vec3(0.50, 0.12, 0.55), smoothstep(0.7, 0.0, length(c - vec2(-0.3))));
          } else {
            col = vec3(0.88, 0.97, 1.0);
            a = vAlpha * 0.34 * (1.0 - r2) * (1.0 - r2);
          }
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    this.points.name = 'particles';
  }

  spawn(type: number, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number): void {
    let i = this.n;
    if (i >= this.max) {
      // 満杯のときは一番古い枠を使い回す
      i = this.frame++ % this.max;
    } else {
      this.n++;
    }
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.type[i] = type;
  }

  /** 四方へ飛び散る粒をまとめて出す */
  burst(type: number, x: number, y: number, z: number, count: number, speed: number, up: number, life: number, size: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.65);
      this.spawn(type, x, y, z, Math.cos(a) * s, up * (0.4 + Math.random() * 0.6), Math.sin(a) * s, life * (0.6 + Math.random() * 0.4), size * (0.7 + Math.random() * 0.6));
    }
  }

  private kill(i: number): void {
    const last = --this.n;
    if (i !== last) {
      const k = i * 3, l = last * 3;
      this.pos[k] = this.pos[l]; this.pos[k + 1] = this.pos[l + 1]; this.pos[k + 2] = this.pos[l + 2];
      this.vel[k] = this.vel[l]; this.vel[k + 1] = this.vel[l + 1]; this.vel[k + 2] = this.vel[l + 2];
      this.life[i] = this.life[last];
      this.maxLife[i] = this.maxLife[last];
      this.size[i] = this.size[last];
      this.type[i] = this.type[last];
    }
  }

  update(dt: number, goop: Goop, colliders: Colliders): void {
    const pos = this.pos, vel = this.vel;
    for (let i = this.n - 1; i >= 0; i--) {
      const life = (this.life[i] -= dt);
      if (life <= 0) { this.kill(i); continue; }
      const t = this.type[i];
      const k = i * 3;
      const drag = Math.max(0, 1 - DRAG[t] * dt);
      vel[k] *= drag; vel[k + 2] *= drag;
      vel[k + 1] = vel[k + 1] * drag - GRAV[t] * dt;
      const x = (pos[k] += vel[k] * dt);
      const y = (pos[k + 1] += vel[k + 1] * dt);
      const z = (pos[k + 2] += vel[k + 2] * dt);
      if (t === P_SPRAY || t === P_JET) {
        const h = heightAt(x, z);
        if (y <= Math.max(h, 0)) {
          if (h > -0.3) {
            const c = t === P_SPRAY ? goop.clean(x, z, 1.35, 0.4) : goop.clean(x, z, 0.9, 0.22);
            if (c > 0) this.onClean?.(c, x, h, z);
          }
          const s = t === P_SPRAY ? 3 : 1;
          const gy = Math.max(h, 0) + 0.05;
          for (let j = 0; j < s; j++) {
            const a = Math.random() * 6.283, sp = 1 + Math.random() * 2.2;
            this.spawn(P_SPLASH, x, gy, z, Math.cos(a) * sp * 1.4, 2.0 + Math.random() * 2.8, Math.sin(a) * sp * 1.4, 0.32 + Math.random() * 0.22, 0.11 + Math.random() * 0.1);
          }
          this.kill(i);
          continue;
        }
        if (t === P_SPRAY && this.onSprayHit?.(x, y, z)) {
          this.spawn(P_SPLASH, x, y, z, -vel[k] * 0.12, 2.5, -vel[k + 2] * 0.12, 0.3, 0.12);
          this.kill(i);
          continue;
        }
        // 建物や足場への衝突（負荷を抑えるため1フレームおきに半数ずつ調べる）
        if (((i + this.frame) & 1) === 0 && colliders.pointInside(x, y, z)) {
          this.spawn(P_SPLASH, x - vel[k] * dt, y - vel[k + 1] * dt + 0.05, z - vel[k + 2] * dt, -vel[k] * 0.1 + (Math.random() - 0.5) * 2, 1.5 + Math.random() * 2, -vel[k + 2] * 0.1 + (Math.random() - 0.5) * 2, 0.3, 0.1);
          this.kill(i);
          continue;
        }
      } else if (t === P_SPLASH || t === P_INK) {
        if (y < Math.max(heightAt(x, z), 0) - 0.05) { this.kill(i); continue; }
      }
    }
    this.frame++;
  }

  /** 描画用バッファを更新する（1フレームに1回） */
  sync(pixelScale: number): void {
    this.uniforms.uScale.value = pixelScale;
    const info = this.info;
    for (let i = 0; i < this.n; i++) {
      const f = this.life[i] / this.maxLife[i];
      const t = this.type[i];
      const k = i * 3;
      let size = this.size[i];
      let alpha = Math.min(1, f * 3.5);
      if (t === P_DUST) { size *= 1 + (1 - f) * 2.2; alpha = f; }
      else if (t === P_SPARK) { size *= 0.4 + f * 0.8; }
      else if (t === P_SPLASH) { alpha = Math.min(1, f * 2.2); }
      else if (t === P_MIST) { size *= 1 + (1 - f) * 1.6; alpha = f; }
      info[k] = size; info[k + 1] = alpha; info[k + 2] = KIND[t];
    }
    this.posAttr.clearUpdateRanges();
    this.infoAttr.clearUpdateRanges();
    this.posAttr.addUpdateRange(0, this.n * 3);
    this.infoAttr.addUpdateRange(0, this.n * 3);
    this.posAttr.needsUpdate = true;
    this.infoAttr.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.n);
  }

  get count(): number {
    return this.n;
  }
}
