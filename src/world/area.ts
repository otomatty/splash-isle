import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GRASS_DISTANCE, GeoBatch, M, addSway, box, buildBushGeometry, buildGrassTuftGeometry, buildPalmGeometry, buildRockGeometry, cone, cyl, sph } from './props';
import { Colliders, slideAlongBoundary, type Body, type Box } from './colliders';
import { heightAt, normalAt, pathDistance, type TerrainDef } from './terrain';
import { Goop } from './goop';
import { mulberry32 } from '../engine/noise';
import { P_JET, P_MIST, P_SPLASH, type Particles } from '../game/particles';
import type { Player } from '../game/player';

export type AreaKey = 'town' | 'volcano' | 'lagoon' | 'plateau';

export interface Mover {
  mesh: THREE.Object3D;
  box: Box;
  bx: number; by: number; bz: number;
  ax: number; ay: number; az: number;
  speed: number;
  phase: number;
}

export interface NpcSpec {
  x: number; z: number; yaw: number;
  name: string;
  lines: string[];
  body: number; belly: number; hat: number;
}

export type MissionKind = 'reach' | 'clean' | 'defeat' | 'collect';

/** ステージ（ヒカリ石1個ぶんの目標） */
export interface MissionDef {
  /** 全体で通しのヒカリ石番号 */
  gem: number;
  title: string;
  hint: string;
  kind: MissionKind;
}

export interface GemDef {
  id: number;
  pos: THREE.Vector3;
  /** 条件を満たすまで隠れているか */
  hidden: boolean;
}

/** 水を補給できる場所（噴水・温泉など） */
export interface PoolDef { x: number; z: number; r: number; y: number }
/** 間欠泉: 乗っていると噴き上げられる */
export interface Launcher { x: number; z: number; y: number; r: number; power: number; period: number; phase: number }
export interface EnemySpawn { pos: THREE.Vector3; big?: boolean }
/** 別エリアへの入口（町にだけある） */
export interface PortalDef { area: AreaKey; index: number; pos: THREE.Vector3; yaw: number; unlock: number; label: string }

/** エリアごとの空と光 */
export interface Look {
  sun: [number, number, number];
  sunColor: number;
  zenith: number;
  horizon: number;
  sunIntensity: number;
  hemi: number;
  fog: number;
}

export const WALLS = [0xf6efe0, 0xf5deb0, 0xf2c39c, 0xcfe2ee, 0xf1c4c6, 0xd2ead8];
export const TERRACOTTA = 0xc45f38;
export const BLUE = 0x2a66ad;
export const TEAL = 0x1f8f8c;
export const WOOD = 0x8a5f38;
export const WOOD_DARK = 0x5e3f24;
export const STONE = 0xb2a089;
export const FLAG_COLORS = [0xe8483f, 0xf6c443, 0x22a6a0, 0xfaf6ea, 0xf08a2e, 0x3a78c8];

export const mul = (a: THREE.Matrix4, b: THREE.Matrix4) => a.clone().multiply(b);

// エリアをまたいで使い回す重いジオメトリ（破棄しない）
const shared = <T extends THREE.BufferGeometry>(g: T): T => { g.userData.shared = true; return g; };
let palmGeo: THREE.BufferGeometry | null = null;
let bushGeo: THREE.BufferGeometry | null = null;
let farPalmGeo: THREE.BufferGeometry | null = null;
let farBushGeo: THREE.BufferGeometry | null = null;
let tuftGeo: THREE.BufferGeometry | null = null;
const rockGeos = new Map<number, THREE.BufferGeometry>();
const rockGeo = (seed: number) => {
  let g = rockGeos.get(seed);
  if (!g) rockGeos.set(seed, (g = shared(buildRockGeometry(seed))));
  return g;
};

export interface ScatterOpts {
  radius: number;
  palms: number;
  bushes: number;
  grass: number;
  flowers: number;
  shoreRocks: number;
  /** true を返す場所には何も生やさない */
  avoid: (x: number, z: number) => boolean;
  palmH: [number, number];
  grassFrom: number;
  /** 岩を散らす丘 */
  hills?: { x: number; z: number; r0: number; r1: number; count: number }[];
  /** 岩を置かない海岸の角度範囲（度） */
  clearShore?: [number, number];
  seed?: number;
}

/**
 * エリア（町や各ステージ）の土台。建物・足場・植物などの部品と、
 * 当たり判定・収集物・敵の配置といったデータをまとめて持つ。
 */
export abstract class Area {
  abstract readonly key: AreaKey;
  abstract readonly name: string;
  abstract readonly look: Look;
  readonly root = new THREE.Group();
  readonly colliders = new Colliders();
  goop = new Goop(0, 0);
  readonly movers: Mover[] = [];
  readonly shells: THREE.Vector3[] = [];
  /** セーブデータ上の貝がら番号の先頭（エリアごとに重ならないようにする） */
  shellBase = 0;
  readonly starfish: THREE.Vector3[] = [];
  /** 水を満タンにしてくれる「しずく玉」の位置 */
  readonly refills: THREE.Vector3[] = [];
  readonly gems: GemDef[] = [];
  readonly missions: MissionDef[] = [];
  readonly enemySpawns: EnemySpawn[] = [];
  /** 敵が追いかけてくる範囲 */
  enemyLeash = { x: 0, z: 0, r: 30 };
  readonly npcs: NpcSpec[] = [];
  readonly pools: PoolDef[] = [];
  readonly launchers: Launcher[] = [];
  readonly portals: PortalDef[] = [];
  readonly spawn = new THREE.Vector3();
  spawnYaw = Math.PI;
  readonly swayTime = { value: 0 };
  /** 低品質設定で省略できる飾り */
  readonly detailMeshes: THREE.Object3D[] = [];
  /** 波でゆれる小舟など */
  protected readonly bobbers: THREE.Object3D[] = [];

  protected readonly matte = new GeoBatch();
  protected readonly gloss = new GeoBatch();
  protected readonly glow = new GeoBatch();
  protected readonly flags: THREE.BufferGeometry[] = [];
  protected rnd = mulberry32(20261120);
  protected roofs: THREE.Vector3[] = [];

  /** このエリアの地形（エリアを作る前に Terrain.apply で焼き込んでおく） */
  abstract readonly terrain: TerrainDef;

