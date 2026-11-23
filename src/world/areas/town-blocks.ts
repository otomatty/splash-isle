import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildAlleyLine, buildBlockFacade, buildDoorstepSet, buildUpperStorySet } from './town-block-facade';
import { visitArtisanWindows } from './town-neighborhood';
import type { Box, Colliders } from '../colliders';
import { heightAt, pavedDistance, type PathDef, type TerrainDef } from '../terrain';

type Point = [number, number];

const lane = (width: number, ...pts: Point[]): PathDef => ({ width, pts });

// 港の大通りから東の商家を回り、南の門へ抜ける格子。十字路の角と裏路地は住棟を切り離す。
const lowerLanes = [
  lane(5.8, [0, 29], [22, 28], [52, 26], [84, 26]),
  lane(4.5, [0, 55], [23, 54], [48, 49], [74, 48]),
  lane(4.0, [32.7, 0], [32.7, 14], [30, 30], [31, 53], [34, 72]),
  lane(4.4, [57.4, 0], [57.4, 19], [58, 43], [58, 60]),
  lane(5.2, [10, 86], [31, 89], [59, 79], [81, 63], [98, 39], [103, 12], [103, 0]),
  lane(4.4, [104, 0], [109, 13], [113, 27], [105, 42], [95, 51], [81, 63]),
  lane(3.6, [8, 75], [25, 75], [46, 71], [69, 60], [87, 51]),
];
// 時計塔を核に外周道路と放射路が交わる。西側の路地は灯台の尾根に入る手前で折り返す。
const westLanes = [
  lane(5.4, [0, 30], [-16, 31], [-37, 39], [-58, 43]),
  lane(4.0, [-20, 31], [-24, 43], [-15.5, 51], [-15.5, 68], [-12, 72], [-8, 76], [-6, 78]),
  lane(4.6, [-71, 24], [-84, 25], [-95, 28], [-94, 47], [-74, 64], [-49, 84], [-29, 95], [-12, 92]),
  lane(3.8, [-94, 47], [-79, 46], [-65, 46.5], [-59, 43]),
  lane(3.8, [-74, 64], [-71, 52], [-55, 55]),
  lane(5.0, [-70, 20], [-84, 13], [-91, -5], [-90, -21], [-77, -34], [-64, -43], [-58, -41]),
  lane(4.0, [-90, -7], [-70, -7], [-51, -8], [-31, -9], [-24, -6]),
  lane(4.6, [-90, -21], [-102, -24], [-114, -11], [-113, 12], [-104, 30], [-94, 47]),
  lane(3.8, [-48.9, 15.1], [-49.2, 2.4], [-52, -14], [-61, -26]),
];
// 郵便局の裏に環状の坂道。東端を倉庫通りに、西端を灯台へ向かう道に結ぶ。
const upperLanes = [
  lane(5.6, [-57, -41], [-63, -57], [-59, -71], [-34, -74], [-8, -73], [20, -74], [47, -63], [69, -50], [81, -35], [80, -21], [80, 0]),
  lane(4.8, [63, -53], [68, -68], [81, -69], [94, -57], [105, -41], [115, -28], [125, -16], [125, -6.2], [121, -6.2]),
  lane(4.0, [81, -35], [93, -38], [103, -44]),
  lane(4.0, [94, -57], [87, -48], [81, -35]),
  lane(5.0, [-59, -71], [-45, -88], [-17, -93], [11, -92], [36, -85], [54, -72], [64, -53]),
  lane(4.2, [-36, -46], [-36, -65], [-34, -74], [-35, -91]),
  lane(4.2, [29.5, -37.5], [32, -51], [39, -65], [42, -81]),
  lane(4.4, [-87, -25], [-74, -18], [-54, -19], [-36, -19], [-29, -21]),
  lane(4.8, [81, -33], [63, -31], [45, -27]),
  lane(4.2, [69, -50], [58, -40], [61, -27], [61, -13], [57.4, -13], [57.4, 0]),
  lane(3.8, [-7, -73], [-8.7, -64], [-8.6, -53]),
  lane(4.5, [0, -45], [-1, -35], [15, -32], [31, -26], [43.6, -25]),
];

