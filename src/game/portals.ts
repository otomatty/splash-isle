import * as THREE from 'three';
import type { Area, AreaKey, PortalDef } from '../world/area';
import { P_INK, P_SPARK, type Particles } from './particles';

type PortalState = 'sealed' | 'gooped' | 'open';

interface Portal {
  def: PortalDef;
  state: PortalState;
  hp: number;
  group: THREE.Group;
  disc: THREE.Mesh;
  sealed: THREE.Mesh;
  blob: THREE.Group;
  /** 壁の手前（飛びこむ判定の中心） */
  front: THREE.Vector3;
  cooldown: number;
}

/** 入口のしるし（眠っている状態）に描く、しずくと渦の紋 */
function emblemTexture(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#5d6672';
  c.beginPath(); c.arc(128, 128, 126, 0, 7); c.fill();
  c.strokeStyle = '#3f4650';
  c.lineWidth = 9;
  c.beginPath(); c.arc(128, 128, 104, 0, 7); c.stroke();
  // しずく
  c.beginPath();
  c.moveTo(128, 44);
  c.bezierCurveTo(178, 110, 196, 138, 196, 162);
  c.arc(128, 162, 68, 0, Math.PI);
  c.bezierCurveTo(60, 138, 78, 110, 128, 44);
  c.stroke();
  // 渦
  c.beginPath();
  for (let i = 0; i <= 90; i++) {
    const a = i * 0.14, r = 4 + i * 0.5;
    const x = 128 + Math.cos(a) * r, y = 160 + Math.sin(a) * r;
    if (i === 0) c.moveTo(x, y);
    else c.lineTo(x, y);
  }
  c.lineWidth = 7;
  c.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * 町にある、ほかのエリアへの入口。
 * ヒカリ石が規定数たまると建物がスミのかたまりに覆われ、水で洗い流すと壁のしるしが光って入口になる。
 */
export class Portals {
  readonly root = new THREE.Group();
  readonly list: Portal[] = [];
  private readonly time = { value: 0 };
  /** スミを洗い流して入口がひらいたとき */
  onOpen: ((p: PortalDef) => void) | null = null;
  onHit: (() => void) | null = null;

  constructor(area: Area, private readonly particles: Particles) {
    const frameGeo = new THREE.TorusGeometry(2.25, 0.24, 8, 36);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x9c907e, roughness: 0.9 });
    const discGeo = new THREE.CircleGeometry(2.1, 40);
    const sealedMat = new THREE.MeshStandardMaterial({ map: emblemTexture(), roughness: 0.85 });
    const openMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.time },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          float a = atan(p.y, p.x);
          // 水色と金色がらせんを描いて中心へ吸いこまれていく
          float sw = sin(a * 3.0 + r * 9.0 - uTime * 3.2);
          float sw2 = sin(a * 5.0 - r * 14.0 + uTime * 2.1);
          vec3 col = mix(vec3(0.05, 0.62, 0.95), vec3(1.0, 0.86, 0.32), 0.5 + 0.5 * sw);
          col = mix(col, vec3(0.55, 0.95, 1.0), 0.25 + 0.25 * sw2);
          col = mix(col, vec3(1.0), smoothstep(0.42, 0.0, r));
          col += vec3(1.0, 0.95, 0.7) * smoothstep(0.84, 0.97, r) * 0.8;
          col *= 0.95;
          float alpha = smoothstep(1.0, 0.94, r);
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const blobMat = new THREE.MeshStandardMaterial({ color: 0x2c0f42, roughness: 0.12, metalness: 0.1, emissive: 0x3a0f5a, emissiveIntensity: 0.25 });
    const blobGeo = new THREE.SphereGeometry(1, 16, 12);

    for (const def of area.portals) {
      const group = new THREE.Group();
      group.position.copy(def.pos);
      group.rotation.y = def.yaw;
      const frame = new THREE.Mesh(frameGeo, frameMat);
      frame.castShadow = true;
      const sealed = new THREE.Mesh(discGeo, sealedMat);
      sealed.position.z = 0.02;
      const disc = new THREE.Mesh(discGeo, openMat);
      disc.position.z = 0.05;
      disc.renderOrder = 6;
      // スミのかたまり: 大小の球を寄せ集める
      const blob = new THREE.Group();
      const lumps: [number, number, number, number][] = [[0, -0.2, 0.7, 1.9], [-1.5, -0.9, 0.6, 1.25], [1.6, -0.7, 0.5, 1.35], [-0.9, 1.3, 0.5, 1.1], [1.1, 1.4, 0.4, 0.95], [0.1, 2.2, 0.3, 0.7], [-2.2, 0.6, 0.3, 0.75], [2.3, 0.7, 0.3, 0.7], [0, -1.9, 0.9, 1.3]];
      for (const [x, y, z, s] of lumps) {
        const m = new THREE.Mesh(blobGeo, blobMat);
        m.position.set(x, y, z);
        m.scale.setScalar(s);
        m.castShadow = true;
        blob.add(m);
      }
      group.add(frame, sealed, disc, blob);
      this.root.add(group);
      const front = def.pos.clone().add(new THREE.Vector3(Math.sin(def.yaw) * 0.9, -1.4, Math.cos(def.yaw) * 0.9));
      this.list.push({ def, state: 'sealed', hp: 1, group, disc, sealed, blob, front, cooldown: 0 });
    }
  }

  /**
   * ヒカリ石の数とセーブデータから状態を決める。
   * @returns 今回あたらしくスミに覆われた入口
   */
  sync(gemCount: number, openMask: number): PortalDef[] {
    const appeared: PortalDef[] = [];
    for (const p of this.list) {
      const next: PortalState = openMask & (1 << p.def.index) ? 'open' : gemCount >= p.def.unlock ? 'gooped' : 'sealed';
      if (next === 'gooped' && p.state === 'sealed') appeared.push(p.def);
      if (next !== p.state && next === 'gooped') p.hp = 1;
      p.state = next;
      this.show(p);
    }
    return appeared;
  }

  private show(p: Portal): void {
    p.disc.visible = p.state === 'open';
    p.sealed.visible = p.state !== 'open';
    p.blob.visible = p.state === 'gooped';
  }

  /** 状態を強制的に指定する（起動時の同期用。お知らせは出さない） */
  reset(): void {
    for (const p of this.list) {
      p.state = 'sealed';
      p.cooldown = 0;
      this.show(p);
    }
  }

  get gooped(): PortalDef | null {
    return this.list.find((p) => p.state === 'gooped')?.def ?? null;
  }
  get nextOpen(): PortalDef[] {
    return this.list.filter((p) => p.state === 'open').map((p) => p.def);
  }

  /** 入口から出てきた直後など、しばらく反応させない */
  hold(area: AreaKey, seconds: number): void {
    const p = this.list.find((q) => q.def.area === area);
    if (p) p.cooldown = seconds;
  }

  /** 入口の正面（出てくる位置）と向き */
  exitPoint(area: AreaKey, out: THREE.Vector3): number {
    const p = this.list.find((q) => q.def.area === area);
    if (!p) return 0;
    out.set(p.def.pos.x + Math.sin(p.def.yaw) * 4.2, p.def.pos.y - 2.6, p.def.pos.z + Math.cos(p.def.yaw) * 4.2);
    return p.def.yaw;
  }

  /** 噴射した水がスミのかたまりに当たったか */
  hitTest(x: number, y: number, z: number): boolean {
    for (const p of this.list) {
      if (p.state !== 'gooped') continue;
      const c = p.front;
      const dx = x - c.x, dy = y - (c.y + 1.4), dz = z - c.z;
      const r = 1.6 + 1.9 * p.hp;
      if (dx * dx + dy * dy + dz * dz < r * r) {
        p.hp -= 0.0032;
        this.onHit?.();
        if (Math.random() < 0.25) this.particles.spawn(P_INK, x, y, z, (Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4, 0.5, 0.18);
        if (p.hp <= 0) {
          p.state = 'open';
          p.cooldown = 3.2;
          this.show(p);
          this.particles.burst(P_INK, c.x, c.y + 1.4, c.z, 50, 7, 6, 0.9, 0.24);
          this.particles.burst(P_SPARK, c.x, c.y + 1.4, c.z, 50, 6, 5, 1.2, 0.3);
          this.onOpen?.(p.def);
        }
        return true;
      }
    }
    return false;
  }

  /** @returns プレイヤーが飛びこんだ入口（なければ null） */
  update(dt: number, t: number, px: number, py: number, pz: number, canEnter: boolean): PortalDef | null {
    this.time.value = t;
    let entered: PortalDef | null = null;
    for (const p of this.list) {
      if (p.cooldown > 0) p.cooldown -= dt;
      if (p.state === 'gooped') {
        const s = (0.4 + 0.6 * Math.max(0, p.hp)) * 1.35;
        p.blob.scale.set(s * (1 + Math.sin(t * 2.3) * 0.03), s * (1 + Math.sin(t * 3.1 + 1) * 0.04), s);
        if (Math.random() < dt * 3) this.particles.spawn(P_INK, p.front.x + (Math.random() - 0.5) * 3, p.front.y + 3 + Math.random(), p.front.z + (Math.random() - 0.5) * 1.5, 0, 0.5, 0, 0.8, 0.16);
      } else if (p.state === 'open') {
        if (Math.random() < dt * 9) this.particles.spawn(P_SPARK, p.def.pos.x + (Math.random() - 0.5) * 3.6, p.def.pos.y + (Math.random() - 0.5) * 3.6, p.def.pos.z + (Math.random() - 0.5) * 0.8, 0, 0.7, 0, 0.8, 0.2);
        if (canEnter && p.cooldown <= 0) {
          const dx = px - p.front.x, dz = pz - p.front.z, dy = py - p.front.y;
          if (dx * dx + dz * dz < 2.3 && dy > -1.2 && dy < 3.4) entered = p.def;
        }
      }
    }
    return entered;
  }
}
