import * as THREE from 'three';
import type { Colliders } from '../colliders';
import { GeoBatch, M, box, cyl } from '../props';
import { heightAt, type PathDef } from '../terrain';

const UPPER_SETBACK = 0.86;
const LIME = 0xf4e7cf, WOOD = 0x926442, TIMBER = 0x624635, GLASS = 0x29556a, TERRACOTTA = 0xac7654;
type Trade = 'washhouse' | 'potter' | 'nursery' | 'dyer' | 'bakery' | 'lampmaker';
type Lane = 'south' | 'hill';
interface Plot {
  trade: Trade;
  x: number;
  z: number;
  yaw: number;
  width: number;
  depth: number;
  height: number;
  wall: number;
  trim: number;
}

// 玄関（ローカル+Z）を石畳へ向ける。通りの貝がらと広場を結ぶ動線は空ける。
const LANES: Record<Lane, Plot[]> = {
  south: [
    { trade: 'washhouse', x: -24, z: 87, yaw: 2.57, width: 6.5, depth: 4.5, height: 3.5, wall: 0xf4e6ca, trim: 0x4a9aa6 },
    { trade: 'potter', x: -22, z: 65, yaw: -0.57, width: 6.1, depth: 5.0, height: 4.1, wall: 0xe4ab7d, trim: 0x756c9f },
    { trade: 'nursery', x: -44, z: 76, yaw: 2.57, width: 5.5, depth: 4.4, height: 3.4, wall: 0xf1e9b7, trim: 0x568b60 },
    { trade: 'dyer', x: -41, z: 52, yaw: -0.57, width: 6.8, depth: 4.6, height: 4.2, wall: 0xf1ddd6, trim: 0x455986 },
  ],
  hill: [
    { trade: 'bakery', x: -52, z: -27, yaw: 2.53, width: 6.4, depth: 4.8, height: 3.8, wall: 0xe8c397, trim: 0xc47052 },
    { trade: 'lampmaker', x: -50, z: -46, yaw: -0.61, width: 5.8, depth: 4.4, height: 4.6, wall: 0xf4e5c4, trim: 0x377b7d },
  ],
};

// 通りに沿った距離と、中心線から左右への距離で歩道・門・前庭を揃える。
const ROADS = {
  south: { x: -12, z: 84, dx: -40, dz: -26, start: -1, end: 48, half: 2.50 },
  hill: { x: -20, z: -14, dx: -38, dz: -27, start: 25, end: 46.4, half: 2.75 },
};

function roadPoint(lane: Lane, along: number, across: number): [number, number] {
  const r = ROADS[lane], length = Math.hypot(r.dx, r.dz);
  return [r.x + (r.dx * along - r.dz * across) / length, r.z + (r.dz * along + r.dx * across) / length];
}

function housePoint(p: Plot, x: number, z: number): [number, number] {
  return [p.x + x * Math.cos(p.yaw) + z * Math.sin(p.yaw), p.z - x * Math.sin(p.yaw) + z * Math.cos(p.yaw)];
}

function doorstepToWalk(lane: Lane, p: Plot): number {
  const r = ROADS[lane], length = Math.hypot(r.dx, r.dz);
  const offset = ((p.z - r.z) * r.dx - (p.x - r.x) * r.dz) / length;
  return Math.abs(offset) - r.half - 0.95;
}

export const residentialWalks: PathDef[] = [];
for (const lane of ['south', 'hill'] as const) {
  const r = ROADS[lane];
  for (const side of [-1, 1]) {
    const across = side * (r.half + 0.87);
    residentialWalks.push({ pts: [roadPoint(lane, r.start, across), roadPoint(lane, r.end, across)], width: 1.78 });
  }
  for (const p of LANES[lane]) {
    const front = p.depth / 2, door = p.width * 0.24;
    residentialWalks.push(
      { pts: [housePoint(p, door, front), housePoint(p, door, doorstepToWalk(lane, p))], width: 1.9 },
      { pts: [housePoint(p, -p.width * 0.46, front + 1.0), housePoint(p, p.width * 0.46, front + 1.0)], width: 2.3 },
    );
  }
}
for (const [t, z] of [[27.2, 8.7], [19.8, -8.0]]) {
  residentialWalks.push({ pts: [roadPoint('south', t, Math.sign(z) * 4), roadPoint('south', t, z + Math.sign(z) * 1.0)], width: 5.2 });
}

