import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Area } from '../world/area';
import { P_SPARK, P_SPLASH, type Particles } from './particles';

function shellGeometry(): THREE.BufferGeometry {
  // ホタテ形の貝がら: 扇形のグリッドを、放射状のうね・波打つ縁・ふくらみで形づくる（表裏2枚）
  const NA = 28, NR = 7, R = 0.36, SPREAD = 1.25;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let j = 0; j <= NR; j++) {
      const rho = j / NR;
      for (let i = 0; i <= NA; i++) {
        const u = i / NA;
        const th = (u - 0.5) * 2 * SPREAD;
        const rim = 1 + 0.06 * Math.abs(Math.cos(u * Math.PI * 8));
        const rr = rho * R * rim;
        const ridge = 0.5 + 0.5 * Math.cos(u * Math.PI * 16);
        const dome = Math.sin(Math.min(1, rho * 1.15) * Math.PI * 0.5) * (1 - rho * rho * 0.92);
        const z = side * (0.012 + 0.085 * dome * (0.72 + 0.28 * ridge));
        pos.push(Math.sin(th) * rr, Math.cos(th) * rr - R * 0.5, z);
      }
    }
    for (let j = 0; j < NR; j++) {
      for (let i = 0; i < NA; i++) {
        const a = base + j * (NA + 1) + i, b = a + 1, c = a + NA + 1, d = c + 1;
        if (side > 0) idx.push(a, b, c, b, d, c);
        else idx.push(a, c, b, b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // ちょうつがいの「耳」
  const ear = new THREE.BoxGeometry(0.2, 0.07, 0.03);
  ear.translate(0, -R * 0.5 + 0.005, 0);
  ear.deleteAttribute('uv');
  const merged = mergeGeometries([g.toNonIndexed(), ear.toNonIndexed()], false)!;
  return merged;
}

function starGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 0.4 : 0.17;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 3, curveSegments: 1 });
  g.translate(0, 0, -0.035);
  return g;
}

function glowTexture(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d')!;
  const gr = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,250,220,1)');
  gr.addColorStop(0.18, 'rgba(255,226,120,0.75)');
  gr.addColorStop(0.5, 'rgba(255,190,60,0.2)');
  gr.addColorStop(1, 'rgba(255,170,40,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Gem {
  id: number;
  group: THREE.Group;
  core: THREE.Mesh;
  orbit: THREE.Group;
  beam: THREE.Mesh;
  halo: THREE.Sprite;
  state: 'hidden' | 'appearing' | 'idle' | 'taken';
  t: number;
  base: THREE.Vector3;
}

/** 貝がら・ヒトデ・ヒカリ石の表示と取得判定 */
export class Collectibles {
  readonly root = new THREE.Group();
  private readonly shellMesh: THREE.InstancedMesh;
  private readonly starMesh: THREE.InstancedMesh;
  readonly shellTaken: boolean[];
  readonly starTaken: boolean[];
  private readonly shellAnim: Float32Array;
  private readonly starAnim: Float32Array;
  readonly gems: Gem[] = [];
  private readonly refillMesh: THREE.InstancedMesh;
  private readonly refillT: Float32Array;
  onRefill: (() => void) | null = null;
  private readonly dummy = new THREE.Object3D();
  onShell: ((index: number) => void) | null = null;
  onStar: ((index: number) => void) | null = null;
  onGem: ((id: number) => void) | null = null;