  /** 海中・陸上・空中に共通する移動範囲。エリアの切り替えは入口から行う。 */
  confinePlayer(b: Body, radius = this.terrain.world / 2 - 20): void {
    const distance = Math.hypot(b.x, b.z);
    if (distance + b.radius > radius) slideAlongBoundary(b, b.x / distance, b.z / distance, radius);
  }

  /** 使い終わったエリアの GPU リソースを解放する */
  dispose(): void {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m instanceof THREE.InstancedMesh) m.dispose();
      if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) {
        const map = (mat as THREE.MeshStandardMaterial).map;
        if (map) map.dispose();
        mat.dispose();
      }
    });
    this.goop.tex.dispose();
  }

  // ───────────────────────── 足場・水場などの部品 ─────────────────────────
  /** 宙に浮くカラフルな足場。move を指定すると往復して動く */
  protected floatBlock(x: number, y: number, z: number, s: number, color: number, move: { ax?: number; ay?: number; az?: number; sp?: number } = {}, phase = 0): Box {
    const gb = new GeoBatch();
    const th = 0.7;
    gb.add(box(s, th, s), color, M(0, -th / 2, 0), { ao: 0.8 });
    gb.add(box(s - 0.5, 0.06, s - 0.5), 0xfaf6ea, M(0, 0.02, 0));
    gb.add(box(s - 1.1, 0.07, s - 1.1), color, M(0, 0.03, 0));
    gb.add(box(s + 0.08, 0.16, s + 0.08), 0xfaf6ea, M(0, -th / 2, 0));
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) gb.add(sph(0.14, 8, 6), 0xe8b93c, M(sx * (s / 2 - 0.22), 0.04, sz * (s / 2 - 0.22)));
    gb.add(cone(s * 0.32, 1.0, 4).rotateX(Math.PI), 0x8be9f0, M(0, -th - 0.5, 0, Math.PI / 4), { top: 0x2aa8c8 });
    const mesh = new THREE.Mesh(gb.build(), this.matMatte);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.position.set(x, y, z);
    this.root.add(mesh);
    const bx = this.colliders.addBox(x, y - th / 2, z, s, th, s);
    this.movers.push({ mesh, box: bx, bx: x, by: y, bz: z, ax: move.ax ?? 0, ay: move.ay ?? 0.12, az: move.az ?? 0, speed: move.sp ?? 0.7, phase });
    return bx;
  }

  /** 2点を結ぶ板の橋。高さが違うときは階段状になる */
  protected plankBridge(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width = 2.2): void {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    // 1枚目は出発点と同じ高さ、最後の1枚が到着点の高さ。1段の高低差は歩いて上がれる範囲に収める
    const n = Math.max(2, Math.ceil(len / 1.05), Math.ceil(Math.abs(by - ay) / 0.34) + 1);
    const yaw = Math.atan2(dx, dz);
    const step = len / n;
    const b = this.matte.setBase(new THREE.Matrix4());
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const x = ax + dx * t, z = az + dz * t, y = ay + (by - ay) * (i / (n - 1));
      const shade = [0x9c7446, 0x8a653c, 0xa87e50, 0x93703f][(i * 7) % 4];
      b.add(box(width, 0.16, step * 0.94), shade, M(x, y - 0.08, z, yaw), { jitter: 0.1 });
      this.colliders.addBox(x, y - 0.13, z, width, 0.26, step + 0.02, yaw);
      if (i % 3 === 0) {
        for (const s of [-1, 1]) {
          const px = x + Math.cos(yaw) * s * (width / 2 - 0.08), pz = z - Math.sin(yaw) * s * (width / 2 - 0.08);
          b.add(cyl(0.05, 0.05, 1.0, 6), WOOD_DARK, M(px, y + 0.5, pz));
        }
      }
    }
    // 手すりのロープ
    for (const s of [-1, 1]) {
      const ox = Math.cos(yaw) * s * (width / 2 - 0.08), oz = -Math.sin(yaw) * s * (width / 2 - 0.08);
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(ax + ox, ay + 1.0, az + oz),
        new THREE.Vector3((ax + bx) / 2 + ox, (ay + by) / 2 + 0.75, (az + bz) / 2 + oz),
        new THREE.Vector3(bx + ox, by + 1.0, bz + oz),
      ]);
      b.add(new THREE.TubeGeometry(curve, 12, 0.025, 4), 0x6b5a48);
    }
  }

  /** 水面の円盤（噴水・温泉・火口湖など）。refill が true なら入ると水を補給できる */
  protected waterDisc(x: number, y: number, z: number, r: number, color = 0x3fd0d8, refill = true): void {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.78 });
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 32), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    this.root.add(m);
    if (refill) this.pools.push({ x, z, r, y });
  }

  /** 間欠泉。周期的に噴き上がり、乗っていると高く打ち上げられる */
  protected geyser(x: number, z: number, power: number, period = 4, phase = 0): void {
    const y = heightAt(x, z);
    const b = this.matte.setBase(M(x, y, z));
    const ring = new THREE.TorusGeometry(1.15, 0.32, 6, 14).rotateX(Math.PI / 2);
    b.add(ring, 0x5a5048, M(0, 0.08, 0), { top: 0x8d8272, jitter: 0.3 });
    b.add(cyl(1.0, 1.0, 0.06, 14), 0x9fe6ee, M(0, 0.12, 0));
    this.launchers.push({ x, z, y: y + 0.15, r: 1.25, power, period, phase });
  }

  /** 噴水（中に入ると水を補給できる）。戻り値はてっぺんの座標 */
  protected fountain(x: number, z: number): THREE.Vector3 {
    const y = heightAt(x, z);
    const b = this.matte.setBase(M(x, y, z));
    const wall = new THREE.LatheGeometry(
      [[3.85, 0], [3.7, 0.12], [3.65, 0.62], [3.55, 0.74], [3.15, 0.74], [3.05, 0.62], [3.05, 0]].map(([r, h]) => new THREE.Vector2(r, h)),
      32,
    );
    b.add(wall, STONE, undefined, { ao: 0.7, top: 0xd9cbb4 });
    const segs = 14;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      this.colliders.addBox(x + Math.cos(a) * 3.38, y + 0.37, z + Math.sin(a) * 3.38, 0.62, 0.74, 1.62, -a);
    }
    b.add(cyl(0.5, 0.75, 1.5, 12), STONE, M(0, 0.75, 0), { ao: 0.7, top: 0xdccfb8 });
    b.add(new THREE.LatheGeometry([[0.4, 0], [1.25, 0.28], [1.45, 0.5], [1.3, 0.5], [0.5, 0.2]].map(([r, h]) => new THREE.Vector2(r, h)), 20), 0xd3c5ad, M(0, 1.45, 0));
    b.add(cyl(0.26, 0.4, 1.1, 10), STONE, M(0, 2.3, 0), { top: 0xdccfb8 });
    b.add(new THREE.LatheGeometry([[0.2, 0], [0.7, 0.18], [0.8, 0.34], [0.7, 0.34], [0.25, 0.14]].map(([r, h]) => new THREE.Vector2(r, h)), 16), 0xd3c5ad, M(0, 2.75, 0));
    this.gloss.setBase(M(x, y, z)).add(sph(0.2, 10, 8), 0xe8b93c, M(0, 3.2, 0));
    this.colliders.addCyl(x, z, y, y + 1.5, 0.75);
    this.colliders.addCyl(x, z, y + 1.5, y + 1.95, 1.4);
    this.colliders.addCyl(x, z, y + 1.95, y + 3.1, 0.45);
    this.waterDisc(x, y + 0.56, z, 3.1);
    this.waterDisc(x, y + 1.9, z, 1.32, 0x3fd0d8, false);
    this.waterDisc(x, y + 3.04, z, 0.72, 0x3fd0d8, false);
    this.fountainTops.push(new THREE.Vector3(x, y + 3.35, z));
    return this.fountainTops[this.fountainTops.length - 1];
  }
  /** 噴水のてっぺん（水しぶきを出す位置） */
  readonly fountainTops: THREE.Vector3[] = [];

  /** 岩の柱（てっぺんが平らな足場）。戻り値は上面の高さ */
  protected rockPillar(x: number, z: number, r: number, top: number, grass = true): number {
    const base = Math.min(heightAt(x, z), 0) - 3;
    const H = top - base;
    const g = cyl(r, r * 1.28, H, 14, Math.max(4, Math.round(H / 1.5)));
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const yy = p.getY(i);
      if (Math.abs(yy - H / 2) < 0.01) continue; // 上面は平らなまま
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const k = 1 + 0.13 * Math.sin(a * 3 + yy * 0.7 + x) + 0.08 * Math.sin(a * 7 - yy * 1.9) + 0.05 * Math.sin(yy * 4.0 + z);
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    const b = this.matte.setBase(M(x, 0, z));
    b.add(g, 0x6e6258, M(0, base + H / 2, 0), { top: 0xb9aa94, ao: 0.6, jitter: 0.3 });
    if (grass) b.add(cyl(r * 0.99, r * 1.02, 0.3, 14), 0x4f9a2e, M(0, top - 0.13, 0), { top: 0x74b834 });
    this.colliders.addCyl(x, z, base, top, r * 0.99);
    return top;
  }

  /** 家を1軒建てる。戻り値は屋上中央の座標 */
  protected buildHouse(x: number, z: number, yaw: number, w: number, d: number, h: number, wall: number, accent: number, dome: boolean, stairs: boolean, awning: boolean, garden: boolean, idx: number): THREE.Vector3 {
    const g = 0.5; // ローカル座標での地面の高さ（基礎を少し埋める）
    const y0 = heightAt(x, z) - g;
    const H = h + g;
    const base = M(x, y0, z, yaw);
    const b = this.matte.setBase(base);
    const gl = this.gloss.setBase(base);
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const toWorld = (lx: number, lz: number): [number, number] => [x + lx * cos + lz * sin, z - lx * sin + lz * cos];
    const trim = 0xfbf7ee;

    const floors = h >= 8 ? 3 : 2;
    // 広場の屋根・外階段は足場。外形の高さを保ち、短い家は上階の天井高を詰める。
    const firstCeiling = Math.max(2.55, h / floors);
    const upperHeight = (h - firstCeiling) / (floors - 1);
    b.add(box(w, firstCeiling + g, d), wall, M(0, (firstCeiling + g) / 2, 0), { ao: 0.72 });
    const upperWall = new THREE.Color(wall).lerp(new THREE.Color(trim), 0.24);
    for (let storey = 1; storey < floors; storey++) {
      const sill = g + firstCeiling + (storey - 1) * upperHeight;
      b.add(box(w + 0.06, upperHeight, d + 0.06), upperWall, M(0, sill + upperHeight / 2, 0), { ao: 0.89 });
      b.add(box(w + 0.24, 0.14, d + 0.24), trim, M(0, sill, 0));
    }
    b.add(box(w + 0.22, 0.95, d + 0.22), 0xa39078, M(0, 0.475, 0), { ao: 0.75 });
    b.add(box(w + 0.26, 0.14, d + 0.26), accent, M(0, H - 0.32, 0));
    // 屋上の立ち上がり
    const ph = 0.35, pt = 0.3;
    b.add(box(w + 0.12, ph, pt), trim, M(0, H + ph / 2, d / 2 - pt / 2 + 0.06));
    b.add(box(w + 0.12, ph, pt), trim, M(0, H + ph / 2, -d / 2 + pt / 2 - 0.06));
    b.add(box(pt, ph, d - pt), trim, M(w / 2 - pt / 2 + 0.06, H + ph / 2, 0));
    b.add(box(pt, ph, d - pt), trim, M(-w / 2 + pt / 2 - 0.06, H + ph / 2, 0));
    b.add(box(w - 0.5, 0.04, d - 0.5), 0xd9c7a8, M(0, H + 0.02, 0)); // 屋上の床

    this.colliders.addBox(x, y0 + H / 2, z, w, H, d, yaw);
    const topY = y0 + H;
    for (const [lx, lz, sx, sz] of [[0, d / 2 - pt / 2, w, pt], [0, -d / 2 + pt / 2, w, pt], [w / 2 - pt / 2, 0, pt, d], [-w / 2 + pt / 2, 0, pt, d]]) {
      const [wx, wz] = toWorld(lx, lz);
      this.colliders.addBox(wx, topY + ph / 2, wz, sx, ph, sz, yaw);
    }

    // 玄関
    b.add(box(1.6, 2.5, 0.2), trim, M(0, g + 1.25, d / 2 + 0.02));
    b.add(box(1.2, 2.2, 0.24), accent, M(0, g + 1.1, d / 2 + 0.04), { ao: 0.8 });
    b.add(box(1.0, 0.06, 0.26), 0xffffff, M(0, g + 1.5, d / 2 + 0.045));
    gl.add(sph(0.07, 8, 6), 0xe8b93c, M(0.42, g + 1.05, d / 2 + 0.2));
    b.add(box(2.0, 0.22, 0.8), STONE, M(0, g + 0.02, d / 2 + 0.4));
    if (awning) {
      const col2 = 0xfaf6ea;
      for (let i = 0; i < 6; i++) {
        b.add(box(0.4, 0.06, 1.3), i % 2 ? col2 : accent, M(-1.0 + i * 0.4, g + 2.95, d / 2 + 0.6, 0, 1, 1, 1, 0.38));
      }
      b.add(cyl(0.035, 0.035, 0.9, 6), 0x444444, M(-1.15, g + 2.5, d / 2 + 1.05, 0, 1, 1, 1, 0.5));
      b.add(cyl(0.035, 0.035, 0.9, 6), 0x444444, M(1.15, g + 2.5, d / 2 + 1.05, 0, 1, 1, 1, 0.5));
    }

    // 窓
    const face = (f: 'f' | 'b' | 'l' | 'r', u: number, y: number): THREE.Matrix4 => {
      if (f === 'f') return M(u, y, d / 2);
      if (f === 'b') return M(-u, y, -d / 2, Math.PI);
      if (f === 'r') return M(w / 2, y, -u, Math.PI / 2);
      return M(-w / 2, y, u, -Math.PI / 2);
    };
    const flowerCols = [0xe8483f, 0xf6c443, 0xf08ab0, 0xffffff, 0xb05ad8];
    const win = (f: 'f' | 'b' | 'l' | 'r', u: number, y: number) => {
      const m = face(f, u, y);
      b.add(box(1.02, 1.36, 0.14), trim, mul(m, M(0, 0, 0.02)));
      gl.add(box(0.8, 1.14, 0.16), 0x1c3b55, mul(m, M(0, 0, 0.03)));
      b.add(box(0.05, 1.14, 0.18), trim, mul(m, M(0, 0, 0.03)));
      b.add(box(0.8, 0.05, 0.18), trim, mul(m, M(0, 0.1, 0.03)));
      b.add(box(0.4, 1.24, 0.07), accent, mul(m, M(-0.74, 0, 0.07)), { ao: 0.85 });
      b.add(box(0.4, 1.24, 0.07), accent, mul(m, M(0.74, 0, 0.07)), { ao: 0.85 });
      b.add(box(1.3, 0.09, 0.3), STONE, mul(m, M(0, -0.74, 0.12)));
    };
    const groundWindowY = g + 1.75;
    if (w >= 7) {
      win('f', -w / 2 + 1.5, groundWindowY);
      win('f', w / 2 - 1.5, groundWindowY);
    }
    win('l', 0, groundWindowY);
    win('r', stairs ? -d / 2 + 1.4 : 0, groundWindowY + (stairs ? 0.4 : 0));
    win('b', w >= 8 ? -1.8 : 0, groundWindowY);
    if (w >= 8) win('b', 1.8, groundWindowY);

    // 上階の窓は鎧戸・ガラス・桟にまとめ、遠くからも階が読み取れるようにする。
    const tall = Math.min(1.25, upperHeight * 0.6);
    for (let storey = 1; storey < floors; storey++) {
      const y = g + firstCeiling + (storey - 0.5) * upperHeight;
      const upstairs = (side: 'f' | 'b' | 'l' | 'r', u: number) => {
        const frame = face(side, u, y);
        b.add(box(1.44, tall + 0.10, 0.08), accent, mul(frame, M(0, 0, 0.055)));
        gl.add(box(0.84, tall, 0.08), 0x274c60, mul(frame, M(0, 0, 0.11)));
        b.add(box(0.85, 0.065, 0.055), trim, mul(frame, M(0, 0.17, 0.16)));
      };
      for (const side of ['f', 'b'] as const) {
        upstairs(side, -w * 0.25);
        upstairs(side, w * 0.25);
      }
      upstairs('l', 0);
      upstairs('r', stairs ? -d / 2 + 1.4 : 0);
    }

    if (dome) {
      const r = Math.min(w, d) * 0.3;
      b.add(cyl(r * 1.08, r * 1.12, 0.45, 20), trim, M(0, H + 0.22, 0));
      gl.add(new THREE.SphereGeometry(r, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), BLUE, M(0, H + 0.42, 0), { top: 0x4f95dc });
      gl.add(sph(0.12, 8, 6), 0xe8b93c, M(0, H + 0.42 + r + 0.08, 0));
      this.colliders.addCyl(x, z, topY, topY + 0.45, r * 1.1);
      this.colliders.addCyl(x, z, topY + 0.45, topY + 0.45 + r * 0.72, r * 0.78);
      this.colliders.addCyl(x, z, topY + 0.45 + r * 0.72, topY + 0.42 + r, r * 0.35);
    }
    if (garden) {
      const spots: [number, number][] = [[-w / 2 + 0.9, -d / 2 + 0.9], [w / 2 - 0.9, -d / 2 + 0.9], [-w / 2 + 0.9, d / 2 - 0.9]];
      spots.forEach(([lx, lz], i) => {
        b.add(cyl(0.34, 0.25, 0.5, 10), TERRACOTTA, M(lx, H + 0.25, lz), { ao: 0.8 });
        b.add(sph(0.42, 8, 6), 0x2c7a24, M(lx, H + 0.78, lz), { top: 0x6cba34, ao: 0.6 });
        if (i !== 1) b.add(sph(0.1, 6, 4), flowerCols[(i + idx) % 5], M(lx + 0.2, H + 1.08, lz + 0.1));
        const [wx, wz] = toWorld(lx, lz);
        this.colliders.addCyl(wx, wz, topY, topY + 0.55, 0.36);
      });
    }
    if (stairs) {
      // 外階段（右側面に沿って屋上へ）
      const n = Math.ceil(h / 0.38);
      const rise = h / n, run = 0.46, sw = 1.25;
      for (let i = 0; i < n; i++) {
        const sh = (i + 1) * rise;
        const lz = d / 2 - 0.2 - i * run - run / 2; // 広場側が一番下の段
        const lx = w / 2 + sw / 2;
        b.add(box(sw, sh + g, run), i % 2 ? 0xf1e7d2 : 0xe4d7bd, M(lx, (sh + g) / 2, lz), { ao: 0.8 });
        b.add(box(sw + 0.04, 0.07, run + 0.03), accent, M(lx, sh + g - 0.03, lz));
        const [wx, wz] = toWorld(lx, lz);
        this.colliders.addBox(wx, y0 + (sh + g) / 2, wz, sw, sh + g, run, yaw);
      }
    }
    return new THREE.Vector3(x, topY, z);
  }

  protected crate(x: number, y: number, z: number, s: number, yaw: number): void {
    const b = this.matte.setBase(M(x, y, z, yaw));
    b.add(box(s, s, s), 0xb07c44, M(0, s / 2, 0), { ao: 0.75, jitter: 0.12 });
    const t = 0.09 * s;
    for (const sy of [t / 2, s - t / 2]) {
      b.add(box(s + 0.04, t, t), WOOD_DARK, M(0, sy, s / 2));
      b.add(box(s + 0.04, t, t), WOOD_DARK, M(0, sy, -s / 2));
      b.add(box(t, t, s + 0.04), WOOD_DARK, M(s / 2, sy, 0));
      b.add(box(t, t, s + 0.04), WOOD_DARK, M(-s / 2, sy, 0));
    }
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.add(box(t, s, t), WOOD_DARK, M((sx * s) / 2, s / 2, (sz * s) / 2));
    this.colliders.addBox(x, y + s / 2, z, s, s, s, yaw);
  }

  protected barrel(x: number, y: number, z: number): void {
    const b = this.matte.setBase(M(x, y, z));
    const prof = [[0.36, 0], [0.45, 0.3], [0.47, 0.55], [0.45, 0.8], [0.36, 1.1], [0, 1.1]].map(([r, h]) => new THREE.Vector2(r, h));
    b.add(new THREE.LatheGeometry(prof, 12), 0x9a6a3a, undefined, { ao: 0.7, jitter: 0.15 });
    b.add(cyl(0.43, 0.43, 0.06, 12, 1, true), 0x55585c, M(0, 0.25, 0));
    b.add(cyl(0.43, 0.43, 0.06, 12, 1, true), 0x55585c, M(0, 0.85, 0));
    this.colliders.addCyl(x, z, y, y + 1.1, 0.46);
  }

  protected bench(x: number, z: number, yaw: number): void {
    const y = heightAt(x, z);
    const b = this.matte.setBase(M(x, y, z, yaw));
    b.add(box(1.8, 0.08, 0.5), WOOD, M(0, 0.48, 0), { jitter: 0.1 });
    b.add(box(1.8, 0.45, 0.07), WOOD, M(0, 0.82, -0.24, 0, 1, 1, 1, -0.15));
    for (const sx of [-0.75, 0.75]) b.add(box(0.1, 0.48, 0.46), 0x3c3f44, M(sx, 0.24, 0));
    this.colliders.addBox(x, y + 0.26, z, 1.8, 0.52, 0.5, yaw);
  }

  protected lampPost(x: number, z: number): void {
    const y = heightAt(x, z);
    const b = this.matte.setBase(M(x, y, z));
    b.add(cyl(0.16, 0.22, 0.4, 8), 0x2f3338, M(0, 0.2, 0));
    b.add(cyl(0.06, 0.08, 3.2, 8), 0x2f3338, M(0, 1.9, 0));
    b.add(box(0.5, 0.05, 0.5), 0x2f3338, M(0, 3.5, 0));
    b.add(cone(0.36, 0.3, 4), 0x2f3338, M(0, 4.05, 0, Math.PI / 4));
    this.glow.setBase(M(x, y, z)).add(box(0.34, 0.4, 0.34), 0xfff0c0, M(0, 3.72, 0));
    this.colliders.addCyl(x, z, y, y + 3.5, 0.14);
  }

  /** 屋台（テーブル＋縞の日よけ。日よけの上にも乗れる） */
  protected stall(x: number, z: number, yaw: number, color: number): void {
    const y = heightAt(x, z);
    const base = M(x, y, z, yaw);
    const b = this.matte.setBase(base);
    b.add(box(2.6, 0.12, 1.1), WOOD, M(0, 1.0, 0), { jitter: 0.1 });
    b.add(box(2.5, 0.9, 1.0), 0xf3ead6, M(0, 0.5, 0), { ao: 0.7 });
    for (const [sx, sz] of [[-1.3, -0.6], [1.3, -0.6], [-1.3, 0.6], [1.3, 0.6]]) b.add(cyl(0.05, 0.05, 2.5, 6), WOOD_DARK, M(sx, 1.25, sz));
    for (let i = 0; i < 7; i++) b.add(box(0.4, 0.07, 1.7), i % 2 ? 0xfaf6ea : color, M(-1.2 + i * 0.4, 2.55, 0));
    for (let i = 0; i < 7; i++) b.add(box(0.4, 0.3, 0.05), i % 2 ? 0xfaf6ea : color, M(-1.2 + i * 0.4, 2.38, 0.85));
    // 果物
    const fruit = [0xf08a2e, 0xf6c443, 0xd8322e, 0x4f9a2e];
    for (let i = 0; i < 12; i++) {
      const fx = -1.0 + (i % 6) * 0.4, fz = -0.2 + Math.floor(i / 6) * 0.4;
      this.gloss.setBase(base).add(sph(0.14, 8, 6), fruit[(i * 7 + Math.floor(x)) & 3], M(fx, 1.2, fz));
    }
    this.colliders.addBox(x, y + 0.53, z, 2.6, 1.06, 1.1, yaw);
    this.colliders.addBox(x, y + 2.52, z, 2.8, 0.14, 1.7, yaw);
    this.stallTops.push(new THREE.Vector3(x, y + 2.6, z));
  }
  protected readonly stallTops: THREE.Vector3[] = [];

  /** 2点の間にたるんだ紐と三角旗を張る */
  protected pennants(a: THREE.Vector3, c: THREE.Vector3, sag: number): void {
    const len = a.distanceTo(c);
    const n = Math.max(6, Math.floor(len / 0.75));
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = new THREE.Vector3().lerpVectors(a, c, t);
      p.y -= sag * 4 * t * (1 - t);
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    this.matte.setBase(new THREE.Matrix4()).add(new THREE.TubeGeometry(curve, n * 2, 0.018, 4), 0x5a4a3a);
    const pos: number[] = [], col: number[] = [];
    const cc = new THREE.Color();
    const off = Math.abs(Math.floor(a.x * 3 + c.z * 5));
    for (let i = 1; i < n; i++) {
      const p = pts[i];
      const d = new THREE.Vector3().subVectors(pts[i + 1], pts[i - 1]).normalize().multiplyScalar(0.22);
      cc.set(FLAG_COLORS[(i + off) % FLAG_COLORS.length]);
      pos.push(p.x - d.x, p.y - d.y, p.z - d.z, p.x + d.x, p.y + d.y, p.z + d.z, p.x, p.y - 0.5, p.z);
      for (let k = 0; k < 3; k++) col.push(cc.r, cc.g, cc.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    this.flags.push(g);
  }

  /** 中心から角度 a の方向で、地面の高さが target になる地点 */
  protected shorePoint(a: number, target: number, out = new THREE.Vector3(), maxR = 240): THREE.Vector3 {
    let r = 30;
    while (r < maxR && heightAt(Math.cos(a) * r, Math.sin(a) * r) > target) r += 0.25;
    return out.set(Math.cos(a) * r, heightAt(Math.cos(a) * r, Math.sin(a) * r), Math.sin(a) * r);
  }

  // ───────────────────────── まとめて1つのメッシュに ─────────────────────────
  readonly matMatte = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
  protected readonly matGloss = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.16, metalness: 0.05 });
  protected readonly matGlow = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, emissive: 0xffd98a, emissiveIntensity: 2.2 });

  private readonly matFlags = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });

  /** ここまでに積んだ建物・小物を1つのメッシュにまとめる（何度呼んでもよい） */
  protected finishStatic(): void {
    const add = (batch: GeoBatch, mat: THREE.Material, shadow: boolean) => {
      if (batch.empty) return;
      const m = new THREE.Mesh(batch.build(), mat);
      m.castShadow = shadow;
      m.receiveShadow = true;
      this.root.add(m);
    };
    add(this.matte, this.matMatte, true);
    add(this.gloss, this.matGloss, true);
    add(this.glow, this.matGlow, false);
    if (this.flags.length) {
      const g = mergeGeometries(this.flags, false)!;
      for (const f of this.flags) f.dispose();
      this.flags.length = 0;
      const m = new THREE.Mesh(g, this.matFlags);
      m.castShadow = true;
      m.receiveShadow = true;
      this.root.add(m);
    }
  }


  /** 低品質設定で影を落とさなくするもの（ヤシ・低木） */
  readonly softShadow: THREE.Object3D[] = [];
  private readonly trees: { mesh: THREE.InstancedMesh; near: THREE.BufferGeometry; far: THREE.BufferGeometry }[] = [];
  private readonly grass: THREE.InstancedMesh[] = [];

  updateVegetation(camera: THREE.Vector3, showGrass: boolean): void {
    for (const { mesh, near, far } of this.trees) {
      const distance = mesh.boundingBox!.distanceToPoint(camera);
      mesh.geometry = distance < (mesh.geometry === near ? 48 : 40) ? near : far;
    }
    for (const mesh of this.grass) {
      mesh.visible = showGrass && mesh.boundingBox!.distanceToPoint(camera) <= GRASS_DISTANCE + 1;
    }
  }

  /**
   * 同じ形をたくさん並べる。地面を区画に分けて区画ごとのインスタンスメッシュにするので、
   * 画面や影の範囲に入らない区画はまとめて描画を省ける。
   */
  protected addInstanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], opts: { shadow: boolean; soft?: boolean; detail?: boolean; far?: THREE.BufferGeometry; colors?: THREE.Color[]; cell?: number }): void {
    const cell = opts.cell ?? 56;
    const groups = new Map<string, number[]>();
    mats.forEach((m, i) => {
      const k = `${Math.floor(m.elements[12] / cell)},${Math.floor(m.elements[14] / cell)}`;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push(i);
    });
    for (const idx of groups.values()) {
      const mesh = new THREE.InstancedMesh(geo, mat, idx.length);
      idx.forEach((i, j) => {
        mesh.setMatrixAt(j, mats[i]);
        if (opts.colors) mesh.setColorAt(j, opts.colors[i]);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = opts.shadow;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.root.add(mesh);
      if (opts.far || opts.detail) mesh.computeBoundingBox();
      if (opts.far) this.trees.push({ mesh, near: geo, far: opts.far });
      if (opts.detail) {
        this.detailMeshes.push(mesh);
        this.grass.push(mesh);
      }
      if (opts.soft) this.softShadow.push(mesh);
    }
  }

  // ───────────────────────── 植物と岩 ─────────────────────────
  protected scatter(o: ScatterOpts): void {
    const rnd = mulberry32(o.seed ?? 99);
    const nrm = new THREE.Vector3();
    const dummy = new THREE.Object3D();

    // ヤシの木
    if (o.palms > 0) {
      const palmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide });
      addSway(palmMat, this.swayTime, 0.0052, 1);
      palmGeo ??= shared(buildPalmGeometry());
      farPalmGeo ??= shared(buildPalmGeometry(true));
      const palms: THREE.Matrix4[] = [];
      let guard = 0;
      while (palms.length < o.palms && guard++ < 12000) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * o.radius;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const h = heightAt(x, z);
        if (h < o.palmH[0] || h > o.palmH[1]) continue;
        if (normalAt(x, z, nrm).y < 0.86) continue;
        if (pathDistance(x, z) < 2.2 || o.avoid(x, z) || this.colliders.pointInside(x, h + 1, z, 2.2)) continue;
        let ok = true;
        for (const m of palms) {
          const e = m.elements;
          if (Math.hypot(e[12] - x, e[14] - z) < 4.2) { ok = false; break; }
        }
        if (!ok) continue;
        const s = 0.8 + rnd() * 0.55;
        dummy.position.set(x, h - 0.15, z);
        dummy.rotation.set((rnd() - 0.5) * 0.12, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.12);
        dummy.scale.set(s, s * (0.9 + rnd() * 0.3), s);
        dummy.updateMatrix();
        palms.push(dummy.matrix.clone());
        this.colliders.addCyl(x, z, h - 1, h + 5.2 * s, 0.3 * s);
      }
      this.addInstanced(palmGeo, palmMat, palms, { shadow: true, soft: true, far: farPalmGeo });
    }

    // 低木
    if (o.bushes > 0) {
      const bushMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
      addSway(bushMat, this.swayTime, 0.03, 1);
      bushGeo ??= shared(buildBushGeometry());
      farBushGeo ??= shared(buildBushGeometry(true));
      const bushes: THREE.Matrix4[] = [];
      let guard = 0;
      while (bushes.length < o.bushes && guard++ < 14000) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * o.radius;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const h = heightAt(x, z);
        if (h < o.grassFrom || normalAt(x, z, nrm).y < 0.8) continue;
        if (pathDistance(x, z) < 1.6 || o.avoid(x, z) || this.colliders.pointInside(x, h + 0.6, z, 1.6)) continue;
        const s = 0.6 + rnd() * 0.65;
        dummy.position.set(x, h - 0.1, z);
        dummy.rotation.set(0, rnd() * 6.28, 0);
        dummy.scale.set(s * (0.9 + rnd() * 0.5), s, s * (0.9 + rnd() * 0.5));
        dummy.updateMatrix();
        bushes.push(dummy.matrix.clone());
      }
      this.addInstanced(bushGeo, bushMat, bushes, { shadow: true, soft: true, far: farBushGeo });
    }

    // 草むらと花
    if (o.grass > 0) {
      const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
      addSway(grassMat, this.swayTime, 0.5, 1, true);
      tuftGeo ??= shared(buildGrassTuftGeometry());
      const flowerMat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
      addSway(flowerMat, this.swayTime, 0.5, 1, true);
      const flowerGeo = new THREE.IcosahedronGeometry(0.06, 0);
      flowerGeo.scale(1, 0.7, 1);
      flowerGeo.translate(0, 0.24, 0);
      const fc = [0xffffff, 0xf6c443, 0xf08ab0, 0xe8483f, 0xb98cf0, 0xffe9a8].map((c) => new THREE.Color(c));
      const tufts: THREE.Matrix4[] = [], blooms: THREE.Matrix4[] = [], bloomCols: THREE.Color[] = [];
      let guard = 0;
      const fRate = o.flowers / o.grass;
      while (tufts.length < o.grass && guard++ < o.grass * 8) {
        const x = (rnd() * 2 - 1) * o.radius, z = (rnd() * 2 - 1) * o.radius;
        const h = heightAt(x, z);
        if (h < o.grassFrom + 0.3 || normalAt(x, z, nrm).y < 0.8) continue;
        if (pathDistance(x, z) < 0.7 || o.avoid(x, z)) continue;
        const s = 0.8 + rnd() * 0.9;
        dummy.position.set(x, h - 0.02, z);
        dummy.rotation.set(0, rnd() * 6.28, 0);
        dummy.scale.set(s, s * (0.8 + rnd() * 0.6), s);
        dummy.updateMatrix();
        tufts.push(dummy.matrix.clone());
        if (blooms.length < o.flowers && rnd() < fRate) {
          dummy.scale.setScalar(0.7 + rnd() * 0.7);
          dummy.position.set(x + 0.1, h - 0.05, z + 0.1);
          dummy.updateMatrix();
          blooms.push(dummy.matrix.clone());
          bloomCols.push(fc[Math.floor(rnd() * fc.length)]);
        }
      }
      this.addInstanced(tuftGeo, grassMat, tufts, { shadow: false, detail: true });
      this.addInstanced(flowerGeo, flowerMat, blooms, { shadow: false, detail: true, colors: bloomCols });
    }

    // 岩（海岸線と丘の斜面）
    const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true });
    const addRocks = (seed: number, mats: THREE.Matrix4[]) => this.addInstanced(rockGeo(seed), rockMat, mats, { shadow: true, cell: 112 });
    const place = (x: number, z: number, s: number, mats: THREE.Matrix4[]) => {
      const h = heightAt(x, z);
      dummy.position.set(x, h + 0.1 * s, z);
      dummy.rotation.set(0, rnd() * 6.28, 0);
      dummy.scale.set(s * (0.8 + rnd() * 0.5), s * (0.7 + rnd() * 0.6), s * (0.8 + rnd() * 0.5));
      dummy.updateMatrix();
      mats.push(dummy.matrix.clone());
      this.colliders.addCyl(x, z, h - 1, h + 0.1 * s + 0.62 * dummy.scale.y, 0.78 * Math.min(dummy.scale.x, dummy.scale.z));
    };
    const shore: THREE.Matrix4[] = [];
    let guard = 0;
    while (shore.length < o.shoreRocks && guard++ < 4000) {
      const p = this.shorePoint(rnd() * Math.PI * 2, -0.4 + rnd() * 1.4, nrm, o.radius * 1.15);
      const x = p.x + (rnd() - 0.5) * 4, z = p.z + (rnd() - 0.5) * 4;
      const deg = ((Math.atan2(z, x) * 180) / Math.PI + 360) % 360;
      if (o.clearShore && deg > o.clearShore[0] && deg < o.clearShore[1]) continue;
      if (o.avoid(x, z) || pathDistance(x, z) < 3) continue;
      place(x, z, 0.7 + rnd() * 1.9, shore);
    }
    addRocks(3, shore);
    const hill: THREE.Matrix4[] = [];
    for (const hl of o.hills ?? []) {
      let n = 0;
      guard = 0;
      while (n < hl.count && guard++ < 2000) {
        const a = rnd() * Math.PI * 2, r = hl.r0 + rnd() * (hl.r1 - hl.r0);
        const x = hl.x + Math.cos(a) * r, z = hl.z + Math.sin(a) * r;
        if (pathDistance(x, z) < 2.5 || o.avoid(x, z) || heightAt(x, z) < 0.5) continue;
        place(x, z, 0.5 + rnd() * 1.2, hill);
        n++;
      }
    }
    addRocks(8, hill);
  }

  /** 岩を1つ置く（上に乗れる）。戻り値は上面の高さ */
  protected bigRock(x: number, z: number, s: number, seed = 21): number {
    const y = heightAt(x, z);
    const m = new THREE.Mesh(rockGeo(seed), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true }));
    m.position.set(x, y + 0.3, z);
    m.scale.set(s, s * 0.9, s);
    m.castShadow = m.receiveShadow = true;
    this.root.add(m);
    const top = y + 0.3 + 0.62 * s * 0.9;
    this.colliders.addCyl(x, z, y - 2, top, 0.8 * s);
    return top;
  }

  /** 建物などの下にあるスミを消して、洗える量を確定する */
  protected finalizeGoop(extra: [number, number, number][] = []): void {
    const groundMax = (x: number, z: number) => heightAt(x, z) + 1.2;
    for (const b of this.colliders.boxes) {
      if (b.cy - b.hy > groundMax(b.cx, b.cz)) continue;
      this.goop.eraseRect(b.cx, b.cz, b.hx, b.hz, b.cos, b.sin, 0.55);
    }
    for (const c of this.colliders.cyls) {
      if (c.y0 > groundMax(c.x, c.z)) continue;
      this.goop.eraseCircle(c.x, c.z, c.r + 0.55);
    }
    for (const [x, z, r] of extra) this.goop.eraseCircle(x, z, r);
    for (const n of this.npcs) this.goop.eraseCircle(n.x, n.z, 1.4);
    this.goop.eraseCircle(this.spawn.x, this.spawn.z, 2.2);
    this.goop.eraseWhere((x, z) => heightAt(x, z) < 0.6);
    this.goop.finalize();
  }

  /** スミだまりの中から敵の出現位置を選ぶ */
  protected pickEnemySpots(count: number, cx: number, cz: number, r0: number, r1: number, seed = 5): void {
    const rnd = mulberry32(seed);
    let guard = 0, n = 0;
    while (n < count && guard++ < 6000) {
      const a = rnd() * Math.PI * 2, r = r0 + rnd() * (r1 - r0);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const y = heightAt(x, z);
      if (y < 0.3 || this.colliders.pointInside(x, y + 0.5, z, 0.8)) continue;
      if (this.goop.initial > 0 && !this.goop.at(x, z)) continue;
      if (Math.hypot(x - this.spawn.x, z - this.spawn.z) < 7) continue;
      if (this.enemySpawns.some((p) => Math.hypot(p.pos.x - x, p.pos.z - z) < 4.5)) continue;
      this.enemySpawns.push({ pos: new THREE.Vector3(x, y, z) });
      n++;
    }
  }

  /** 動く足場とボートを進める（物理ステップごとに呼ぶ） */
  stepMovers(t: number): void {
    for (const m of this.movers) {
      const s = Math.sin(t * m.speed + m.phase);
      const nx = m.bx + m.ax * s, ny = m.by + m.ay * s, nz = m.bz + m.az * s;
      const b = m.box;
      const ty = ny - b.hy;
      b.dx = nx - b.cx; b.dy = ty - b.cy; b.dz = nz - b.cz;
      b.cx = nx; b.cy = ty; b.cz = nz;
      m.mesh.position.set(nx, ny, nz);
    }
  }

  /** 見た目だけのアニメーション（1フレームに1回） */
  update(t: number): void {
    this.swayTime.value = t;
    for (let i = 0; i < this.bobbers.length; i++) {
      const o = this.bobbers[i];
      o.position.y = (o.userData.baseY as number) + Math.sin(t * 1.1 + i) * 0.06;
      o.rotation.z = Math.sin(t * 0.9 + i) * 0.045;
      o.rotation.x = Math.sin(t * 0.7 + 1 + i) * 0.03;
    }
  }

  private fxAcc = 0;

  /** 噴水のしぶき・間欠泉の噴き上げなど、毎フレームの仕掛け */
  tick(t: number, dt: number, P: Particles, player: Player | null): void {
    this.fxAcc += dt * 26;
    const n = Math.floor(this.fxAcc);
    this.fxAcc -= n;
    for (const ft of this.fountainTops) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, sp = 0.5 + Math.random() * 1.1;
        P.spawn(P_SPLASH, ft.x, ft.y, ft.z, Math.cos(a) * sp, 3.4 + Math.random(), Math.sin(a) * sp, 0.95, 0.1 + Math.random() * 0.05);
      }
    }
    for (const g of this.launchers) {
      const ph = (t + g.phase) % g.period;
      const active = ph < 1.7;
      if (active) {
        // 噴き上げ中: 勢いよく水柱が立つ
        for (let i = 0; i < n + 1; i++) {
          const a = Math.random() * 6.283, r = Math.random() * 0.5;
          P.spawn(P_JET, g.x + Math.cos(a) * r, g.y + 0.2, g.z + Math.sin(a) * r, Math.cos(a) * 1.2, g.power * (0.55 + Math.random() * 0.4), Math.sin(a) * 1.2, 1.2, 0.2 + Math.random() * 0.14);
        }
        if (Math.random() < 0.5) P.spawn(P_MIST, g.x, g.y + 1 + Math.random() * 4, g.z, (Math.random() - 0.5) * 2, 5, (Math.random() - 0.5) * 2, 0.9, 1.2);
        if (player) {
          const b = player.body;
          if (Math.abs(b.y - g.y) < 0.9 && b.vy < g.power * 0.5 && Math.hypot(b.x - g.x, b.z - g.z) < g.r) player.launch(g.power);
        }
      } else if (ph > g.period - 1.0) {
        // 噴き上げの直前: ぶくぶくと予兆を出す
        if (Math.random() < 0.6) P.spawn(P_SPLASH, g.x + (Math.random() - 0.5) * 1.4, g.y + 0.1, g.z + (Math.random() - 0.5) * 1.4, 0, 2 + Math.random() * 2, 0, 0.4, 0.12);
      } else if (Math.random() < 0.06) {
        P.spawn(P_MIST, g.x, g.y + 0.4, g.z, 0, 1.4, 0, 1.2, 0.8);
      }
    }
  }
}