function cloth(detail: GeoBatch, x: number, top: number, z: number, w: number, h: number, color: number): void {
  const sheet = new THREE.BoxGeometry(w, h, 0.035, 5, 1, 1);
  const p = sheet.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const across = p.getX(i) / w + 0.5;
    const hem = p.getY(i) < 0 ? 1 : 0;
    p.setY(i, p.getY(i) - 0.06 * Math.sin(Math.PI * across));
    p.setZ(i, p.getZ(i) + hem * (0.10 + 0.08 * Math.sin(across * 9)));
  }
  sheet.computeVertexNormals();
  detail.add(sheet, color, M(x, top - h / 2, z), { ao: 0.88 });
}

// ろくろの断面を回して、口のくぼんだ陶器を作る。染め場では大きな甕にする。
function vessel(batch: GeoBatch, x: number, y: number, z: number, r: number, h: number, color: number): void {
  const profile = [[0.50, 0], [0.90, 0.2], [1, 0.57], [0.74, 0.86], [0.79, 1], [0.64, 1], [0.60, 0.78]];
  const geo = new THREE.LatheGeometry(profile.map(([rr, yy]) => new THREE.Vector2(rr * r, yy * h)), 9);
  batch.add(geo, color, M(x, y, z), { ao: 0.7 });
  batch.add(cyl(r * 0.61, r * 0.61, 0.02, 9), 0x534439, M(x, y + h * 0.78, z));
}

function windowBay(walls: GeoBatch, detail: GeoBatch, x: number, y: number, z: number, yaw: number, trim: number): void {
  const frame = M(x, y, z, yaw);
  const add = (w: number, h: number, d: number, dx: number, dy: number, dz: number, color: number) =>
    detail.add(box(w, h, d), color, frame.clone().multiply(M(dx, dy, dz)));
  walls.add(box(1.38, 1.40, 0.12), LIME, frame);
  walls.add(box(1.16, 1.18, 0.10), GLASS, frame.clone().multiply(M(0, 0, 0.075)));
  add(0.08, 1.22, 0.08, 0, 0, 0.15, LIME);
  add(1.20, 0.08, 0.08, 0, 0.13, 0.15, LIME);
  add(1.62, 0.13, 0.34, 0, -0.74, 0.10, trim);
  for (const side of [-1, 1]) {
    add(0.38, 1.29, 0.09, side * 0.90, 0, 0.08, trim);
    add(0.4, 0.09, 0.10, side * 0.90, 0.43, 0.13, WOOD);
  }
}