  constructor(private readonly level: Area, private readonly particles: Particles) {
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xffc233, metalness: 0.9, roughness: 0.24, emissive: 0x6a3c00, emissiveIntensity: 0.6 });
    this.shellMesh = new THREE.InstancedMesh(shellGeometry(), shellMat, Math.max(1, level.shells.length));
    this.shellMesh.count = level.shells.length;
    this.shellMesh.castShadow = true;
    this.shellMesh.frustumCulled = false;
    this.shellTaken = level.shells.map(() => false);
    this.shellAnim = new Float32Array(level.shells.length);

    const starMat = new THREE.MeshStandardMaterial({ color: 0xff5a4a, roughness: 0.45, emissive: 0xb01a10, emissiveIntensity: 0.55 });
    this.starMesh = new THREE.InstancedMesh(starGeometry(), starMat, Math.max(1, level.starfish.length));
    this.starMesh.count = level.starfish.length;
    this.starMesh.castShadow = true;
    this.starMesh.frustumCulled = false;
    this.starTaken = level.starfish.map(() => false);
    this.starAnim = new Float32Array(level.starfish.length);
    // しずく玉（取ると水が満タンになり、しばらくすると復活する）
    const dropGeo = new THREE.LatheGeometry(
      [[0, -0.3], [0.17, -0.26], [0.27, -0.12], [0.26, 0.02], [0.16, 0.2], [0.06, 0.36], [0, 0.44]].map(([r, h]) => new THREE.Vector2(r, h)),
      16,
    );
    const dropMat = new THREE.MeshStandardMaterial({ color: 0x58d4ff, roughness: 0.04, transparent: true, opacity: 0.8, emissive: 0x0b6fb0, emissiveIntensity: 0.7 });
    this.refillMesh = new THREE.InstancedMesh(dropGeo, dropMat, Math.max(1, level.refills.length));
    this.refillMesh.count = level.refills.length;
    this.refillMesh.frustumCulled = false;
    this.refillT = new Float32Array(level.refills.length);
    this.root.add(this.shellMesh, this.starMesh, this.refillMesh);

    // ヒカリ石
    const coreGeo = new THREE.OctahedronGeometry(0.42, 0);
    coreGeo.scale(1, 1.4, 1);
    const coreMat = new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xff9a0a, emissiveIntensity: 1.15, roughness: 0.1, metalness: 0.35, flatShading: true });
    const bitGeo = new THREE.OctahedronGeometry(0.09, 0);
    const bitMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x7fe9ff, emissiveIntensity: 3, flatShading: true });
    const haloTex = glowTexture();
    const beamGeo = new THREE.CylinderGeometry(0.9, 0.22, 46, 14, 1, true);
    beamGeo.translate(0, 23, 0);
    const beamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.time },
      vertexShader: /* glsl */ `
        varying float vH; varying vec3 vN; varying vec3 vV;
        void main() {
          vH = position.y / 46.0;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying float vH; varying vec3 vN; varying vec3 vV;
        void main() {
          float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
          float a = edge * (1.0 - vH) * (1.0 - vH) * (0.20 + 0.05 * sin(uTime * 3.0 + vH * 30.0));
          gl_FragColor = vec4(vec3(1.0, 0.85, 0.4) * a * 1.6, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    level.gems.forEach(({ id, pos }) => {
      const group = new THREE.Group();
      group.position.copy(pos);
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.castShadow = true;
      const orbit = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const b = new THREE.Mesh(bitGeo, bitMat);
        const a = (i / 4) * Math.PI * 2;
        b.position.set(Math.cos(a) * 0.85, Math.sin(a * 2) * 0.15, Math.sin(a) * 0.85);
        orbit.add(b);
      }
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.4 }));
      halo.scale.setScalar(3.0);
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.frustumCulled = false;
      beam.renderOrder = 7;
      group.add(core, orbit, halo, beam);
      group.visible = false;
      this.root.add(group);
      this.gems.push({ id, group, core, orbit, beam, halo, state: 'hidden', t: 0, base: pos.clone() });
    });
  }
  private readonly time = { value: 0 };

  /**
   * セーブデータの内容を反映する。
   * @param shells 取得済みの貝がら（全エリア通しの番号）
   * @param stars 取得済みのヒトデ（ビット列）
   * @param taken そのヒカリ石を取得済みとして隠すか
   * @param revealed そのヒカリ石が出現済みか
   */
  restore(shells: number[], stars: number, taken: (id: number) => boolean, revealed: (id: number) => boolean): void {
    this.shellTaken.fill(false);
    this.starTaken.fill(false);
    this.shellAnim.fill(0);
    this.starAnim.fill(0);
    const base = this.level.shellBase;
    for (const id of shells) {
      const i = id - base;
      if (i >= 0 && i < this.shellTaken.length) this.shellTaken[i] = true;
    }
    for (let i = 0; i < this.starTaken.length; i++) this.starTaken[i] = (stars & (1 << i)) !== 0;
    for (const g of this.gems) {
      const isTaken = taken(g.id);
      const shown = revealed(g.id);
      g.state = isTaken ? 'taken' : shown ? 'idle' : 'hidden';
      g.group.visible = g.state === 'idle';
      g.group.scale.setScalar(1);
      g.group.position.copy(g.base);
    }
  }

  get shellCount(): number {
    return this.shellTaken.reduce((n, v) => n + (v ? 1 : 0), 0);
  }
  get starCount(): number {
    return this.starTaken.reduce((n, v) => n + (v ? 1 : 0), 0);
  }
  get starBits(): number {
    return this.starTaken.reduce((n, v, i) => n | (v ? 1 << i : 0), 0);
  }
  /** このエリアで取得済みの貝がら（全エリア通しの番号） */
  get shellList(): number[] {
    const out: number[] = [];
    const base = this.level.shellBase;
    this.shellTaken.forEach((v, i) => v && out.push(base + i));
    return out;
  }

  private gem(id: number): Gem | undefined {
    return this.gems.find((g) => g.id === id);
  }

  /** ヒカリ石を出現させる（条件達成時） */
  reveal(id: number): void {
    const g = this.gem(id);
    if (!g || g.state !== 'hidden') return;
    g.state = 'appearing';
    g.t = 0;
    g.group.visible = true;
    g.group.scale.setScalar(0.01);
    this.particles.burst(P_SPARK, g.base.x, g.base.y, g.base.z, 40, 5, 4, 1.2, 0.3);
  }

  isRevealed(id: number): boolean {
    const g = this.gem(id);
    return !!g && g.state !== 'hidden';
  }

  gemPosition(id: number): THREE.Vector3 {
    return this.gem(id)?.base ?? this.level.spawn;
  }

  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) mat.dispose();
    });
  }

  update(dt: number, t: number, px: number, py: number, pz: number, canCollect: boolean): void {
    this.time.value = t;
    const d = this.dummy;
    const P = this.particles;
    const cy = py + 0.65;
    // 貝がら
    const shells = this.level.shells;
    for (let i = 0; i < shells.length; i++) {
      const s = shells[i];
      if (this.shellTaken[i]) {
        // 取った直後は上へ跳ねて消える
        const a = this.shellAnim[i];
        if (a > 0) {
          this.shellAnim[i] = Math.max(0, a - dt * 2.6);
          const k = 1 - a;
          d.position.set(s.x, s.y + k * 1.4, s.z);
          d.rotation.set(0, t * 18, 0);
          d.scale.setScalar(a * 1.2);
        } else {
          d.scale.setScalar(0);
        }
      } else {
        const dx = s.x - px, dy = s.y - cy, dz = s.z - pz;
        if (canCollect && dx * dx + dy * dy * 0.6 + dz * dz < 1.45) {
          this.shellTaken[i] = true;
          this.shellAnim[i] = 1;
          P.burst(P_SPARK, s.x, s.y, s.z, 8, 2.2, 2.2, 0.5, 0.22);
          this.onShell?.(i);
        }
        d.position.set(s.x, s.y + Math.sin(t * 2.4 + i * 1.7) * 0.12, s.z);
        d.rotation.set(0, t * 2.6 + i, 0);
        d.scale.setScalar(1);
      }
      d.updateMatrix();
      this.shellMesh.setMatrixAt(i, d.matrix);
    }
    this.shellMesh.instanceMatrix.needsUpdate = true;
    // ヒトデ
    const stars = this.level.starfish;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      if (this.starTaken[i]) {
        const a = this.starAnim[i];
        if (a > 0) {
          this.starAnim[i] = Math.max(0, a - dt * 1.8);
          d.position.set(s.x, s.y + (1 - a) * 2.2, s.z);
          d.rotation.set(0, t * 20, 0);
          d.scale.setScalar(a * 1.5);
        } else d.scale.setScalar(0);
      } else {
        const dx = s.x - px, dy = s.y - cy, dz = s.z - pz;
        if (canCollect && dx * dx + dy * dy * 0.6 + dz * dz < 1.7) {
          this.starTaken[i] = true;
          this.starAnim[i] = 1;
          P.burst(P_SPARK, s.x, s.y, s.z, 22, 3.5, 3.5, 0.8, 0.26);
          this.onStar?.(i);
        }
        d.position.set(s.x, s.y + 0.15 + Math.sin(t * 2 + i) * 0.1, s.z);
        d.rotation.set(Math.sin(t * 1.5 + i) * 0.2, t * 1.8 + i * 0.8, 0);
        d.scale.setScalar(1 + Math.sin(t * 4 + i) * 0.05);
        if (Math.random() < dt * 1.2) P.spawn(P_SPARK, s.x + (Math.random() - 0.5) * 0.9, s.y + Math.random() * 0.8, s.z + (Math.random() - 0.5) * 0.9, 0, 0.6, 0, 0.7, 0.16);
      }
      d.updateMatrix();
      this.starMesh.setMatrixAt(i, d.matrix);
    }
    this.starMesh.instanceMatrix.needsUpdate = true;
    // しずく玉
    const refills = this.level.refills;
    for (let i = 0; i < refills.length; i++) {
      const s = refills[i];
      let w = this.refillT[i];
      if (w > 0) {
        w = this.refillT[i] = Math.max(0, w - dt);
        d.scale.setScalar(w < 0.5 ? 1 - w * 2 : 0);
      } else {
        const dx = s.x - px, dy = s.y - cy, dz = s.z - pz;
        if (canCollect && dx * dx + dy * dy * 0.6 + dz * dz < 1.5) {
          this.refillT[i] = 9;
          P.burst(P_SPLASH, s.x, s.y, s.z, 16, 3, 3, 0.5, 0.14);
          this.onRefill?.();
        }
        d.scale.setScalar(1 + Math.sin(t * 5 + i) * 0.06);
      }
      d.position.set(s.x, s.y + Math.sin(t * 2.2 + i * 2) * 0.14, s.z);
      d.rotation.set(0, t * 1.5, 0);
      d.updateMatrix();
      this.refillMesh.setMatrixAt(i, d.matrix);
    }
    this.refillMesh.instanceMatrix.needsUpdate = true;
    // ヒカリ石
    for (const g of this.gems) {
      if (g.state === 'hidden' || g.state === 'taken') continue;
      g.t += dt;
      if (g.state === 'appearing') {
        const k = Math.min(1, g.t / 0.9);
        // 弾むように現れる
        const e = 1 - Math.pow(1 - k, 3);
        g.group.scale.setScalar(e * (1 + 0.25 * Math.sin(k * Math.PI)));
        if (k >= 1) g.state = 'idle';
      }
      g.group.position.y = g.base.y + Math.sin(t * 1.7 + g.id) * 0.16;
      g.core.rotation.y = t * 1.5 + g.id;
      g.orbit.rotation.y = -t * 2.2;
      g.orbit.rotation.z = Math.sin(t * 0.9) * 0.3;
      g.halo.scale.setScalar(2.9 + Math.sin(t * 3.1 + g.id) * 0.3);
      if (Math.random() < dt * 6) P.spawn(P_SPARK, g.base.x + (Math.random() - 0.5) * 1.6, g.base.y + (Math.random() - 0.5) * 1.6, g.base.z + (Math.random() - 0.5) * 1.6, 0, 0.8, 0, 0.8, 0.2);
      if (g.state === 'idle' && canCollect) {
        const dx = g.base.x - px, dy = g.group.position.y - cy, dz = g.base.z - pz;
        if (dx * dx + dy * dy + dz * dz < 1.9) {
          g.state = 'taken';
          g.group.visible = false;
          P.burst(P_SPARK, g.base.x, g.base.y, g.base.z, 60, 6, 5, 1.4, 0.34);
          this.onGem?.(g.id);
        }
      }
    }
  }
}
