import * as THREE from 'three';
import type { Colliders } from '../colliders';
import { box, cyl, GeoBatch, M } from '../props';
import { heightAt } from '../terrain';

const X = -34.5, Z = 2.5, YAW = 132 * Math.PI / 180;
const CO = Math.cos(YAW), SI = Math.sin(YAW);

type FloorPoint = [number, number];

function floorPieces(outlines: FloorPoint[][], y: number): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const ring of outlines) {
    for (let i = 1; i < ring.length - 1; i++) {
      for (const [x, z] of [ring[0], ring[i], ring[i + 1]]) positions.push(x, y, z);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

// 平らな石畳の上に、地元の陶片を使った小さな葉模様を描く。中央の通路には段差をつけない。
function layCourtFloor(solid: GeoBatch, detail: GeoBatch): void {
  function cutStone(x0: number, x1: number, z0: number, z1: number, corner: number): FloorPoint[] {
    return [[x0 + corner,z0],[x0,z0 + corner],[x0,z1 - corner],[x0 + corner,z1],
      [x1 - corner,z1],[x1,z1 - corner],[x1,z0 + corner],[x1 - corner,z0]];
  }
  solid.add(floorPieces([cutStone(-3.18, 3.18, -2.1, 2.08, 0.46)], 0.036), 0xac927e);
  solid.add(floorPieces([cutStone(-3.03, 3.03, -1.95, 1.93, 0.40)], 0.043), 0xdfcba8);
  const treads: FloorPoint[][] = [];
  for (let i = 0; i < 4; i++) {
    const x = -3.51 - i * 0.60;
    treads.push(cutStone(x - 0.26, x + 0.26, -0.54 + 0.11 * i, 0.75 + 0.11 * i, 0.10));
  }
  solid.add(floorPieces(treads, 0.042), 0xd6c19e);

  const ribbon: FloorPoint[][] = [], tiles: FloorPoint[][] = [], light: FloorPoint[][] = [];
  for (let i = 0; i < 12; i++) {
    const x = -2.55 + i * 0.41, z = 1.02 + 0.16 * Math.sin(i * 0.49), nz = 1.02 + 0.16 * Math.sin((i + 1) * 0.49);
    ribbon.push([[x,z],[x,z+0.048],[x+0.41,nz+0.048],[x+0.41,nz]]);
    const side = i % 2 === 0 ? 1 : -1;
    const leaf: FloorPoint[] = [[x+0.06,z+side*0.11],[x+0.18,z+side*0.28],[x+0.37,z+side*0.35],[x+0.26,z+side*0.17]];
    (side > 0 ? tiles : light).push(side > 0 ? leaf : leaf.reverse());
  }
  detail.add(floorPieces(ribbon, 0.053), 0x857751);
  detail.add(floorPieces(tiles, 0.054), 0x57968c);
  detail.add(floorPieces(light, 0.054), 0xc47f62);
}

/** 時計塔通りに開いた藤棚。正面と西の石畳から木陰に入り、反対側へ歩き抜けられる。 */
export function buildTownCourtyard(solid: GeoBatch, detail: GeoBatch, colliders: Colliders): void {
  const y = heightAt(X, Z), frame = M(X, y, Z, YAW);
  solid.setBase(frame);
  detail.setBase(frame);
  function barrier(x: number, cy: number, z: number, w: number, h: number, d: number): void {
    colliders.addBox(X + CO * x + SI * z, y + cy, Z - SI * x + CO * z, w, h, d, YAW);
  }
  function timber(x: number, cy: number, z: number, w: number, h: number, d: number, color: number): void {
    solid.add(box(w, h, d), color, M(x, cy, z), { ao: 0.84 });
  }

  layCourtFloor(solid, detail);
  const oak = 0xa5724e, darkOak = 0x795a45, stone = 0xd6be9c, glaze = 0x457a76;
  for (const x of [-2.38, 2.38]) {
    for (const z of [-1.32, 1.32]) {
      timber(x, 0.18, z, 0.45, 0.28, 0.45, stone);
      timber(x, 0.36, z, 0.36, 0.12, 0.36, glaze);
      timber(x, 1.79, z, 0.22, 2.82, 0.22, oak);
      solid.add(box(0.14, 0.92, 0.14), darkOak, M(x - Math.sign(x) * 0.25, 2.89, z, 0, 1, 1, 1, 0, Math.sign(x) * 0.73));
      barrier(x, 1.62, z, 0.34, 3.24, 0.34);
    }
  }
  for (const z of [-1.32, 1.32]) timber(0, 3.22, z, 5.46, 0.24, 0.20, darkOak);
  for (let i = -3; i <= 3; i++) timber(i * 0.83, 3.41, 0, 0.12, 0.18, 3.38, oak);
  barrier(0, 3.37, 0, 5.45, 0.32, 3.38);

  // 二つの腰掛けを直角に並べて、縦横の出入り口を残す。背板には空気を通す隙間をあける。
  function seat(x: number, z: number, length: number, yaw: number): void {
    const benchFrame = frame.clone().multiply(M(x, 0, z, yaw));
    solid.setBase(benchFrame);
    for (const side of [-1, 1]) {
      timber(side * (length / 2 - 0.40), 0.31, 0, 0.28, 0.50, 0.62, glaze);
      timber(side * (length / 2 - 0.40), 0.79, -0.28, 0.13, 0.63, 0.13, darkOak);
    }
    for (const oz of [-0.23, 0, 0.23]) timber(0, 0.59, oz, length, 0.12, 0.20, 0xbf8b61);
    for (const h of [0.83, 1.04]) timber(0, h, -0.29, length - 0.10, 0.13, 0.08, oak);
    solid.setBase(frame);
    const bx = X + x * CO + z * SI, bz = Z - x * SI + z * CO, facing = YAW + yaw;
    colliders.addBox(bx, y + 0.325, bz, length, 0.65, 0.66, facing);
    colliders.addBox(bx - Math.sin(facing) * 0.29, y + 0.88, bz - Math.cos(facing) * 0.29, length - 0.1, 0.46, 0.08, facing);
  }
  seat(-0.89, -1.32, 2.45, 0);
  seat(2.27, -0.03, 1.67, -Math.PI / 2);

  // つる棚の角に釉薬の雨水甕。鎖が水を案内し、上からのぞくと水面と甕の厚い縁が見える。
  const jx = 1.61, jz = -1.38;
  const profile = [[0.28,0.06],[0.42,0.16],[0.53,0.51],[0.50,0.85],[0.38,1.01],[0.40,1.12],[0.33,1.12],[0.32,1.02]];
  solid.add(new THREE.LatheGeometry(profile.map(([r,h]) => new THREE.Vector2(r,h)), 10), glaze, M(jx, 0, jz),
    { ao: 0.67, top: 0x74ad9a });
  detail.add(cyl(0.32, 0.32, 0.02, 10), 0x6db6bb, M(jx, 1.015, jz));
  detail.add(cyl(0.018, 0.018, 2.1, 5), 0x997b52, M(jx, 2.07, jz));
  for (const h of [1.42, 1.89, 2.36, 2.83]) {
    detail.add(cyl(0.095, 0.038, 0.13, 6, 1, true), 0xb38559, M(jx, h, jz));
  }
  colliders.addCyl(X + jx * CO + jz * SI, Z - jx * SI + jz * CO, y, y + 1.12, 0.5);

  addFloweringVine(solid, detail);
  solid.base.identity();
  detail.base.identity();
}

function addFloweringVine(solid: GeoBatch, detail: GeoBatch): void {
  type Point = [number, number, number];
  type Faces = Map<number, number[]>;
  const canopy: Faces = new Map();
  const close: Faces = new Map();
  const greens = [0x749253, 0x95a864, 0x64896a, 0x87a167];
  const flowers = [
    [0xb282a7, 0xce94b4, 0xeab9ca],
    [0xad786e, 0xd58f85, 0xecb4a1],
  ];

  // 葉を一枚ずつメッシュにせず、同じ色の面はまとめてバッチに渡す。
  function triangle(faces: Faces, color: number, a: Point, b: Point, c: Point): void {
    let positions = faces.get(color);
    if (!positions) { positions = []; faces.set(color, positions); }
    positions.push(...a, ...b, ...c);
  }

  function wood(path: Point[], segments: number, radius: number): void {
    const curve = new THREE.CatmullRomCurve3(path.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    const frames = curve.computeFrenetFrames(segments, false);
    const rings: Point[][] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const center = curve.getPointAt(t);
      const width = radius * (1 - 0.68 * t);
      const ring: Point[] = [];
      for (let j = 0; j < 3; j++) {
        const angle = j * Math.PI * 2 / 3;
        const p = center.clone().addScaledVector(frames.normals[i], width * Math.cos(angle))
          .addScaledVector(frames.binormals[i], width * Math.sin(angle));
        ring.push([p.x, p.y, p.z]);
      }
      rings.push(ring);
      if (i === 0) continue;
      for (let j = 0; j < 3; j++) {
        const next = (j + 1) % 3;
        const color = j === 0 ? 0x71583d : 0x806345;
        triangle(canopy, color, rings[i - 1][j], rings[i - 1][next], ring[j]);
        triangle(canopy, color, rings[i - 1][next], ring[next], ring[j]);
      }
    }
  }

  for (const side of [-1, 1]) {
    wood([[side * 2.23, 0.04, -1.13], [side * 2.33, 0.78, -1.14], [side * 2.55, 1.54, -1.33],
      [side * 2.31, 2.42, -1.49], [side * 2.19, 3.38, -1.29], [side * 1.52, 3.50, -0.46],
      [side * 1.87, 3.44, 0.46], [side * 1.63, 3.42, 1.29]], 8, 0.116);
    wood([[side * 2.18, 3.32, -1.3], [side * 1.84, 3.51, -1.1],
      [side * 0.70, 3.53, -1.13], [side * 0.05, 3.49, -0.73]], 3, 0.074);
  }

  wood([[-1.66,3.46,1.29],[-2.28,3.37,1.52],[-2.49,2.83,1.38],[-2.32,2.22,1.45],[-2.41,1.64,1.52],[-2.52,1.17,1.34]], 7, 0.076);

  // 蔓の左右の枝に葉が集まる。縁を波打たせて、棚の下からのぞいても厚みが見えるようにする。
  function foliage(x: number, z: number, rx: number, rz: number, seed: number): void {
    const y = 3.49 + 0.055 * Math.sin(seed * 4);
    const axis = seed * 0.35 + 3 * Math.PI / 7;
    const dx = Math.cos(axis) * rx * 0.34, dz = Math.sin(axis) * rz * 0.34;
    const crest: Point = [x + dx, y + 0.15, z + dz];
    const shoulder: Point = [x - dx, y + 0.11, z - dz];
    const underside: Point = [x + rx * 0.21, y - 0.045, z + rz * 0.12];
    const rim: Point[] = [];
    for (let i = 0; i < 7; i++) {
      const angle = i * Math.PI * 2 / 7 + seed * 0.35;
      const length = 0.93 + 0.07 * Math.cos(seed + i * 4);
      const rimZ = z + Math.sin(angle) * rz * length;
      const droop = Math.max(0, rimZ - 1.30) * 0.59;
      rim.push([x + Math.cos(angle) * rx * length, y - 0.054 - droop + 0.08 * Math.cos(angle * 3 + seed), rimZ]);
    }
    for (let i = 0; i < rim.length; i++) {
      const next = (i + 1) % rim.length;
      triangle(canopy, greens[(seed + (i < 2 ? 1 : 0)) % greens.length], i < 3 ? crest : shoulder, rim[next], rim[i]);
      triangle(canopy, i % 3 === 0 ? 0x668457 : 0x799160, underside, rim[i], rim[next]);
    }
    triangle(canopy, greens[seed % greens.length], crest, shoulder, rim[3]);
    triangle(canopy, greens[(seed + 1) % greens.length], shoulder, crest, rim[0]);
  }
  foliage(-1.75, -0.98, 0.85, 0.63, 1);
  foliage(-0.62, -0.96, 0.78, 0.61, 2);
  foliage(0.48, -0.86, 0.83, 0.67, 3);
  foliage(1.64, -1.04, 0.86, 0.56, 4);
  foliage(-1.86, -0.17, 0.64, 0.82, 5);
  foliage(1.64, -0.06, 0.81, 0.86, 6);
  foliage(-1.66, 1.08, 1.07, 1.00, 7);
  foliage(-0.45, 1.17, 0.90, 0.87, 8);
  foliage(1.62, 1.08, 0.96, 0.95, 9);

  // 花軸の周りに花弁を三段ずらして重ね、手前と棚の真下から花房の輪郭を見せる。
  function raceme(faces: Faces, x: number, z: number, length: number, phase: number, palette: number): void {
    const color = flowers[palette];
    for (let row = 0; row < 3; row++) {
      const progress = [0, 0.29, 0.57][row];
      const angle = phase + row * 1.55;
      const cx = x + length * (0.044 * row + 0.035 * Math.cos(angle));
      const cz = z + length * (0.028 * row + 0.034 * Math.sin(angle));
      const cy = 3.46 - length * progress;
      const radius = length * (0.24 - 0.046 * row);
      const top: Point = [cx, cy, cz];
      const dimple: Point = [cx, cy - length * 0.32, cz];
      const hem: Point[] = [];
      for (let j = 0; j < 4; j++) {
        const a = angle + j * Math.PI / 2;
        hem.push([cx + Math.cos(a) * radius, cy - length * (0.395 + 0.043 * Math.sin(a + row)),
          cz + Math.sin(a) * radius]);
      }
      for (let j = 0; j < 4; j++) {
        const next = (j + 1) % 4;
        triangle(faces, color[j % 3 === 0 ? Math.max(0, row - 1) : row], top, hem[next], hem[j]);
        triangle(faces, color[Math.min(2, row + 1)], dimple, hem[j], hem[next]);
      }
    }
  }
  raceme(canopy, -2.08, 0.72, 0.60, 1.3, 0);
  raceme(canopy, -1.38, 1.32, 0.79, 0.2, 0);
  raceme(canopy, -0.66, 1.30, 0.51, 1.8, 1);
  raceme(canopy, 1.38, 0.97, 0.67, 2.4, 0);
  raceme(canopy, 2.09, 1.1, 0.54, 1.6, 1);
  raceme(close, -1.68, 1.28, 0.52, 2, 0);
  raceme(close, -1.02, 1.22, 0.62, 1.2, 0);
  raceme(close, 1.66, 1.25, 0.76, 0.4, 0);
  raceme(close, 1.98, 0.35, 0.48, 2.2, 1);
  raceme(close, -1.88, -0.53, 0.54, 0.1, 1);
  raceme(close, 0.45, -0.82, 0.62, 1.6, 0);

  // ひと筋の葉柄から小葉が三対。葉の裏と折り目は、棚の下からも上階からも見える。
  function spray(x: number, z: number, yaw: number, size: number, seed: number, y = 3.53, faces = close): void {
    const alongX = Math.cos(yaw), alongZ = Math.sin(yaw);
    function point(along: number, across: number, height: number): Point {
      return [x + size * (along * alongX - across * alongZ), y + (height - along * 0.61) * size,
        z + size * (along * alongZ + across * alongX)];
    }
    const start = point(0, 0, 0);
    const end = point(0.97, 0.015, -0.35);
    const side = point(0.30, 0.031, -0.06);
    triangle(faces, 0x798553, start, end, side);
    triangle(faces, 0x798553, start, side, end);
    for (let row = 0; row < 3; row++) {
      for (const sign of [-1, 1]) {
        const t = 0.09 + row * 0.235 + (sign > 0 ? 0.065 : 0);
        const w = 0.37 - 0.055 * row;
        const base = point(t, 0, -t * t * 0.37);
        const tip = point(t + 0.29, sign * w, -t * t * 0.37 - w * 0.65);
        const ridge = point(t + 0.13, sign * w * 0.52, -t * t * 0.37 + 0.045);
        const flank = point(t + 0.052, sign * w * 0.75, -t * t * 0.37 - 0.035);
        const other = point(t + 0.23, sign * w * 0.33, -t * t * 0.37 - 0.055);
        const tint = greens[(seed + row) % greens.length];
        for (const [a, b, c] of [[base, flank, ridge], [flank, tip, ridge], [ridge, tip, other], [base, ridge, other]]) {
          const color = a === flank || b === flank ? 0x86a361 : tint;
          triangle(faces, color, a, b, c);
          triangle(faces, color, a, c, b);
        }
      }
    }
  }
  spray(-2.06, 1.42, 1.9, 0.79, 0);
  spray(-1.32, 1.36, 1.50, 0.76, 1);
  spray(-0.75, 1.56, 0.67, 0.89, 2);
  spray(1.18, 1.40, 2.06, 0.86, 1);
  spray(1.84, 1.46, 1.08, 0.74, 2);
  spray(1.93, -0.06, 0.38, 0.66, 0);
  spray(0.21, -0.76, 1.04, 0.67, 3);
  spray(-1.81, -0.52, 2.84, 0.70, 2);

  spray(-2.42, 1.52, -2.9, 0.84, 2, 2.83, canopy);
  spray(-2.32, 1.45, 0.34, 0.95, 3, 2.24, canopy);
  spray(-2.41, 1.52, 3.04, 0.76, 0, 1.66, canopy);
  spray(2.44, -1.22, -0.09, 0.85, 1, 1.71);
  spray(-2.39, -1.22, 2.90, 0.78, 1, 2.13);

  // 手入れした植え込みが土間と路面の境をなぞる。踏み石と後ろの抜け道の口を左右に空ける。
  const beds = [
    [-2.90, -0.96, 0.52, 0.89], [-2.77, 1.41, 0.57, 0.47], [-1.96, 1.80, 0.60, 0.32],
    [2.70, 1.41, 0.55, 0.60], [2.87, 0.40, 0.42, 0.62], [2.78, -0.77, 0.58, 0.76],
    [2.01, -1.93, 0.78, 0.35], [-1.47, -1.88, 0.84, 0.38],
  ];
  const soil: FloorPoint[][] = [];
  for (const [index, [x, z, w, d]] of beds.entries()) {
    const rim: FloorPoint[] = [];
    for (let j = 0; j < 8; j++) {
      const a = -j * Math.PI / 4 + index * 0.4;
      rim.push([x + w * Math.cos(a), z + d * Math.sin(a)]);
    }
    soil.push(rim);
    for (let j = 0; j < 9; j++) {
      const a = j * 2.40 + index, c = Math.cos(a), s = Math.sin(a);
      const ox = x + w * 0.35 * c, oz = z + d * 0.34 * s;
      const reach = 0.30 + 0.09 * (j % 3), width = 0.12 + 0.03 * (j % 2);
      const root: Point = [ox,0.075,oz], tip: Point = [ox+c*reach,0.18+(j%3)*0.06,oz+s*reach];
      const h = 0.35 + 0.12 * (j % 4);
      const fold: Point = [ox + c * reach * 0.52,h,oz + s * reach * 0.52];
      const l: Point = [fold[0] - s * width,h*0.79,fold[2] + c * width];
      const r: Point = [fold[0] + s * width,h*0.79,fold[2] - c * width];
      for (const [a,b] of [[root,l],[l,tip],[tip,r],[r,root]]) {
        triangle(canopy, greens[(j + index) % 4], a, b, fold);
      }
    }
    for (let j = 0; j < 3; j++) {
      const a = index + j * 2.40;
      const tx = x + 0.37 * w * Math.cos(a), tz = z + 0.46 * d * Math.sin(a);
      const bottom: Point = [tx, 0.07, tz], h = 0.42 + 0.12 * j;
      const center: Point = [tx + 0.05, h, tz];
      const low: Point = [tx+0.014,0.09,tz+0.022];
      triangle(close, 0x5e7847, bottom, low, center);
      triangle(close, 0x5e7847, bottom, center, low);
      for (let k = 0; k < 5; k++) {
        const theta = a + k * 2 * Math.PI / 5;
        const fx = Math.cos(theta), fz = Math.sin(theta);
        const l: Point = [center[0]+fx*0.09-fz*0.046,h+0.035,tz+fz*0.09+fx*0.046];
        const r: Point = [center[0]+fx*0.09+fz*0.046,h+0.035,tz+fz*0.09-fx*0.046];
        triangle(close, [0xf4c48b,0xf6e1bc,0xc497b8][index % 3], center, l, r);
      }
    }
  }
  solid.add(floorPieces(soil, 0.056), 0xa68c64);

  function flush(batch: GeoBatch, faces: Faces): void {
    for (const [color, positions] of faces) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      batch.add(geometry, color);
    }
  }
  flush(solid, canopy);
  flush(detail, close);
}
