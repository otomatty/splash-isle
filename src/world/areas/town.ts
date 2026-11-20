import * as THREE from 'three';
import { GeoBatch, M, box, cone, cyl, sph, textTexture } from '../props';
import { Area, BLUE, STONE, TEAL, TERRACOTTA, WALLS, WOOD, WOOD_DARK, mul, type AreaKey, type Look } from '../area';
import { DEEP, DEFAULT_PALETTE, heightAt, pavedDistance, type PathDef, type TerrainDef } from '../terrain';
import { beachShelf, buildSwimBeach, inBeachAccess } from './town-beach';
import { blockCourts, blockStreets, buildTownBlocks } from './town-blocks';
import { buildTownHorizon, mainlandHeight, TOWN_WORLD } from './town-horizon';
import { buildOutskirts, outskirtPaths } from './town-outskirts';
import { buildPostRow, inPostRow } from './town-post-row';
import { buildPostOffice, postRoad, postSquare } from './town-post-office';
import { buildTownMarket } from './town-market';
import { buildHarborYard, inHarborYard } from './town-harbor';
import { buildResidentialLane, residentialWalks } from './town-neighborhood';
import { slideAlongBoundary, type Body } from '../colliders';
import { Goop, scatterGoop } from '../goop';
import { fbm, lerp, mulberry32, sstep } from '../../engine/noise';

/** 町の主な場所 */
export const PLAZA = { x: 0, z: 0, r: 24, y: 4 };
export const WEST = { x: -64, z: 20, r: 15 }; // 時計塔広場
export const HARBOR = { x: 92, z: 0, r: 14 }; // 港
export const SOUTH = { x: 0, z: 84, r: 12 }; // 浜辺の入口
export const HILL = { x: -104, z: -74, y: 31 }; // 灯台の丘
export const ISLET = { x: 193, z: 42 }; // 沖の小島
const TOWN_R = 92;

function townHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const th = Math.atan2(z, x);
  const R = 150 + 14 * Math.sin(3 * th + 1.0) + 9 * Math.sin(5 * th + 2.3) + 6 * Math.sin(2 * th - 0.7);
  const inland = R - r;
  let h: number;
  if (inland >= 0) {
    const south = Math.max(0, Math.sin(th));
    const k = 22 + 18 * south; // 南側は遠浅で広い砂浜
    h = 5.2 * (1 - Math.exp(-inland / k));
    const m = sstep(6, 26, inland);
    h += m * (fbm(x * 0.03 + 10, z * 0.03 + 10, 4, 3) - 0.5) * 4.4;
    h += m * (fbm(x * 0.15, z * 0.15, 2, 9) - 0.5) * 0.5;
  } else {
    h = DEEP * (1 - Math.exp(inland / 24));
    h += (fbm(x * 0.05, z * 0.05, 3, 5) - 0.5) * 1.4 * sstep(0, -20, inland);
  }
  // 町は平らな台地の上
  h = lerp(h, PLAZA.y, sstep(TOWN_R + 20, TOWN_R, r));
  // 灯台の丘
  const dh = Math.hypot(x - HILL.x, z - HILL.z);
  h += 22 * sstep(44, 7, dh);
  h = lerp(h, HILL.y, sstep(10, 6, dh));
  // 沖の小島
  const di = Math.hypot(x - ISLET.x, z - ISLET.z);
  h = Math.max(h, 2.6 - ((di * di) / (15 * 15)) * 3.4);
  if (z < -104) h = Math.max(h, mainlandHeight(x, z));
  return beachShelf(x, z, h);
}

// 貝がらの位置と保存済みIDは、この順番の通りに対応する。
const shellStreets: PathDef[] = [
  { pts: [[24, 0], [92, 0]], width: 6.5 },
  { pts: [[0, 24], [0, 84]], width: 6.5 },
  { pts: [[-23, 7], [-64, 20]], width: 6 },
  { pts: [[-20, -14], [-58, -41]], width: 5.5 },
  { pts: [[92, 10], [72, 52], [12, 84]], width: 5 },
  { pts: [[-12, 84], [-52, 58], [-64, 34]], width: 5 },
];

const shellPaths: PathDef[] = [
  { pts: [[-58, -41], [-72, -52], [-86, -62], [-98, -70]], width: 2.2 }, // 灯台へ
  { pts: [[0, 96], [-3, 112], [2, 128]], width: 2.4 }, // 浜辺へ
  { pts: [[106, 0], [130, 1], [150, 0], [160, 0]], width: 2.6 }, // 桟橋へ
];

export const TOWN_TERRAIN: TerrainDef = {
  world: TOWN_WORLD,
  raw: townHeight,
  paths: [...shellPaths, ...blockCourts, ...outskirtPaths],
  streets: [
    ...shellStreets, postRoad, ...residentialWalks, ...blockStreets,
    { pts: [[106, 0], [106, -6.2], [121, -6.2]], width: 3 },
  ],
  plazas: [
    PLAZA, WEST, HARBOR, SOUTH, postSquare,
    { x: 27.5, z: -7, r: 5.1 }, { x: 26, z: 7.2, r: 4.6 }, // パン工房と陶器の荷車の店先
  ],
  palette: DEFAULT_PALETTE,
};

/** 拠点の町。5つのヒカリ石と、3つのエリアへの入口がある */
export class Town extends Area {
  readonly key: AreaKey = 'town';
  readonly name = 'ヒカリ島の町';
  readonly terrain = TOWN_TERRAIN;
  readonly look: Look = { sun: [0.48, 0.74, 0.47], sunColor: 0xfff2d6, zenith: 0x4c8be4, horizon: 0xc4e3fb, sunIntensity: 2.9, hemi: 0.55, fog: 0.0007 };
  readonly pierEnd = new THREE.Vector3();
  readonly lampTop = new THREE.Vector3();
  fountainTop = new THREE.Vector3();
  private readonly streetDetail = new GeoBatch();
  private readonly gemPos: THREE.Vector3[] = [];