export const blockStreets: PathDef[] = [...lowerLanes, ...westLanes, ...upperLanes];
// 各通りの店先から裏の勝手口まで土舗装を連ねる。石畳の車道はこの上から描かれる。
export const blockCourts: PathDef[] = blockStreets.map(({ pts, width }) => ({ pts, width: width + 22 }));

interface Lot {
  x: number; z: number;
  w: number; d: number;
  yaw: number;
  floors: 2 | 3;
  style: number;
  family: number;
  setback: number;
}

interface Footprint {
  x: number; z: number;
  hx: number; hz: number;
  cos: number; sin: number;
}

function lotsInTown(colliders: Colliders, terrain: TerrainDef): Lot[] {
  // どの候補地も中心から8m以内。障害物の範囲をその分広げて索引に入れると、
  // 各候補は自分のセルに入った壁、通り、広場だけと照合すればよい。
  type Obstacle = Footprint | { x: number; z: number; radius: number };
  const cells = new Map<number, Obstacle[]>();
  function register(o: Obstacle): void {
    const rx = 'radius' in o ? o.radius : Math.abs(o.cos) * o.hx + Math.abs(o.sin) * o.hz;
    const rz = 'radius' in o ? o.radius : Math.abs(o.sin) * o.hx + Math.abs(o.cos) * o.hz;
    for (let iz = Math.floor((o.z - rz - 8) / 16); iz <= Math.floor((o.z + rz + 8) / 16); iz++) {
      for (let ix = Math.floor((o.x - rx - 8) / 16); ix <= Math.floor((o.x + rx + 8) / 16); ix++) {
        const key = ix + 1024 * iz;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key)!.push(o);
      }
    }
  }

  const clearWays = [...terrain.paths.filter(p => !blockCourts.includes(p)), ...terrain.streets];
  clearWays.push(lane(3.3, [0, 30], [-98, -70])); // 広場から灯台へ直接登る既存の斜めの抜け道
  for (const path of clearWays) {
    const radius = path.width / 2 + 0.45;
    for (let i = 0; i < path.pts.length; i++) {
      const a = path.pts[i];
      register({ x: a[0], z: a[1], radius });
      if (i === 0) continue;
      const b = path.pts[i - 1], dx = a[0] - b[0], dz = a[1] - b[1], length = Math.hypot(dx, dz);
      register({ x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, hx: length / 2, hz: radius, cos: dx / length, sin: -dz / length });
    }
  }
  for (const p of terrain.plazas) register({ x: p.x, z: p.z, radius: p.r });
  for (const o of colliders.cyls) register({ x: o.x, z: o.z, radius: o.r });
  for (const o of colliders.boxes) register({ x: o.cx, z: o.cz, hx: o.hx, hz: o.hz, cos: o.cos, sin: o.sin });

  const plots: Lot[] = [];
  function place(p: Lot): void {
    if (p.z < -98 || (p.z > 97 && Math.abs(p.x) < 50) || Math.hypot(p.x, p.z) > 123 ||
        Math.hypot(p.x + 104, p.z + 74) < 43) return;
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    const hx = p.w / 2 + 0.35, hz = p.d / 2 + 0.52;
    const cell = Math.floor(p.x / 16) + 1024 * Math.floor(p.z / 16);
    for (const o of cells.get(cell) ?? []) {
      const dx = o.x - p.x, dz = o.z - p.z;
      const lx = Math.abs(dx * c - dz * s), lz = Math.abs(dx * s + dz * c);
      if ('radius' in o) {
        if (Math.max(0, lx - hx) ** 2 + Math.max(0, lz - hz) ** 2 < o.radius ** 2) return;
      } else {
        // 道路と家は回転した長方形。両者の長短軸に射影して、角だけが重なる場合も外す。
        const u = Math.abs(c * o.cos + s * o.sin), v = Math.abs(s * o.cos - c * o.sin);
        if (lx < hx + o.hx * u + o.hz * v && lz < hz + o.hx * v + o.hz * u &&
            Math.abs(dx * o.cos - dz * o.sin) < o.hx + hx * u + hz * v &&
            Math.abs(dx * o.sin + dz * o.cos) < o.hz + hx * v + hz * u) return;
      }
    }
    plots.push(p);
    register({ x: p.x, z: p.z, hx: p.w / 2, hz: p.d / 2, cos: c, sin: s });
  }

  // 通りに正面を向けた長屋の列。数軒ごとの切れ目は次の通りへ抜ける路地になる。
  const frontages = [...blockStreets, ...terrain.streets.filter(p => !blockStreets.includes(p) && p.width >= 4)];
  for (let pass = 0; pass < 2; pass++) {
    frontages.forEach((road, streetIndex) => {
      for (let j = 1; j < road.pts.length; j++) {
        const a = road.pts[j - 1], b = road.pts[j];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
        const count = Math.max(1, Math.round(len / 9.2)), span = len / count;
        if (span < 5.8) continue;
        for (const side of [-1, 1]) {
          const stride = pass === 0 ? span : 2.5;
          for (let along = pass === 0 ? span * 0.5 : 1.8, i = 0; along < len; along += stride, i++) {
            const index = streetIndex * 37 + j * 13 + i * 5 + (side > 0 ? 3 : 0);
            const w = pass === 0 ? Math.min(10.5, span - (i % 3 === 1 ? 2.1 : 1.2)) : 6.2 + index % 3 * 0.55;
            const d = pass === 0 ? 5.5 + index % 5 * 0.52 : 5.6;
            const offset = road.width / 2 + d / 2 + 1.45 + (index % 3) * 0.18;
            const p: Lot = {
              x: a[0] + ux * along - uz * side * offset, z: a[1] + uz * along + ux * side * offset,
              w, d, yaw: Math.atan2(uz * side, -ux * side), setback: offset - (d + road.width) / 2,
              floors: index % 5 < 2 ? 3 : 2, style: index % 3, family: (streetIndex + Math.floor(index / 5)) % 3,
            };
            place(p);
          }
        }
      }
    });
  }
  return plots;
}