function buildHouse(lane: Lane, p: Plot, walls: GeoBatch, detail: GeoBatch, colliders: Colliders): void {
  const y = heightAt(p.x, p.z), base = M(p.x, y, p.z, p.yaw);
  walls.setBase(base);
  detail.setBase(base);
  const front = p.depth / 2, groundH = p.height, h = groundH + 2.45, w = p.width, door = w * 0.24;
  // 足場と当たり判定はどの画質でも同じ。天板や壁に付ける細工は低画質で省略する。
  const solid = (x: number, cy: number, z: number, width: number, height: number, depth: number, color: number) => {
    walls.add(box(width, height, depth), color, M(x, cy, z), { ao: 0.84 });
    const [worldX, worldZ] = housePoint(p, x, z);
    colliders.addBox(worldX, y + cy, worldZ, width, height, depth, p.yaw);
  };

  solid(0, groundH / 2 - 0.15, 0, w, groundH + 0.3, p.depth, p.wall);
  walls.add(box(w + 0.13, 0.50, p.depth + 0.13), 0xb9a383, M(0, 0.15, 0));
  // 手前の低い屋根を庇兼足場に残し、その奥だけを職人の住居にする。
  solid(0, groundH + 0.10, 0, w + 0.30, 0.20, p.depth + 0.30, p.trim);
  const upperFront = front - UPPER_SETBACK, upperW = w - 0.48, upperDepth = p.depth - 1.06;
  solid(0, groundH + 1.32, -0.33, upperW, 2.25, upperDepth, LIME);
  solid(0, h + 0.11, -0.33, upperW + 0.30, 0.22, upperDepth + 0.32, p.trim);
  const windowY = groundH + 1.34;
  for (const x of [-w * 0.21, w * 0.21]) {
    windowBay(walls, detail, x, windowY, upperFront, 0, p.trim);
  }
  windowBay(walls, detail, 0, windowY, -front + 0.20, Math.PI, p.trim);
  for (const side of [-1, 1]) {
    windowBay(walls, detail, side * upperW / 2, windowY, -0.33, side * Math.PI / 2, p.trim);
  }
  walls.add(box(1.38, 2.40, 0.14), LIME, M(door, 1.23, front + 0.045));
  walls.add(box(1.10, 2.21, 0.12), p.trim, M(door, 1.13, front + 0.13));
  detail.add(box(0.12, 0.12, 0.13), 0xd7b367, M(door + 0.38, 1.02, front + 0.23));
  walls.add(box(1.80, 0.05, 1.48), 0xc8b493, M(door, 0.01, front + 0.74));
  const approach = Math.max(0, doorstepToWalk(lane, p) - front - 1.48);
  const stones = Math.ceil(approach / 0.75);
  for (let i = 0; i < stones; i++) {
    const stride = approach / stones;
    walls.add(box(1.42, 0.06, stride * 0.95), i % 2 ? 0xd6bc91 : 0xc4ac89, M(door, 0.038, front + 1.48 + stride * (i + 0.5)));
  }
  windowBay(walls, detail, -w * 0.23, 2.0, front, 0, p.trim);
  windowBay(walls, detail, w / 2, 1.7, -0.1, Math.PI / 2, p.trim);
  windowBay(walls, detail, -w / 2, 1.7, 0, -Math.PI / 2, p.trim);
  windowBay(walls, detail, 0, 1.7, -front, Math.PI, p.trim);

  const workX = -w * 0.24, workZ = front + 0.92;
  if (p.trade === 'washhouse' || p.trade === 'dyer') {
    // 水栓の付いた洗い台と、染料の甕を置いた木の作業台。
    if (p.trade === 'washhouse') {
      solid(workX, 0.38, workZ, 2.3, 0.76, 0.96, 0xbab5a3);
      walls.add(box(1.98, 0.04, 0.67), 0x55a6a9, M(workX, 0.775, workZ));
      detail.add(cyl(0.06, 0.06, 0.62, 7), 0xb59154, M(workX - 0.70, 1.01, workZ - 0.29));
      detail.add(box(0.12, 0.14, 0.30), 0xb59154, M(workX - 0.70, 1.27, workZ - 0.18));
    } else {
      solid(workX, 0.40, workZ, 2.20, 0.80, 0.94, WOOD);
      for (const side of [-1, 1]) {
        vessel(detail, workX + side * 0.50, 0.80, workZ, 0.45, 0.54, side > 0 ? 0x344b75 : 0x73546c);
      }
    }
    // 壁から物干しを張り出し、洗濯物は仕事場の上に干す。
    const z = front + 1.38;
    for (const side of [-1, 1]) {
      detail.add(box(0.10, 0.10, 1.42), WOOD, M(workX + side * 1.42, 2.97, front + 0.70));
    }
    detail.add(cyl(0.035, 0.035, 3.02, 5).rotateZ(Math.PI / 2), TIMBER, M(workX, 2.98, z));
    const colors = p.trade === 'washhouse' ? [0xfcf0c6, 0x80c2bd, 0xf3d48c] : [0x36578c, 0x8c7197, 0x4c838e];
    colors.forEach((color, i) => cloth(detail, workX + (i - 1) * 0.84, 2.96, z, 0.67, 0.68 + i * 0.14, color));
  } else if (p.trade === 'potter' || p.trade === 'bakery') {
    // 道に面したレンガの窯と、焼き上がった品を出す棚。
    solid(workX, 0.69, workZ, 1.76, 1.38, 1.32, 0xb87653);
    walls.add(cyl(0.58, 0.82, 0.42, 10), 0xb76c50, M(workX, 1.57, workZ));
    walls.add(box(0.76, 0.59, 0.05), 0x463b37, M(workX, 0.86, workZ + 0.68));
    for (const side of [-1, 1]) detail.add(box(0.14, 0.70, 0.14), 0xe2ae7c, M(workX + side * 0.45, 0.86, workZ + 0.70));
    detail.add(box(1.06, 0.20, 0.18), 0xe2ae7c, M(workX, 1.22, workZ + 0.70));
    solid(-w * 0.27, h + 0.80, -0.80, 0.61, 1.28, 0.68, 0xb67b5e);
    walls.add(box(0.81, 0.19, 0.86), p.trim, M(-w * 0.27, h + 1.48, -0.80));
    const shelfX = workX - 1.42;
    solid(shelfX, 0.40, workZ, 0.90, 0.80, 1.42, WOOD);
    if (p.trade === 'potter') {
      vessel(detail, shelfX, 0.80, workZ - 0.31, 0.31, 0.61, 0x528b94);
      vessel(detail, shelfX + 0.05, 0.80, workZ + 0.40, 0.25, 0.32, 0xbf7959);
    } else {
      for (let i = 0; i < 3; i++) {
        detail.add(new THREE.IcosahedronGeometry(0.28, 0), 0xd89449, M(shelfX, 0.98, workZ + (i - 1) * 0.39, 0.16, 1.3, 0.68, 0.75));
      }
    }
  } else if (p.trade === 'nursery') {
    solid(workX, 0.27, workZ, 2.45, 0.54, 1.42, TERRACOTTA);
    walls.add(box(2.23, 0.04, 1.20), 0x624537, M(workX, 0.55, workZ));
    for (let i = 0; i < 6; i++) {
      const x = workX + ((i % 3) - 1) * 0.69, z = workZ + (Math.floor(i / 3) - 0.5) * 0.50;
      detail.add(new THREE.IcosahedronGeometry(0.24, 0), i % 2 ? 0x79a655 : 0x548052, M(x, 0.74, z, i, 1.08, 1.44, 0.96));
    }
    for (const side of [-1, 1]) detail.add(box(0.07, 1.98, 0.07), WOOD, M(workX + side * 1.08, 1.50, workZ - 0.46));
    for (let i = 0; i < 3; i++) detail.add(box(2.31, 0.07, 0.08), WOOD, M(workX, 1.56 + i * 0.39, workZ - 0.46));
  } else {
    // 灯台のふもとの灯具店。屋上の明かり取りも小さな灯室の形にする。
    solid(0, h + 0.85, -0.65, 1.68, 1.22, 1.56, 0x5898a2);
    for (const side of [-1, 1]) {
      detail.add(box(0.11, 1.26, 1.64), LIME, M(side * 0.78, h + 0.86, -0.65));
      detail.add(box(1.76, 0.12, 1.64), p.trim, M(0, h + 0.85 + side * 0.52, -0.65));
    }
    solid(0, h + 1.53, -0.65, 2.08, 0.20, 1.96, p.trim);
    solid(workX, 0.43, workZ, 2.28, 0.86, 1.0, WOOD);
    for (let i = 0; i < 3; i++) {
      const x = workX + (i - 1) * 0.70, hh = i === 1 ? 0.66 : 0.44;
      detail.add(cyl(0.21, 0.20, hh, 6), 0xffd78a, M(x, 0.92 + hh / 2, workZ));
      detail.add(cyl(0.22, 0.23, 0.09, 6), p.trim, M(x, 0.90, workZ));
      detail.add(cyl(0.07, 0.26, 0.19, 6), p.trim, M(x, 1.0 + hh, workZ));
    }
  }
}