  constructor() {
    super();
    this.spawn.set(PLAZA.x, PLAZA.y, PLAZA.z + 11);
    this.goop = new Goop(PLAZA.x, PLAZA.z);
    this.enemyLeash = { x: PLAZA.x, z: PLAZA.z, r: 24 };
    this.fountainTop = this.fountain(PLAZA.x, PLAZA.z);
    // 地区ごとに別メッシュへまとめる（画面や影の範囲に入らない地区は描画を省ける）
    this.buildVillage();
    this.finishStatic();
    this.buildStreets();
    this.buildLandmarks();
    this.finishStatic();
    buildHarborYard(this.matte, this.streetDetail, this.colliders);
    this.finishStatic();
    buildResidentialLane('south', this.matte, this.streetDetail, this.colliders);
    this.finishStatic();
    buildResidentialLane('hill', this.matte, this.streetDetail, this.colliders);
    this.finishStatic();
    buildPostOffice(this.matte, this.streetDetail, this.colliders);
    buildPostRow(this.matte, this.streetDetail, this.colliders);
    this.lampPost(-8.5, -50.5);
    this.lampPost(8.5, -50.5);
    this.bench(-5, -49.6, 0.2);
    this.bench(5, -49.6, -0.2);
    this.finishStatic();
    this.buildLighthouse();
    this.finishStatic();
    this.buildPier();
    this.buildCourse();
    this.finishStatic();
    this.buildBeach();
    this.buildSigns();
    this.finishStatic();
    buildTownBlocks(this.root, this.matMatte, this.colliders, this.terrain, this.detailMeshes);
    buildOutskirts(this.root, this.matMatte, this.colliders, this.detailMeshes, this.softShadow);
    this.root.add(buildTownHorizon());
    const hillD = (x: number, z: number) => Math.hypot(x - HILL.x, z - HILL.z);
    this.scatter({
      radius: 172, palms: 52, bushes: 80, grass: 3700, flowers: 370, shoreRocks: 44, seed: 20261120,
      avoid: (x, z) => inBeachAccess(x, z) || inPostRow(x, z) || inHarborYard(x, z) || pavedDistance(x, z) < 2.6
        || hillD(x, z) < 10 || (Math.abs(z) < 5 && x > 150) || Math.hypot(x - ISLET.x, z - ISLET.z) < 16,
      palmH: [1.3, 13], grassFrom: 2.6,
      hills: [{ x: HILL.x, z: HILL.z, r0: 12, r1: 40, count: 24 }],
      clearShore: [50, 135],
    });
    // ヒトデを乗せる北岸の大岩
    {
      const p = this.shorePoint((282 * Math.PI) / 180, 0.2);
      const top = this.bigRock(p.x, p.z, 2.6);
      this.starfish[7] = new THREE.Vector3(p.x, top + 0.5, p.z);
    }
    this.placeNpcs();
    this.placeGoop();
    this.placeCollectibles();
  }

  override confinePlayer(b: Body): void {
    // 桟橋のコース・沖の小島（約198m）を周りから泳いで回れる余裕を取る。
    super.confinePlayer(b, 219);
    // 北西は山麓で止め、北東は北岸の大岩まで開ける。境界線は z = -161 - x/4。
    slideAlongBoundary(b, -1 / Math.sqrt(17), -4 / Math.sqrt(17), 644 / Math.sqrt(17));
  }

  /** 店先の品物などは地区ごとにまとめ、低品質と水面の反射では省く。 */
  protected override finishStatic(): void {
    super.finishStatic();
    if (this.streetDetail.empty) return;
    const mesh = new THREE.Mesh(this.streetDetail.build(), this.matMatte);
    mesh.receiveShadow = true;
    this.root.add(mesh);
    this.detailMeshes.push(mesh);
  }

  // ───────────────────────── 村 ─────────────────────────
  protected buildVillage(): void {
    type H = { a: number; r: number; w: number; d: number; h: number; wall: number; accent: number; dome?: boolean; stairs?: boolean; awning?: boolean; garden?: boolean };
    const houses: H[] = [
      { a: 32, r: 20.5, w: 7, d: 6, h: 5.0, wall: 1, accent: TERRACOTTA, awning: true, garden: true },
      { a: 60, r: 21.5, w: 6, d: 6, h: 7.5, wall: 0, accent: BLUE, dome: true },
      { a: 120, r: 21.5, w: 8, d: 6, h: 4.4, wall: 2, accent: TEAL, stairs: true, garden: true },
      { a: 150, r: 20.5, w: 6, d: 6, h: 6.8, wall: 0, accent: BLUE, awning: true },
      { a: 183, r: 21.5, w: 7, d: 7, h: 5.2, wall: 3, accent: 0x274b7a, garden: true },
      { a: 248, r: 20.5, w: 6, d: 6, h: 8.6, wall: 0, accent: BLUE, dome: true },
      { a: 281, r: 21.5, w: 9, d: 6, h: 4.4, wall: 1, accent: TERRACOTTA, stairs: true },
      { a: 316, r: 20.5, w: 6, d: 7, h: 6.4, wall: 4, accent: TEAL, awning: true, garden: true },
    ];
    const roofs: THREE.Vector3[] = [];
    houses.forEach((h, idx) => {
      const ang = (h.a * Math.PI) / 180;
      const x = PLAZA.x + Math.cos(ang) * h.r, z = PLAZA.z + Math.sin(ang) * h.r;
      const yaw = Math.atan2(PLAZA.x - x, PLAZA.z - z);
      roofs.push(this.buildHouse(x, z, yaw, h.w, h.d, h.h, WALLS[h.wall], h.accent, !!h.dome, !!h.stairs, !!h.awning, !!h.garden, idx));
    });
    // 屋根の上の貝がら
    for (const r of roofs) this.shells.push(r.clone().add(new THREE.Vector3(1.4, 0.9, 1.2)));
    this.roofs = roofs;

    // 7番目の家の屋根に木箱を積んで、となりの塔へ登れるようにする
    const r7 = roofs[6], r6 = roofs[5];
    const dir = new THREE.Vector3().subVectors(r6, r7).setY(0).normalize();
    const cb = new THREE.Vector3(r7.x + dir.x * 3.2, r7.y, r7.z + dir.z * 3.2);
    this.crate(cb.x, cb.y, cb.z, 1.3, 0.3);
    this.crate(cb.x + dir.x * 0.1, cb.y + 1.3, cb.z + dir.z * 0.1, 1.1, 0.9);
    this.crate(cb.x - dir.x * 1.5, cb.y, cb.z - dir.z * 1.5 + 0.2, 1.2, 0.1);

    // 広場の屋台・木箱・街灯
    this.stallTops.push(...buildTownMarket(this.matte, this.streetDetail, this.colliders));
    const py = PLAZA.y;
    this.crate(PLAZA.x + 13.2, py, PLAZA.z + 3.5, 1.2, 0.4);
    this.crate(PLAZA.x + 14.5, py, PLAZA.z + 4.2, 1.0, 1.1);
    this.crate(PLAZA.x + 13.6, py + 1.2, PLAZA.z + 3.8, 0.9, 0.7);
    this.barrel(PLAZA.x - 13, py, PLAZA.z - 6);
    this.barrel(PLAZA.x - 14.1, py, PLAZA.z - 5.3);
    this.barrel(PLAZA.x + 4, py, PLAZA.z + 16.5);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      this.lampPost(PLAZA.x + Math.cos(a) * 11.5, PLAZA.z + Math.sin(a) * 11.5);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + 0.25;
      this.bench(PLAZA.x + Math.cos(a) * 6.6, PLAZA.z + Math.sin(a) * 6.6, -a + Math.PI / 2);
    }