const SLABS = [0xd6c19e, 0xd0bc99, 0xdecbab, 0xd8c7a7].map(c => new THREE.Color(c));
const KERB = new THREE.Color(0xaa927a), DOORSTONE = new THREE.Color(0xe5d7bd);

function frontWalk(lot: Lot, sideReturn: number): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], index: number[] = [];
  const c = Math.cos(lot.yaw), s = Math.sin(lot.yaw), f = lot.d / 2;
  function slab(x0: number, x1: number, z0: number, z1: number, color: THREE.Color, lift = 0.038): void {
    const first = pos.length / 3;
    for (const [lx, lz] of [[x0,z1], [x1,z1], [x1,z0], [x0,z0]]) {
      const x = lot.x + c * lx + s * lz, z = lot.z - s * lx + c * lz;
      pos.push(x, heightAt(x, z) + lift, z);
      col.push(color.r, color.g, color.b);
    }
    index.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  // 玄関から石畳の縁まで。石を小さく区切って、高低差のある裏通りでも地面に沿わせる。
  const width = lot.w + 0.38, n = Math.ceil(width / 1.20), strip = width / n;
  for (let i = 0; i < n; i++) {
    const x = -width / 2 + i * strip;
    slab(x + 0.009, x + strip - 0.009, f - 0.02, f + lot.setback - 0.16, SLABS[(i + lot.family) % SLABS.length]);
    slab(x + 0.009, x + strip - 0.009, f + lot.setback - 0.15, f + lot.setback, KERB);
  }
  // 各正面意匠の実際の玄関位置に合わせた敷居。工房の荷戸は広いまま。
  const entry = [2.06, 0, 2.56][lot.style] * lot.w / 8;
  slab(entry - 0.68, entry + 0.68, f + 0.01, f + 0.43, DOORSTONE, 0.065);
  if (sideReturn !== 0) {
    const edge = sideReturn * lot.w / 2;
    const a = Math.min(edge, edge + sideReturn * 0.95), b = Math.max(edge, edge + sideReturn * 0.95);
    for (let i = 0; i < 3; i++) slab(a, b, f - 2.22 + i * 0.74, f - 1.50 + i * 0.74, SLABS[(i + lot.family) % SLABS.length]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

interface Doorstep {
  x: number; z: number;
  y: number; yaw: number; side: number;
}

// 狭い路地では隣家からのすれ違い幅を確保し、既存の石畳・広場にも商品を並べない。
function findDoorstep(lot: Lot, owner: Box, colliders: Colliders): Doorstep | undefined {
  const c = Math.cos(lot.yaw), s = Math.sin(lot.yaw);
  const side = lot.style === 2 ? (lot.family % 2 ? -1 : 1) : 0;
  const lx = side ? side * (lot.w / 2 + 0.42) : (lot.style === 0 ? -1.65 : (lot.family % 2 ? -2.3 : 2.3)) * lot.w / 8;
  const lz = side ? lot.d / 2 - 1.05 : lot.d / 2 + 0.43;
  const x = lot.x + c * lx + s * lz, z = lot.z - s * lx + c * lz;
  const yaw = lot.yaw + side * Math.PI / 2, co = Math.cos(yaw), si = Math.sin(yaw);
  const y = heightAt(x, z);
  for (const dx of [-0.88, 0.88]) {
    for (const dz of [-0.36, 0.36]) {
      const px = x + dx * co + dz * si, pz = z - dx * si + dz * co;
      if (pavedDistance(px, pz) < 0.06 || Math.abs(heightAt(px, pz) - y) > 0.12) return;
    }
  }
  for (const b of colliders.boxes) {
    if (b === owner || b.cy + b.hy < y + 0.23) continue;
    const dx = b.cx - x, dz = b.cz - z;
    if (Math.abs(dx) > b.br + 2.5 || Math.abs(dz) > b.br + 2.5) continue;
    const u = Math.abs(co * b.cos + si * b.sin), v = Math.abs(co * b.sin - si * b.cos);
    // 小物の周囲に片側1mの通り道を残す。玄関を塞がないよう戸口は上の位置選びで外した。
    const hx = 1.88, hz = 1.36;
    if (Math.abs(dx * co - dz * si) < hx + b.hx * u + b.hz * v &&
        Math.abs(dx * si + dz * co) < hz + b.hx * v + b.hz * u &&
        Math.abs(dx * b.cos - dz * b.sin) < b.hx + hx * u + hz * v &&
        Math.abs(dx * b.sin + dz * b.cos) < b.hz + hx * v + hz * u) return;
  }
  for (const o of colliders.cyls) {
    if (Math.hypot(o.x - x, o.z - z) < o.r + 1.94) return;
  }
  return { x, z, y, yaw, side };
}

interface Frontage {
  lot: Lot;
  owner: Box;
  parts: THREE.BufferGeometry[];
}

interface Hanging {
  kind: number; family: number;
  x: number; y: number; z: number;
  yaw: number; width: number;
}

// 遠景用のレベルは空。初めて近づいた街区だけ形にし、以後は同じメッシュを出し入れする。
class UpperStreetDetail extends THREE.LOD {
  private near = new THREE.Group();
  private makeMesh?: () => THREE.Mesh;

  constructor(makeMesh: () => THREE.Mesh) {
    super();
    this.makeMesh = makeMesh;
    const far = new THREE.Object3D();
    far.visible = false;
    this.addLevel(this.near, 0);
    this.addLevel(far, 38, 0.14);
  }

  override update(camera: THREE.Camera): void {
    super.update(camera);
    if (this.near.visible && this.makeMesh) {
      const mesh = this.makeMesh();
      this.makeMesh = undefined;
      this.near.add(mesh);
      mesh.updateWorldMatrix(true, false);
    }
  }
}

function wallPoint(lot: Lot, x: number, z: number): Point {
  const c = Math.cos(lot.yaw), s = Math.sin(lot.yaw);
  return [lot.x + c * x + s * z, lot.z - s * x + c * z];
}

function addUpperStories(root: THREE.Group, material: THREE.Material, detailMeshes: THREE.Object3D[], frontages: Frontage[], colliders: Colliders): void {
  const cells = new Map<string, Hanging[]>();
  function place(kind: number, family: number, x: number, y: number, z: number, yaw: number, width = 1): void {
    const cell = Math.floor(x / 28) + ',' + Math.floor(z / 28);
    if (!cells.has(cell)) cells.set(cell, []);
    cells.get(cell)!.push({ kind, family, x, y, z, yaw, width });
  }

  visitArtisanWindows(place);
  const used = new Set<Lot>();
  const choices = [[3, 0, 1], [0, 1, 3], [2, 2, 3]];
  const floorY = ({ lot, owner }: Frontage) => owner.cy + owner.hy - lot.floors * 2.8 - 0.30;
  for (const frontage of frontages) {
    const { lot } = frontage;
    const seed = Math.abs(Math.round(lot.x * 7) + Math.round(lot.z * 13));
    if (seed % 11 >= [5, 7, 5][lot.style]) continue;
    const kind = choices[lot.style][Math.floor(seed / 11) % 3];
    const side = seed % 4 === 1 ? (seed % 3 ? -1 : 1) : 0;
    const floor = lot.floors === 3 && seed % 3 === 1 ? 2 : 1;
    const [x, z] = side ? wallPoint(lot, side * lot.w / 2, 0) : wallPoint(lot, 0, lot.d / 2);
    place(kind, lot.family, x, floorY(frontage) + floor * 2.8 + 0.50, z, lot.yaw + side * Math.PI / 2);
    used.add(lot);
  }

  // 同じ通りを向いた隣同士で、壁の間の細い路地だけに物干しを渡す。広い交差点は空ける。
  for (let i = 1; i < frontages.length; i++) {
    const prior = frontages[i - 1], next = frontages[i], a = prior.lot, b = next.lot;
    if (used.has(a) || used.has(b) || Math.cos(a.yaw - b.yaw) < 0.997) continue;
    const dx = b.x - a.x, dz = b.z - a.z, c = Math.cos(a.yaw), s = Math.sin(a.yaw);
    const along = dx * c - dz * s, gap = Math.abs(along) - (a.w + b.w) / 2;
    if (gap < 1.35 || gap > 4.85 || Math.abs(dx * s + dz * c) > 1.7 || Math.abs(floorY(prior) - floorY(next)) > 0.9) continue;
    const side = Math.sign(along);
    const [ax, az] = wallPoint(a, side * a.w / 2, a.d * 0.21);
    const [bx, bz] = wallPoint(b, -side * b.w / 2, b.d * 0.21);
    const x = (ax + bx) / 2, z = (az + bz) / 2, yaw = Math.atan2(az - bz, bx - ax);
    // 真下に木箱や仕事台のある裏口を除き、布の下を人が両側からくぐれる路地を選ぶ。
    const blocked = [-1.6, 0, 1.6].some(step => {
      const px = x + Math.sin(yaw) * step, pz = z + Math.cos(yaw) * step;
      return colliders.pointInside(px, heightAt(px, pz) + 0.92, pz, 0.46);
    });
    if (blocked) continue;
    place(4, (a.family + b.family + i) % 3, x, (floorY(prior) + floorY(next)) / 2 + 4.9, z, yaw, Math.hypot(ax - bx, az - bz));
    used.add(a);
    used.add(b);
  }

  const models = new Map<number, THREE.BufferGeometry>();
  for (const [cell, hangings] of cells) {
    const [cx, cz] = cell.split(',').map(n => (Number(n) + 0.5) * 28);
    const cy = hangings.reduce((sum, h) => sum + h.y, 0) / hangings.length;
    const lod = new UpperStreetDetail(() => {
      const transform = new THREE.Matrix4(), scale = new THREE.Vector3();
      const parts = hangings.map(h => {
        const key = h.kind * 3 + h.family;
        if (!models.has(key)) models.set(key, h.kind === 4 ? buildAlleyLine(h.family) : buildUpperStorySet(h.kind, h.family));
        transform.makeRotationY(h.yaw).scale(scale.set(h.width, 1, 1)).setPosition(h.x - cx, h.y - cy, h.z - cz);
        return models.get(key)!.clone().applyMatrix4(transform);
      });
      const mesh = new THREE.Mesh(mergeGeometries(parts, false)!, material);
      for (const part of parts) part.dispose();
      mesh.receiveShadow = true;
      return mesh;
    });
    lod.name = 'upper-street-' + cell;
    lod.position.set(cx, cy, cz);
    detailMeshes.push(lod);
    root.add(lod);
  }
}

/** 同じ意匠を使い回して区画ごとに統合。各建物の屋上を含めて1箱で歩行・着地を判定する。 */
export function buildTownBlocks(root: THREE.Group, material: THREE.Material, colliders: Colliders, terrain: TerrainDef, detailMeshes: THREE.Object3D[]): void {
  const prototypes = new Map<string, THREE.BufferGeometry>();
  const doorsteps = new Map<number, THREE.BufferGeometry>();
  const frontages: Frontage[] = [];
  const cells = new Map<string, THREE.BufferGeometry[]>();
  const transform = new THREE.Matrix4(), scale = new THREE.Vector3();
  for (const lot of lotsInTown(colliders, terrain)) {
    const key = [lot.style, lot.floors, lot.family].join('/');
    let facade = prototypes.get(key);
    if (!facade) {
      facade = buildBlockFacade(lot.style, lot.floors, lot.family);
      prototypes.set(key, facade);
    }
    const c = Math.cos(lot.yaw), s = Math.sin(lot.yaw);
    const height = lot.floors * 2.8 + 0.30;
    // 道側の玄関で床の高さを決め、斜面では下り側の基礎だけを伸ばす。
    const y = heightAt(lot.x + s * lot.d / 2, lot.z + c * lot.d / 2);
    let bottom = y - 0.35;
    for (const sx of [-0.5, 0.5]) {
      for (const sz of [-0.5, 0.5]) {
        const x = lot.x + sx * lot.w * c + sz * lot.d * s;
        const z = lot.z - sx * lot.w * s + sz * lot.d * c;
        bottom = Math.min(bottom, heightAt(x, z) - 0.20);
      }
    }
    const geometry = facade.clone();
    if (bottom < y - 0.35) {
      const pos = geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < -0.15) pos.setY(i, pos.getY(i) + bottom - y + 0.35);
      }
    }
    transform.makeRotationY(lot.yaw).scale(scale.set(lot.w / 8, 1, lot.d / 6)).setPosition(lot.x, y, lot.z);
    geometry.applyMatrix4(transform);
    const cell = Math.floor(lot.x / 56) + ',' + Math.floor(lot.z / 56);
    if (!cells.has(cell)) cells.set(cell, []);
    cells.get(cell)!.push(geometry);
    const top = y + height;
    const owner = colliders.addBox(lot.x, (bottom + top) / 2, lot.z, lot.w, top - bottom, lot.d, lot.yaw);
    frontages.push({ lot, owner, parts: cells.get(cell)! });
  }
  // 隣の棟を含めて全建物の当たり判定が出揃ってから、壁際の暮らしの道具を並べる。
  for (const { lot, owner, parts } of frontages) {
    const spot = findDoorstep(lot, owner, colliders);
    parts.push(frontWalk(lot, spot?.side ?? 0));
    if (!spot) continue;
    const key = lot.style * 3 + lot.family;
    if (!doorsteps.has(key)) doorsteps.set(key, buildDoorstepSet(lot.style, lot.family));
    const kit = doorsteps.get(key)!;
    const geometry = kit.clone();
    transform.makeRotationY(spot.yaw).setPosition(spot.x, spot.y, spot.z);
    geometry.applyMatrix4(transform);
    parts.push(geometry);
    const bounds = kit.boundingBox!;
    const cx = (bounds.min.x + bounds.max.x) / 2, cz = (bounds.min.z + bounds.max.z) / 2;
    const cy = bounds.max.y * 0.5;
    colliders.addBox(spot.x + cx * Math.cos(spot.yaw) + cz * Math.sin(spot.yaw), spot.y + cy,
      spot.z - cx * Math.sin(spot.yaw) + cz * Math.cos(spot.yaw),
      bounds.max.x - bounds.min.x, 2 * cy, bounds.max.z - bounds.min.z, spot.yaw);
  }
  for (const [cell, parts] of cells) {
    const merged = mergeGeometries(parts, false)!;
    for (const part of parts) part.dispose();
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = 'town-block-' + cell;
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  addUpperStories(root, material, detailMeshes, frontages, colliders);
  for (const facade of prototypes.values()) facade.dispose();
  for (const kit of doorsteps.values()) kit.dispose();
}