/** 歩道と低い石塀。玄関と共同庭だけを開け、灯台坂では郵便局からの分岐も空ける。 */
function frontWalls(lane: Lane, batch: GeoBatch, detail: GeoBatch, colliders: Colliders): void {
  const r = ROADS[lane], yaw = Math.atan2(-r.dz, r.dx);
  const bays: [number, number, number][] = lane === 'south' ? [
    [-1, 2.8, 8.5], [-1, 11.6, 18.0], [-1, 21.6, 31.0], [-1, 34.0, 45.2],
    [1, 3.5, 15.7], [1, 18.8, 25.1], [1, 29.2, 38.5], [1, 41.8, 45.2],
  ] : [[-1, 25.2, 29.8], [-1, 37, 45.6], [1, 43.3, 46.1]];
  for (const side of [-1, 1]) {
    const [x, z] = roadPoint(lane, (r.start + r.end) / 2, side * (r.half + 0.91));
    const y = heightAt(x, z), base = M(x, y, z, yaw);
    batch.setBase(base);
    detail.setBase(base);
    const length = r.end - r.start;
    // 道と同じ高さに敷いた舗装。分岐や門をどの向きにも横切れるよう、足元は地形面を使う。
    batch.add(box(length, 0.04, 1.80), 0xd7c8aa, M(0, -0.006, 0));
    batch.add(box(length, 0.05, 0.18), 0xa79378, M(0, 0.002, -side * 0.83));
    for (let k = 0.6; k < length; k += 1.4) {
      detail.add(box(0.033, 0.016, 1.60), 0xbba68b, M(k - length / 2, 0.013, side * 0.05));
    }
  }
  for (const [side, a, b] of bays) {
    const [x, z] = roadPoint(lane, (a + b) / 2, side * (r.half + 2.02));
    const y = heightAt(x, z), length = b - a;
    const base = M(x, y, z, yaw);
    batch.setBase(base);
    detail.setBase(base);
    batch.add(box(length, 0.56, 0.32), 0xd8c7a4, M(0, 0.26, 0), { ao: 0.78 });
    batch.add(box(length + 0.06, 0.11, 0.39), 0xab7455, M(0, 0.58, 0));
    colliders.addBox(x, y + 0.31, z, length, 0.62, 0.39, yaw);
    // 門柱は塀の上端に収め、門の実際の幅は見た目と揃える。
    for (const dx of [-1, 1]) {
      const px = dx * (length / 2 - 0.20);
      detail.add(box(0.36, 0.55, 0.40), LIME, M(px, 0.28, 0));
      detail.add(box(0.42, 0.12, 0.44), 0xbd8865, M(px, 0.58, 0));
    }
  }
}