    // 万国旗: 噴水のてっぺんから四方の屋根へ、となり合う屋根どうしにも
    const top = this.fountainTop.clone().add(new THREE.Vector3(0, 0.1, 0));
    for (const i of [1, 3, 5, 7]) this.pennants(top, roofs[i].clone().add(new THREE.Vector3(0, 0.5, 0)), 1.6);
    for (const [i, j] of [[0, 1], [2, 3], [3, 4], [5, 6], [6, 7]] as const) {
      this.pennants(roofs[i].clone().add(new THREE.Vector3(0, 0.6, 0)), roofs[j].clone().add(new THREE.Vector3(0, 0.6, 0)), 1.0);
    }
  }
  protected roofs: THREE.Vector3[] = [];

  // ───────────────────────── 灯台 ─────────────────────────
  protected buildLighthouse(): void {
    const x = HILL.x, z = HILL.z, y = heightAt(HILL.x, HILL.z);
    const TH = 16, R = 2.6;
    const b = this.matte.setBase(M(x, y, z));
    const gl = this.gloss.setBase(M(x, y, z));
    const rAt = (h: number) => R + 0.5 * (1 - h / TH);
    b.add(cyl(R + 1.2, R + 1.5, 0.9, 24), STONE, M(0, 0.2, 0), { ao: 0.75 });
    b.add(cyl(R, R + 0.5, TH, 28, 1), 0xfaf6ec, M(0, TH / 2, 0), { ao: 0.82 });
    for (const [h0, h1] of [[4.2, 6.6], [10.2, 12.4]]) {
      b.add(cyl(rAt(h1) + 0.03, rAt(h0) + 0.03, h1 - h0, 28, 1, true), TEAL, M(0, (h0 + h1) / 2, 0));
    }
    // 入口（広場側）
    const da = Math.atan2(PLAZA.z - z, PLAZA.x - x);
    const dyaw = Math.atan2(Math.cos(da), Math.sin(da));
    const dm = M(Math.cos(da) * (R + 0.42), 0, Math.sin(da) * (R + 0.42), dyaw);
    b.add(box(1.7, 2.7, 0.3), 0xe9dfca, mul(dm, M(0, 1.6, 0)));
    b.add(box(1.2, 2.3, 0.34), TEAL, mul(dm, M(0, 1.5, 0.02)), { ao: 0.8 });
    gl.add(sph(0.07, 8, 6), 0xe8b93c, mul(dm, M(0.4, 1.5, 0.22)));
    // 小窓
    for (let i = 0; i < 4; i++) {
      const a = da + 1.2 + i * 1.6, hh = 3 + i * 3.2;
      const wm = M(Math.cos(a) * rAt(hh), hh, Math.sin(a) * rAt(hh), Math.atan2(Math.cos(a), Math.sin(a)));
      b.add(box(0.7, 1.0, 0.16), 0xe9dfca, wm);
      gl.add(box(0.5, 0.8, 0.2), 0x1c3b55, wm);
    }
    // 回廊
    b.add(cyl(4.3, R + 0.1, 1.1, 24, 1), 0xe9dfca, M(0, TH - 0.55, 0), { ao: 0.7 });
    b.add(cyl(4.35, 4.35, 0.4, 28), 0x3a4047, M(0, TH + 0.2, 0));
    b.add(new THREE.TorusGeometry(4.2, 0.05, 6, 40).rotateX(Math.PI / 2), 0x2f3338, M(0, TH + 1.35, 0));
    b.add(new THREE.TorusGeometry(4.2, 0.035, 6, 40).rotateX(Math.PI / 2), 0x2f3338, M(0, TH + 0.9, 0));
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      b.add(cyl(0.04, 0.04, 0.95, 6), 0x2f3338, M(Math.cos(a) * 4.2, TH + 0.87, Math.sin(a) * 4.2));
    }
    // 灯室
    b.add(cyl(1.85, 1.85, 0.5, 16), 0xfaf6ec, M(0, TH + 0.65, 0));
    gl.add(cyl(1.6, 1.6, 2.2, 16, 1, true), 0x9fd8e8, M(0, TH + 2.0, 0));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.add(box(0.1, 2.2, 0.1), 0x2f3338, M(Math.cos(a) * 1.62, TH + 2.0, Math.sin(a) * 1.62, -a));
    }
    this.glow.setBase(M(x, y, z)).add(sph(0.75, 12, 10), 0xfff2b0, M(0, TH + 2.0, 0));
    b.add(cyl(2.0, 2.0, 0.22, 16), 0x3a4047, M(0, TH + 3.2, 0));
    gl.add(cone(2.15, 1.7, 16), TEAL, M(0, TH + 4.15, 0), { top: 0x35b5b0 });
    gl.add(sph(0.22, 10, 8), 0xe8b93c, M(0, TH + 5.1, 0));
    this.lampTop.set(x, y + TH + 2.0, z);

    this.colliders.addCyl(x, z, y - 2, y + TH, R + 0.28);
    this.colliders.addCyl(x, z, y - 2, y + 0.65, R + 1.3);
    this.colliders.addCyl(x, z, y + TH, y + TH + 0.4, 4.35);
    this.colliders.addCyl(x, z, y + TH + 0.4, y + TH + 3.3, 1.9);

    // らせん状の足場
    const n = 11;
    const rise = (TH - 0.9) / n;
    let a = da + 0.55;
    for (let i = 0; i < n; i++) {
      const top = (i + 1) * rise;
      // 最後の2段は回廊のひさしより外へ張り出させ、外側から回廊へ飛び移れるようにする
      const rc = rAt(top) + 1.05 + (i === n - 1 ? 2.0 : i === n - 2 ? 0.9 : 0);
      const sx = x + Math.cos(a) * rc, sz = z + Math.sin(a) * rc;
      const sm = M(Math.cos(a) * rc, top, Math.sin(a) * rc, -a);
      b.add(box(1.8, 0.16, 1.55), WOOD, mul(sm, M(0, -0.08, 0)), { jitter: 0.12 });
      b.add(box(1.84, 0.1, 0.1), WOOD_DARK, mul(sm, M(0, -0.2, 0.6)));
      b.add(box(1.84, 0.1, 0.1), WOOD_DARK, mul(sm, M(0, -0.2, -0.6)));
      if (i < n - 2) b.add(box(1.5, 0.1, 0.1), 0x2f3338, mul(sm, M(-0.5, -0.62, 0, 0, 1, 1, 1, 0, -0.72)));
      else b.add(box(rc - rAt(top) + 0.9, 0.12, 0.14), 0x2f3338, mul(sm, M(-(rc - rAt(top)) / 2 - 0.2, -0.24, 0)));
      this.colliders.addBox(sx, y + top - 0.13, sz, 1.8, 0.26, 1.55, -a);
      if (i % 2 === 1) this.shells.push(new THREE.Vector3(sx, y + top + 0.9, sz));
      if (i === 5) this.refills.push(new THREE.Vector3(sx + Math.cos(a) * 0.5, y + top + 1.0, sz + Math.sin(a) * 0.5));
      a += i >= 5 ? 0.86 : 0.64;
    }
    // ヒカリ石は回廊の、最後の足場とは反対側に置く
    this.gemPos[1] = new THREE.Vector3(x + Math.cos(a + 2.4) * 3.2, y + TH + 1.7, z + Math.sin(a + 2.4) * 3.2);
  }

  // ───────────────────────── 桟橋とボート ─────────────────────────
  protected buildPier(): void {
    let x0 = 120;
    while (x0 < 210 && heightAt(x0, 0) > 1.25) x0 += 0.25;
    // 桟橋の先端が、沖の小島へ続く足場コースの起点にくる長さにする
    const top = 1.5, len = Math.max(28, Math.round(ISLET.x + 6.5 - x0));
    const b = this.matte.setBase(M(x0, 0, 0));
    for (let i = 0; i < len; i++) {
      const shade = [0x9c7446, 0x8a653c, 0xa87e50, 0x93703f][(i * 7) % 4];
      b.add(box(0.93, 0.13, 3.3), shade, M(-1.5 + i + 0.5, top - 0.065, 0), { jitter: 0.1 });
    }
    b.add(box(len, 0.22, 0.2), WOOD_DARK, M(len / 2 - 1.5, top - 0.24, 1.35));
    b.add(box(len, 0.22, 0.2), WOOD_DARK, M(len / 2 - 1.5, top - 0.24, -1.35));
    for (let i = 0; i <= Math.floor((len - 3) / 5.5); i++) {
      for (const s of [-1, 1]) {
        const px = 1 + i * 5.5;
        b.add(cyl(0.17, 0.2, 10.5, 8), 0x6b4a2c, M(px, top - 4.65, s * 1.62), { top: 0x8a653c });
        b.add(cyl(0.21, 0.21, 0.1, 8), 0xd8d2c4, M(px, top + 0.62, s * 1.62));
        this.colliders.addCyl(x0 + px, s * 1.62, -8, top + 0.66, 0.2);
      }
    }
    this.colliders.addBox(x0 + len / 2 - 1.5, top - 0.17, 0, len, 0.34, 3.3);
    this.pierEnd.set(x0 + len - 1.5, top, 0);
    // 先端のランタン
    for (const s of [-1, 1]) {
      b.add(cyl(0.05, 0.05, 1.6, 6), 0x2f3338, M(len - 2.0, top + 1.4, s * 1.62));
      this.glow.setBase(M(x0, 0, 0)).add(sph(0.2, 8, 6), 0xfff0c0, M(len - 2.0, top + 2.3, s * 1.62));
    }
    for (let i = 0; i < 5; i++) this.shells.push(new THREE.Vector3(x0 + 6 + i * 7, top + 0.9, 0));

    // 小舟（波でゆれる）
    const boat = new GeoBatch();
    const hull = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    hull.scale(2.6, 0.95, 1.05);
    boat.add(hull, 0xd8322e, undefined, { top: 0xfaf6ea });
    boat.add(box(4.3, 0.08, 1.7), 0xb8905a, M(0, -0.22, 0), { jitter: 0.1 });
    boat.add(box(0.3, 0.07, 1.9), WOOD, M(-0.9, -0.02, 0));
    boat.add(box(0.3, 0.07, 1.9), WOOD, M(0.9, -0.02, 0));
    boat.add(new THREE.TorusGeometry(1, 0.06, 6, 32).rotateX(Math.PI / 2).scale(2.6, 1, 1.05), 0x274b7a);
    const mesh = new THREE.Mesh(boat.build(), this.matMatte);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.position.set(x0 + 19, 0.42, 4.6);
    mesh.userData.baseY = 0.42;
    this.root.add(mesh);
    this.bobbers.push(mesh);
    this.colliders.addBox(x0 + 19, 0.05, 4.6, 4.4, 0.35, 1.7);
    this.starfish[5] = new THREE.Vector3(x0 + 19, 1.25, 4.6);
  }

  // ───────────────────────── 沖の浮きブロックコース ─────────────────────────
  protected buildCourse(): void {
    const ex = this.pierEnd.x;
    const defs: { x: number; y: number; z: number; s: number; c: number; ax?: number; ay?: number; az?: number; sp?: number }[] = [
      { x: ex + 2.6, y: 2.2, z: 4.6, s: 3.2, c: 0xe8483f },
      { x: ex + 6.5, y: 3.1, z: 10.8, s: 3.0, c: 0xf6c443 },
      { x: ex + 7.5, y: 4.1, z: 17.5, s: 3.0, c: 0x22a6a0, ax: 3.4, sp: 0.9 },
      { x: ex + 4.5, y: 5.2, z: 24, s: 2.6, c: 0x3a78c8 },
      { x: ex + 8, y: 6.6, z: 29.8, s: 3.0, c: 0xf08a2e, ay: 1.3, sp: 1.1 },
      { x: ex + 9, y: 8.2, z: 36.2, s: 2.8, c: 0xe8483f },
      { x: ISLET.x + 9.6, y: 9.6, z: ISLET.z + 1.5, s: 2.8, c: 0xf6c443, az: 2.6, sp: 0.8 },
      { x: ISLET.x + 6.0, y: 10.9, z: ISLET.z + 4.6, s: 2.4, c: 0x22a6a0 },
    ];
    defs.forEach((d, i) => {
      this.floatBlock(d.x, d.y, d.z, d.s, d.c, { ax: d.ax, ay: d.ay, az: d.az, sp: d.sp }, i * 1.3);
      this.shells.push(new THREE.Vector3(d.x, d.y + 1.0 + (d.ay ?? 0), d.z));
      if (i === 3 || i === 5) this.refills.push(new THREE.Vector3(d.x + 0.75, d.y + 1.0, d.z - 0.75));
    });

    // 小島の岩の柱（てっぺんにヒカリ石）
    const ix = ISLET.x, iz = ISLET.z;
    const PH = this.rockPillar(ix, iz, 4.3, 12.2);
    this.gemPos[3] = new THREE.Vector3(ix - 0.8, PH + 1.6, iz - 0.6);
    this.starfish[4] = new THREE.Vector3(ix - 9, heightAt(ix - 9, iz + 4) + 0.5, iz + 4);
  }

  /** 砂浜の起伏を変えても波打ち際から同じ距離に置く。 */
  private beachPoint(degrees: number, setback: number): THREE.Vector3 {
    const angle = degrees * Math.PI / 180;
    const p = this.shorePoint(angle, 0);
    p.x -= Math.cos(angle) * setback;
    p.z -= Math.sin(angle) * setback;
    return p.setY(heightAt(p.x, p.z));
  }

  protected buildBeach(): void {
    buildSwimBeach(this.matte, this.streetDetail, this.colliders);
    const cols = [0xe8483f, 0x3a78c8, 0xf6c443, 0x22a6a0, 0xf08a2e];
    const umbrellas = [[58, 11], [74, 19], [96, 11.25], [112, 12.25], [128, 12]];
    umbrellas.forEach(([degrees, setback], i) => {
      const p = this.beachPoint(degrees, setback);
      const yaw = this.rnd() * 6;
      const base = M(p.x, p.y, p.z, yaw);
      const b = this.matte.setBase(base);
      b.add(cyl(0.045, 0.045, 2.5, 6), 0xf3ead6, M(0, 1.25, 0, 0, 1, 1, 1, 0.08));
      // 8枚はぎのパラソル
      const canopy = new THREE.ConeGeometry(1.75, 0.62, 8, 1, true).toNonIndexed();
      const cp = canopy.getAttribute('position');
      const cc = new Float32Array(cp.count * 3);
      const c1 = new THREE.Color(cols[i]), c2 = new THREE.Color(0xfaf6ea);
      for (let v = 0; v < cp.count; v++) {
        const seg = Math.floor(v / 3) % 8;
        const c = seg % 2 ? c2 : c1;
        cc[v * 3] = c.r; cc[v * 3 + 1] = c.g; cc[v * 3 + 2] = c.b;
      }
      canopy.deleteAttribute('uv');
      canopy.setAttribute('color', new THREE.BufferAttribute(cc, 3));
      canopy.applyMatrix4(mul(base, M(0.1, 2.55, 0, 0, 1, 1, 1, 0.08)));
      this.flags.push(canopy);
      // タオルとビーチボール
      b.add(box(0.9, 0.03, 1.9), cols[(i + 2) % 5], M(1.0, 0.03, 0.3, 0.3));
      b.add(box(0.9, 0.035, 0.3), 0xfaf6ea, M(1.0, 0.032, 0.3, 0.3));
      if (i % 2 === 0) this.gloss.setBase(base).add(sph(0.3, 12, 8), cols[(i + 3) % 5], M(-1.1, 0.3, 0.8), { top: 0xfaf6ea });
      this.colliders.addCyl(p.x, p.z, p.y, p.y + 2.4, 0.08);
    });
    // 砂の城
    const sp = this.beachPoint(86, 9.75);
    const s = this.matte.setBase(M(sp.x, sp.y, sp.z, 0.4));
    const sand = 0xe2c58c;
    s.add(box(1.5, 0.5, 1.5), sand, M(0, 0.25, 0), { ao: 0.8, jitter: 0.1 });
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      s.add(cyl(0.26, 0.3, 0.9, 10), sand, M(sx * 0.75, 0.45, sz * 0.75), { ao: 0.8 });
      s.add(cone(0.3, 0.4, 10), 0xd4b478, M(sx * 0.75, 1.1, sz * 0.75));
    }
    s.add(cyl(0.34, 0.4, 0.8, 10), sand, M(0, 0.9, 0));
    s.add(cone(0.4, 0.5, 10), 0xd4b478, M(0, 1.55, 0));
    this.starfish[2] = new THREE.Vector3(sp.x + 1.8, sp.y + 0.5, sp.z + 0.6);
    // ヒトデを集めたあとのヒカリ石はビーチの真ん中に現れる
    const gp = this.beachPoint(90, 22);
    this.gemPos[2] = new THREE.Vector3(gp.x, gp.y + 1.7, gp.z);
  }

  // ───────────────────────── 道しるべ ─────────────────────────
  protected buildSigns(): void {
    const signs: [number, number, number, string][] = [
      [PLAZA.x + 27, PLAZA.z + 4.2, -Math.PI / 2, 'みなと →'],
      [PLAZA.x + 4.4, PLAZA.z + 27, Math.PI, 'ビーチ ↓'],
      [PLAZA.x - 26, PLAZA.z + 3.6, Math.PI / 2, '← とけいとう'],
      [PLAZA.x - 24.5, PLAZA.z - 12.5, Math.atan2(-1, -0.2) + Math.PI, '← とうだい'],
    ];
    for (const [x, z, yaw, text] of signs) {
      const y = heightAt(x, z);
      const b = this.matte.setBase(M(x, y, z, yaw));
      b.add(cyl(0.07, 0.09, 1.9, 8), WOOD_DARK, M(0, 0.95, 0));
      b.add(box(1.7, 0.75, 0.08), WOOD, M(0, 1.75, 0));
      const tex = textTexture([text], { w: 512, h: 224, font: 96 });
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.66), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
      board.position.set(x, y + 1.75, z);
      board.rotation.y = yaw;
      board.translateZ(0.045);
      board.receiveShadow = true;
      this.root.add(board);
      this.colliders.addCyl(x, z, y, y + 2.1, 0.12);
    }
  }


  // ───────────────────────── 通り沿いの家 ─────────────────────────
  private buildStreets(): void {
    const rnd = mulberry32(4242);
    const accents = [TERRACOTTA, BLUE, TEAL, 0x274b7a, 0xb8473a];
    let idx = 20;
    /** 通りの両側に、通りのほうを向いた家を並べる */
    const row = (ax: number, az: number, bx: number, bz: number, ts: number[], sides: number[] = [-1, 1]) => {
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz);
      const ux = dx / len, uz = dz / len;
      for (const t of ts) {
        for (const s of sides) {
          const w = 6 + Math.floor(rnd() * 3), d = 6 + Math.floor(rnd() * 2);
          const h = [4.4, 5.2, 6.6, 7.6][Math.floor(rnd() * 4)];
          const off = 3.4 + d / 2 + 1.1;
          const x = ax + dx * t - uz * s * off, z = az + dz * t + ux * s * off;
          // 玄関（ローカル +z）を通り側へ向ける
          const yaw = Math.atan2(uz * s, -ux * s);
          const roof = this.buildHouse(x, z, yaw, w, d, h, WALLS[Math.floor(rnd() * WALLS.length)], accents[Math.floor(rnd() * accents.length)], h > 7 && rnd() < 0.5, false, rnd() < 0.45, rnd() < 0.6, idx++);
          if (rnd() < 0.5) this.shells.push(roof.clone().add(new THREE.Vector3(0.8, 0.9, -0.6)));
        }
      }
    };
    row(24, 0, 92, 0, [0.2, 0.38, 0.56, 0.74]); // 港への大通り
    this.finishStatic();
    row(0, 24, 0, 84, [0.22, 0.44, 0.66]); // 浜辺への通り
    this.finishStatic();
    row(-23, 7, -64, 20, [0.42, 0.72]); // 時計塔への通り
    row(-20, -14, -58, -41, [0.5], [1]); // 灯台への通り
    // 時計塔広場を囲む家
    for (const [a, w, h] of [[20, 7, 5.2], [150, 6, 6.6], [100, 8, 4.4]] as const) {
      const ang = (a * Math.PI) / 180;
      const x = WEST.x + Math.cos(ang) * (WEST.r + 4.5), z = WEST.z + Math.sin(ang) * (WEST.r + 4.5);
      this.buildHouse(x, z, Math.atan2(WEST.x - x, WEST.z - z), w, 6, h, WALLS[(idx + 1) % WALLS.length], accents[idx % accents.length], false, a === 100, a !== 100, true, idx++);
    }
    // 通りの街灯とベンチ、広場の木箱
    for (let i = 0; i < 5; i++) {
      this.lampPost(34 + i * 13, 4.6);
      this.lampPost(34 + i * 13, -4.6);
    }
    for (let i = 0; i < 4; i++) {
      this.lampPost(4.6, 34 + i * 13);
      this.lampPost(-4.6, 34 + i * 13);
    }
    this.bench(SOUTH.x + 6, SOUTH.z + 5, -0.6);
    this.bench(SOUTH.x - 6, SOUTH.z + 5, 0.6);
    this.stall(SOUTH.x + 7.5, SOUTH.z - 4, 0.3, 0xf08a2e);
    this.stall(WEST.x + 8.5, WEST.z + 7, -0.8, 0x3a78c8);
    const hy = heightAt(HARBOR.x, HARBOR.z);
    this.crate(HARBOR.x + 8, hy, HARBOR.z + 7, 1.4, 0.3);
    this.crate(HARBOR.x + 9.6, hy, HARBOR.z + 7.8, 1.2, 1.0);
    this.crate(HARBOR.x + 8.6, hy + 1.4, HARBOR.z + 7.4, 1.0, 0.6);
    this.barrel(HARBOR.x + 5.5, hy, HARBOR.z + 9);
    this.barrel(HARBOR.x - 8, hy, HARBOR.z + 8.5);
    this.barrel(HARBOR.x - 9.1, hy, HARBOR.z + 7.8);
  }

  // ───────────────────────── 3つの入口になる建物 ─────────────────────────
  private buildLandmarks(): void {
    // 1) 時計塔（ゆけむり山への入口）
    {
      const x = WEST.x, z = WEST.z - WEST.r + 2.5, y0 = heightAt(x, z) - 0.5;
      const W = 7, H = 19;
      const b = this.matte.setBase(M(x, y0, z));
      const gl = this.gloss.setBase(M(x, y0, z));
      b.add(box(W, H, W), 0xf3e9d4, M(0, H / 2, 0), { ao: 0.72, jitter: 0.05 });
      b.add(box(W + 0.5, 1.3, W + 0.5), 0xa39078, M(0, 0.65, 0), { ao: 0.75 });
      b.add(box(W + 0.4, 0.3, W + 0.4), TERRACOTTA, M(0, H * 0.56, 0));
      b.add(box(W + 0.7, 0.5, W + 0.7), 0xfbf7ee, M(0, H + 0.25, 0));
      gl.add(cone(W * 0.78, 4.6, 4), TERRACOTTA, M(0, H + 2.8, 0, Math.PI / 4), { top: 0xe07b4c });
      gl.add(sph(0.3, 10, 8), 0xe8b93c, M(0, H + 5.3, 0));
      // 鐘楼の開口部
      for (let i = 0; i < 4; i++) {
        const m = M(0, 0, 0, (i * Math.PI) / 2);
        gl.add(box(2.0, 2.6, 0.2), 0x1c3b55, mul(m, M(0, H - 6.6, W / 2 + 0.02)));
        b.add(box(2.4, 0.3, 0.3), 0xfbf7ee, mul(m, M(0, H - 5.15, W / 2 + 0.05)));
      }
      this.colliders.addBox(x, y0 + H / 2, z, W, H, W);
      // 文字盤（4面）
      const cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      const c = cv.getContext('2d')!;
      c.fillStyle = '#fbf7ee';
      c.beginPath(); c.arc(128, 128, 122, 0, 7); c.fill();
      c.lineWidth = 12; c.strokeStyle = '#27344f'; c.stroke();
      c.fillStyle = '#27344f';
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        c.beginPath(); c.arc(128 + Math.sin(a) * 96, 128 - Math.cos(a) * 96, i % 3 === 0 ? 9 : 5, 0, 7); c.fill();
      }
      c.lineCap = 'round';
      c.lineWidth = 12; c.beginPath(); c.moveTo(128, 128); c.lineTo(128 + 46, 128 - 44); c.stroke();
      c.lineWidth = 8; c.beginPath(); c.moveTo(128, 128); c.lineTo(128 - 30, 128 - 84); c.stroke();
      c.fillStyle = '#c45f38'; c.beginPath(); c.arc(128, 128, 10, 0, 7); c.fill();
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const faceMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6 });
      for (let i = 0; i < 4; i++) {
        const f = new THREE.Mesh(new THREE.CircleGeometry(2.3, 32), faceMat);
        f.position.set(x, y0 + H - 2.3, z);
        f.rotation.y = (i * Math.PI) / 2;
        f.translateZ(W / 2 + 0.04);
        this.root.add(f);
      }
      this.portals.push({ area: 'volcano', index: 0, pos: new THREE.Vector3(x, y0 + 0.5 + 2.2, z + W / 2 + 0.1), yaw: 0, unlock: 0, label: 'ゆけむり山' });
    }
    // 2) 港の倉庫（サンゴ入り江への入口）
    {
      const x = HARBOR.x - 2, z = HARBOR.z - HARBOR.r - 3.5, y0 = heightAt(x, z) - 0.5;
      const W = 16, D = 8, H = 8;
      const b = this.matte.setBase(M(x, y0, z));
      // 1階は大きな荷門、2階は桟橋を見渡す検品場。同じ外周と入口の高さを保つ。
      b.add(box(W, 4.45, D), 0xc9573f, M(0, 2.225, 0), { ao: 0.7, jitter: 0.08 });
      b.add(box(W, H - 4.45, D), 0xdc8461, M(0, (H + 4.45) / 2, 0), { ao: 0.86 });
      b.add(box(W + 0.18, 0.20, D + 0.28), 0xf1d5a8, M(0, 4.45, 0));
      b.add(box(W + 0.4, 1.0, D + 0.4), 0x8d8272, M(0, 0.5, 0));
      for (let i = 0; i < 9; i++) b.add(box(0.14, H - 1, 0.1), 0xa8432f, M(-W / 2 + 1 + i * 1.75, H / 2 + 0.4, D / 2 + 0.03));
      b.add(box(W + 0.8, 0.3, D + 0.8), 0x4a4f57, M(0, H + 0.15, 0));
      for (const side of [-1, 1]) {
        const front = side * (D / 2 + 0.11);
        for (const wx of [-5.9, -3.0, 0, 3.0, 5.9]) {
          b.add(box(2.12, 1.66, 0.15), 0xeaca9c, M(wx, 6.17, front));
          b.add(box(1.82, 1.36, 0.11), 0x345767, M(wx, 6.17, front + side * 0.10));
          b.add(box(0.08, 1.36, 0.07), 0xd8c5a6, M(wx, 6.17, front + side * 0.17));
        }
        b.add(box(0.12, 1.47, 2.72), 0x345767, M(side * (W / 2 + 0.05), 6.17, 0));
      }
      // のこぎり屋根
      for (let i = 0; i < 4; i++) {
        b.add(box(W / 4 - 0.1, 0.25, D + 0.6), 0x5a6068, M(-W / 2 + W / 8 + (i * W) / 4, H + 1.0, 0, 0, 1, 1, 1, 0, 0.42));
        this.gloss.setBase(M(x, y0, z)).add(box(0.12, 1.5, D - 0.6), 0x9fd8e8, M(-W / 2 + W / 4 + (i * W) / 4 - 0.1, H + 0.95, 0));
      }
      b.add(box(3.4, 3.6, 0.2), 0x3d5a70, M(-4.6, 2.3, D / 2 + 0.04));
      b.add(box(3.4, 3.6, 0.2), 0x3d5a70, M(4.6, 2.3, D / 2 + 0.04));
      this.colliders.addBox(x, y0 + H / 2, z, W, H, D);
      this.colliders.addBox(x, y0 + H + 0.9, z, W, 1.5, D);
      this.portals.push({ area: 'lagoon', index: 1, pos: new THREE.Vector3(x, y0 + 0.5 + 2.2, z + D / 2 + 0.1), yaw: 0, unlock: 3, label: 'サンゴ入り江' });
      // 小さな倉庫
      const x2 = x + 15, z2 = z + 0.5, y2 = heightAt(x2, z2) - 0.5;
      const b2 = this.matte.setBase(M(x2, y2, z2));
      b2.add(box(9, 3.48, 7), 0xd6bd93, M(0, 1.74, 0), { ao: 0.72, jitter: 0.08 });
      b2.add(box(9, 2.52, 7), 0xf2e1be, M(0, 4.74, 0));
      b2.add(box(9.16, 0.17, 7.30), 0x7d998b, M(0, 3.48, 0));
      for (const side of [-1, 1]) {
        for (const wx of [-2.72, 0, 2.72]) {
          b2.add(box(1.62, 1.48, 0.12), 0x427470, M(wx, 4.85, side * 3.54));
          b2.add(box(1.20, 1.15, 0.10), 0x354c51, M(wx, 4.85, side * 3.63));
        }
        b2.add(box(0.12, 1.21, 1.74), 0x354c51, M(side * 4.55, 4.85, -0.76));
      }
      b2.add(box(9.6, 0.3, 7.6), 0x4a4f57, M(0, 6.15, 0));
      b2.add(box(2.8, 3.0, 0.2), 0x3d5a70, M(0, 2.0, 3.54));
      this.colliders.addBox(x2, y2 + 3.15, z2, 9, 6.3, 7);
    }
    // 3) 丘のふもとの石の門（そよかぜ台地への入口）
    {
      const x = -66, z = -32.5;
      const yaw = Math.atan2(-58 - x, -41 - z);
      const y0 = heightAt(x, z) - 0.4;
      const base = M(x, y0, z, yaw);
      const b = this.matte.setBase(base);
      b.add(box(7.6, 6.2, 1.5), 0xb7ab98, M(0, 3.1, 0), { ao: 0.65, jitter: 0.2 });
      b.add(box(1.5, 7.2, 2.1), 0x9c907e, M(-4.1, 3.6, 0), { ao: 0.7, jitter: 0.2 });
      b.add(box(1.5, 7.2, 2.1), 0x9c907e, M(4.1, 3.6, 0), { ao: 0.7, jitter: 0.2 });
      b.add(box(11, 1.0, 2.5), 0x8d8272, M(0, 7.5, 0), { jitter: 0.2 });
      b.add(box(9, 0.5, 2.0), 0xb7ab98, M(0, 8.2, 0));
      b.add(box(9.6, 0.5, 3.4), 0x9c907e, M(0, 0.25, 0.7));
      for (const s of [-1, 1]) this.gloss.setBase(base).add(sph(0.42, 10, 8), 0x2f8f6a, M(s * 4.1, 7.6, 0, 0, 1, 0.9, 1), { top: 0x74c89a });
      this.colliders.addBox(x, y0 + 4.2, z, 9.7, 8.4, 1.6, yaw);
      const nx = Math.sin(yaw), nz = Math.cos(yaw);
      this.portals.push({ area: 'plateau', index: 2, pos: new THREE.Vector3(x + nx * 0.86, y0 + 0.4 + 2.5, z + nz * 0.86), yaw, unlock: 5, label: 'そよかぜ台地' });
    }
  }

  // ───────────────────────── スミ・収集物・住人 ─────────────────────────
  private placeGoop(): void {
    scatterGoop(this.goop, PLAZA.x, PLAZA.z, 77);
    this.finalizeGoop([[PLAZA.x, PLAZA.z, 4.4]]);
    this.pickEnemySpots(6, PLAZA.x, PLAZA.z, 7, 17);
  }

  private placeCollectibles(): void {
    const { x, z, y } = PLAZA;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.39;
      this.shells.push(new THREE.Vector3(x + Math.cos(a) * 6, y + 0.9, z + Math.sin(a) * 6));
    }
    // 通りと小道に沿って
    for (const path of [...shellPaths, ...shellStreets]) {
      const pts = path.pts;
      for (let i = 1; i < pts.length; i++) {
        const n = Math.max(1, Math.round(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) / 22));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          const px = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pz = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
          this.shells.push(new THREE.Vector3(px, heightAt(px, pz) + 0.9, pz));
        }
      }
    }
    this.gemPos[0] = this.fountainTop.clone().add(new THREE.Vector3(0, 1.5, 0));
    this.gemPos[4] = new THREE.Vector3(x, y + 1.7, z + 14.5);
    const hidden = [true, false, true, false, true];
    this.gemPos.forEach((pos, id) => this.gems.push({ id, pos, hidden: hidden[id] }));
    this.missions.push(
      { gem: 0, kind: 'clean', title: '広場のスミを洗い流そう', hint: '広場の<b>スミ</b>を洗い流そう' },
      { gem: 1, kind: 'reach', title: '灯台のてっぺんへ', hint: '<b>灯台</b>のてっぺんをめざそう' },
      { gem: 2, kind: 'collect', title: 'ヒトデを8つ集めよう', hint: '町じゅうの<b>ヒトデ</b>をさがそう' },
      { gem: 3, kind: 'reach', title: '沖の浮きブロックをわたろう', hint: '桟橋の先の <b>浮きブロック</b>へ' },
      { gem: 4, kind: 'defeat', title: 'スミボウを全部やっつけよう', hint: '広場の<b>スミボウ</b>をやっつけよう' },
    );

    const r = this.roofs;
    this.starfish[0] = new THREE.Vector3(r[5].x, r[5].y + 0.42 + 1.8 + 0.6, r[5].z); // 塔のドームの上
    this.starfish[1] = new THREE.Vector3(r[2].x - 1.2, r[2].y + 0.6, r[2].z + 0.8); // 階段のある家の屋上
    this.starfish[3] = this.stallTops[0].clone().add(new THREE.Vector3(0, 0.5, 0)); // 屋台の日よけの上
    this.starfish[6] = new THREE.Vector3(HILL.x - 6.5, heightAt(HILL.x - 6.5, HILL.z - 3) + 0.5, HILL.z - 3); // 灯台の裏
  }

  private placeNpcs(): void {
    const face = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);
    const sp = this.spawn;
    this.npcs.push({
      x: sp.x + 3.2, z: sp.z - 2.5, yaw: face(sp.x + 3.2, sp.z - 2.5, sp.x, sp.z),
      name: 'トト村長', body: 0x6b7a8c, belly: 0xf3ead6, hat: 0xc45f38,
      lines: ['たいへんじゃ！ 町がスミだらけなんじゃ…', 'ひょうたんポンプの水で 洗い流しておくれ！', '水がへったら 噴水か海に入れば 補給できるぞ', 'ヒカリ石が集まると 町にあたらしい異変が おきるらしい…'],
    });
    this.npcs.push({
      x: -27, z: -22.5, yaw: face(-27, -22.5, -22, -17),
      name: 'ミナ', body: 0xd8a24a, belly: 0xfff4d8, hat: 0x22a6a0,
      lines: ['灯台の丘からは ゆけむり山の火口と そよかぜ台地の気球が見えるよ。てっぺんにはヒカリ石もあるんだって', '空中でジャンプを長押しすると ホバーできるよ', '丘のふもとの 石の門も 気になるなあ…'],
    });
    const bp = this.beachPoint(100, 13);
    this.npcs.push({
      x: bp.x, z: bp.z, yaw: face(bp.x, bp.z, bp.x, bp.z - 10),
      name: 'ルカ', body: 0x8b5fbf, belly: 0xf3ead6, hat: 0xf6c443,
      lines: ['ヒトデが 町じゅうに 8つ かくれてるの', '屋根の上や 岩の上も さがしてみてね', 'ブイのあるほうへ進むと 足が浮いて泳げるよ。浜へ向けば そのまま上がれるよ'],
    });
    this.npcs.push({
      x: this.pierEnd.x - 8, z: 0.9, yaw: -Math.PI / 2 + 0.5,
      name: 'ゴンじい', body: 0x4f6f8c, belly: 0xe8e2d0, hat: 0x3a78c8,
      lines: ['沖の浮きブロックの先… 岩のてっぺんが 光っとるじゃろ', '落ちても平気じゃ。泳いで もどってこい', 'ホバーは 水を使う。タンクの残りに 気をつけるんじゃぞ'],
    });
    this.npcs.push({
      x: WEST.x + 5.5, z: WEST.z + 2, yaw: face(WEST.x + 5.5, WEST.z + 2, WEST.x, WEST.z + 8),
      name: 'カチコ', body: 0xc76a8a, belly: 0xfff4d8, hat: 0x8b5fbf,
      lines: ['時計塔が スミのかたまりに のまれちゃった！', '水をかけて洗い流すと 壁にふしぎな しるしが出るの', 'ほら、北北西に湯けむりが見えるよ。しるしに飛びこむと あの山に行けるんだって'],
    });
    this.npcs.push({
      x: HARBOR.x - 7, z: HARBOR.z - 4, yaw: face(HARBOR.x - 7, HARBOR.z - 4, HARBOR.x, HARBOR.z + 4),
      name: 'ハトバ', body: 0x3f7f6a, belly: 0xe8e2d0, hat: 0xe8483f,
      lines: ['ヒカリ石が3つ集まると この倉庫に 異変がおきるそうだ', '東北東の岬に 難破船が見えるだろう？ あのサンゴ入り江への入口が 倉庫のしるしなんだ', 'ヒカリ石5つで 丘のふもとの 石の門も 目をさますぞ', 'あの竿の魚が乾いたら、朝市に届ける番だ'],
    });
    this.npcs.push({
      x: -27.1, z: 70.7, yaw: 2.5, name: 'ネリ', body: 0xb88059, belly: 0xffedcc, hat: 0x446f7e,
      lines: ['この窯で焼いたうつわは、荷車に積んで朝市へ運ぶんだ', '青い壺は海の色。港通りのお店でも見つけてみてね'],
    });
    this.npcs.push({
      x: 2.7, z: -51.1, yaw: 0.18, name: 'ユウビ', body: 0x57768c, belly: 0xffefcc, hat: 0x993a34,
      lines: ['朝いちばんの船に乗せる手紙を 仕分けているの', '荷台の鞄に、刷りたての海鳥のはがきを積んだところよ', 'この石畳は配達の近道。東へ行けば港通り、西へたどれば灯台の道よ'],
    });
  }
}