/** 2つの門から入る共同庭。棚の日陰に腰掛けられ、向かいの花壇から道越しに見える。 */
function sharedGardens(batch: GeoBatch, detail: GeoBatch, colliders: Colliders): void {
  const r = ROADS.south, yaw = Math.atan2(-r.dz, r.dx);
  for (const [t, across] of [[27.2, 8.7], [19.8, -8.0]]) {
    const [x, z] = roadPoint('south', t, across);
    const y = heightAt(x, z), side = Math.sign(across), base = M(x, y, z, yaw);
    batch.setBase(base);
    detail.setBase(base);
    const block = (lx: number, cy: number, lz: number, w: number, h: number, d: number, color: number) => {
      batch.add(box(w, h, d), color, M(lx, cy, lz));
      const [wx, wz] = roadPoint('south', t + lx, across + lz);
      colliders.addBox(wx, y + cy, wz, w, h, d, yaw);
    };
    block(0, 0.26, 1.34 * side, 4.5, 0.52, 0.61, 0xb6a386);
    batch.add(box(4.58, 0.07, 0.70), WOOD, M(0, 0.54, 1.34 * side));
    if (side > 0) {
      for (const dx of [-1.90, 1.90]) {
        for (const dz of [-1, 1]) block(dx, 1.36, dz, 0.14, 2.72, 0.14, TIMBER);
        batch.add(box(0.16, 0.24, 2.65), WOOD, M(dx, 2.76, 0));
      }
      // 簀の子の隙間は足幅より小さい。影が庭に縞を落とす。
      for (let i = 0; i < 6; i++) {
        batch.add(box(4.42, 0.13, 0.32), i % 2 ? 0xc39362 : 0xb48658, M(0, 2.94, -1.13 + i * 0.45));
      }
      colliders.addBox(x, y + 2.90, z, 4.42, 0.20, 2.58, yaw);
      for (let i = 0; i < 5; i++) {
        detail.add(new THREE.IcosahedronGeometry(0.36, 0), i % 2 ? 0x789347 : 0x60843d, M(-1.62 + i * 0.48, 3.01, 0.92, i, 1.6, 0.64, 1.1));
      }
    } else {
      block(0, 0.22, -0.48, 3.34, 0.44, 1.05, 0xc7946d);
      batch.add(box(3.17, 0.04, 0.91), 0x776044, M(0, 0.44, -0.48));
      for (let i = 0; i < 7; i++) {
        const px = -1.30 + i * 0.43, pz = -0.48 + (i % 2 - 0.5) * 0.26;
        batch.add(new THREE.IcosahedronGeometry(0.27, 0), i % 2 ? 0x779447 : 0x629457, M(px, 0.64, pz, i, 1.25, 1.18, 1.12));
        detail.add(new THREE.IcosahedronGeometry(0.12, 0), i % 2 ? 0xe8af5c : 0xc76c54, M(px, 0.90, pz, i, 1, 0.70, 1));
      }
    }
  }
}

export function buildResidentialLane(lane: Lane, walls: GeoBatch, detail: GeoBatch, colliders: Colliders): void {
  for (const house of LANES[lane]) buildHouse(lane, house, walls, detail, colliders);
  frontWalls(lane, walls, detail, colliders);
  if (lane === 'south') sharedGardens(walls, detail, colliders);
}

/** 仕事に合わせた上階の道具は、路地の装飾と同じ近景用バッチに渡す。 */
export function visitArtisanWindows(place: (kind: number, family: number, x: number, y: number, z: number, yaw: number) => void): void {
  const trades: Partial<Record<Trade, [number, number]>> = { washhouse: [0, 0], nursery: [1, 1], dyer: [2, 2], lampmaker: [3, 1] };
  for (const houses of Object.values(LANES)) {
    for (const p of houses) {
      const kit = trades[p.trade];
      if (!kit) continue;
      const [x, z] = housePoint(p, 0, p.depth / 2 - UPPER_SETBACK + 0.03);
      place(kit[0], kit[1], x, heightAt(p.x, p.z) + p.height + 0.49, z, p.yaw);
    }
  }
}
