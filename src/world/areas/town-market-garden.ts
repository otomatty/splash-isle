import * as THREE from 'three';
import type { Colliders } from '../colliders';
import { box, cyl, GeoBatch, M, sph } from '../props';
import { heightAt } from '../terrain';

const TIMBER = 0xb18753, SAGE = 0x44785e, LEAF = 0x41805b, NEW_LEAF = 0x9eb655;
const POT = 0xc66d4e, BUTTER = 0xf5cc67, CREAM = 0xffe1aa;

// 中央に折り目があり、先が少し前へ垂れる葉と、色づいた苞に共用する。
function leafBlade(w: number, h: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, -w / 2, h * 0.49, 0, 0, h * 0.56, w * 0.29, w / 2, h * 0.51, 0, 0, h, w * 0.25,
  ], 3));
  const face = [0, 2, 1, 0, 3, 2, 1, 2, 4, 2, 3, 4];
  geo.setIndex(face.concat(face.slice().reverse()));
  // 裏表で頂点を分け、それぞれの面に光が当たるようにする。
  const flat = geo.toNonIndexed();
  geo.dispose();
  flat.computeVertexNormals();
  return flat;
}

// 手前に少し反った花弁を輪に並べる。一輪の表裏を一つの部品としてまとめる。
function corolla(petals: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i < petals; i++) {
    const a = i * Math.PI * 2 / petals;
    const point = (across: number, out: number, lip: number) => [
      across * Math.cos(a) - out * Math.sin(a), across * Math.sin(a) + out * Math.cos(a), lip,
    ];
    const root = point(0, 0, 0), fold = point(0, 0.58, 0.13);
    const spread = Math.sin(Math.PI / petals) * 0.93;
    const left = point(-spread, 0.68, 0.29), right = point(spread, 0.68, 0.29);
    const roundL = point(-spread * 0.52, 0.95, 0.35), roundR = point(spread * 0.43, 1, 0.31);
    for (const [u, v] of [[root, right], [right, roundR], [roundR, roundL], [roundL, left], [left, root]]) {
      pos.push(...u, ...v, ...fold, ...fold, ...v, ...u);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

const buckets = [
  { x: -1.78, y: 0.25, z: 0.14, color: 0x77928a, width: 0.86, depth: 0.77 },
  { x: -0.94, y: 0.10, z: 0.57, color: 0x4d8581, width: 0.79, depth: 0.72 },
  { x: -0.13, y: 0.47, z: 0.04, color: 0x77928a, width: 0.86, depth: 0.75 },
];

function bouquets(b: GeoBatch, detail: GeoBatch): void {
  // 背の高い橙色の苞、その手前の芙蓉、段上の小花。高さと向きをずらし茎元を桶に収める。
  for (const [index, p] of buckets.entries()) {
    b.add(cyl(0.29, 0.21, 0.47, 8), p.color, M(p.x, p.y + 0.235, p.z), { ao: 0.68 });
    b.add(cyl(0.31, 0.29, 0.054, 8), CREAM, M(p.x, p.y + 0.46, p.z));
    b.add(cyl(0.267, 0.267, 0.018, 8), 0x345f50, M(p.x, p.y + 0.494, p.z));
    for (let i = 0; i < 4; i++) {
      b.add(leafBlade(0.16, 0.40 - 0.043 * i), i % 2 ? 0x547f43 : LEAF,
        M(p.x, p.y + 0.48, p.z, i * 2.12 + index, 1, 1, 1, 0.92 + i * 0.09));
    }
    for (let i = 0; i < 3; i++) {
      const dx = [-0.24, 0.02, 0.25][i], dz = [0.07, -0.04, 0.12][i];
      const length = [0.71, 0.94, 0.62][i] * (index === 2 ? 0.83 : 1);
      const startY = p.y + 0.42, hx = p.x + dx, hy = startY + length, hz = p.z + dz;
      const stem = new THREE.Vector3(dx, length, dz);
      const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), stem.clone().normalize());
      b.add(cyl(0.019, 0.029, stem.length(), 5).applyQuaternion(rotation), LEAF,
        M(p.x + dx / 2, startY + length / 2, p.z + dz / 2));
      b.add(leafBlade(0.18, 0.39), i % 2 ? NEW_LEAF : LEAF,
        M(p.x + dx * 0.32, startY + length * 0.32, p.z + dz * 0.32, i * 0.77, 1, 1, 1, 0.30, i % 2 ? -0.77 : 0.76));
      if (index === 0) {
        for (let k = 0; k < 3; k++) {
          const side = (k + i) % 2 ? 1 : -1;
          b.add(leafBlade(0.13, 0.28 - k * 0.03), k === 2 ? BUTTER : k === 1 ? 0xff974c : 0xd9574a,
            M(hx, hy - 0.22 + k * 0.11, hz, i * 0.26, 1, 1, 1, 0.24, side * 0.82));
        }
      } else {
        const size = (index === 1 ? 0.22 : 0.17) * (i === 1 ? 1.10 : 1);
        const flowerColor = index === 1 ? [0xec7182, 0xdf5169, 0xf3958f][i] : [0xffeabc, 0xf3c951, 0xffedce][i];
        const bloom = M(hx, hy, hz, dx * 1.8, size, size, size, -0.45 - 0.12 * i, i * 0.61);
        b.add(corolla(index === 1 ? 5 : 7), flowerColor, bloom);
        b.add(sph(0.26, 6, 3), index === 1 ? BUTTER : 0xbd7638, bloom.clone().multiply(M(0, 0, 0.21, 0, 1, 1, 0.8)));
      }
      detail.add(leafBlade(0.10, 0.25), 0x66915a,
        M(p.x + dx * 0.53, startY + length * 0.53, p.z + dz * 0.53, i * 1.15, 1, 1, 1, 0.35, i % 2 ? 0.9 : -0.8));
    }
  }
}

// 背板のアーチは再生木材。つるを左から渡し、日陰の端に吊り鉢を下げる。
function trellis(b: GeoBatch, detail: GeoBatch): void {
  const spring = 1.56, rise = 1.18, half = 2.31, z = -0.64;
  for (const side of [-1, 1]) {
    b.add(box(0.14, spring, 0.16), SAGE, M(side * half, spring / 2, z));
    b.add(box(0.28, 0.27, 0.30), TIMBER, M(side * half, 0.135, z));
  }
  const arch = (a: number) => new THREE.Vector2(half * Math.cos(a), spring + rise * Math.sin(a));
  for (let i = 0; i < 12; i++) {
    const lo = arch(i * Math.PI / 12), hi = arch((i + 1) * Math.PI / 12);
    b.add(box(lo.distanceTo(hi) + 0.025, 0.13, 0.16), SAGE,
      M((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, z, 0, 1, 1, 1, 0, Math.atan2(hi.y - lo.y, hi.x - lo.x)));
  }
  for (const x of [-1.6, -0.8, 0, 0.8, 1.6]) {
    const tall = spring + rise * Math.sqrt(1 - (x / half) ** 2) - 0.04;
    detail.add(box(0.057, tall, 0.065), TIMBER, M(x, tall / 2, z - 0.025));
  }
  for (const h of [0.73, 1.17, 1.60, 2.03]) {
    const w = h < spring ? 4.61 : 2 * half * Math.sqrt(1 - ((h - spring) / rise) ** 2);
    b.add(box(w, 0.06, 0.075), TIMBER, M(0, h, z));
  }
  for (let i = 0; i < 16; i++) {
    const a = 1.36 + (i / 15) * 1.72, p = arch(a), tilt = 0.2 + i * 0.79;
    b.add(leafBlade(0.29, 0.41), i % 3 === 1 ? NEW_LEAF : LEAF,
      M(p.x, p.y, z + 0.09, 0.3 * Math.sin(i), 1, 1, 1, 0.23, tilt));
    if (i % 2 === 0) {
      detail.add(corolla(4), i % 4 ? 0xc55d93 : 0xf293a2, M(p.x + 0.08, p.y + 0.06, z + 0.13, 0.1, 0.145, 0.145, 0.145, -0.23, tilt));
    }
  }
  // 吊り鉢のひもは縁の両端からフックに集める。
  const hangX = 1.56, top = spring + rise * Math.sqrt(1 - (hangX / half) ** 2);
  for (const side of [-1, 1]) {
    b.add(box(0.028, 0.53, 0.029), TIMBER, M(hangX + side * 0.115, top - 0.23, z + 0.12, 0, 1, 1, 1, -0.18, side * 0.46));
  }
  b.add(cyl(0.26, 0.17, 0.24, 9), POT, M(hangX, top - 0.57, z + 0.18));
  b.add(sph(0.22, 8, 4), LEAF, M(hangX, top - 0.44, z + 0.18, 0, 1.18, 0.69, 0.96));
  for (let i = 0; i < 3; i++) {
    const dx = hangX - 0.18 + i * 0.18, len = i === 1 ? 0.46 : 0.31;
    b.add(leafBlade(0.12, len), i % 2 ? NEW_LEAF : LEAF,
      M(dx, top - 0.43, z + 0.33, i * 0.27, 1, 1, 1, -0.24, 2.85 + i * 0.25));
    for (let k = 0; k < 3; k++) {
      const size = 0.13 - k * 0.024;
      detail.add(corolla(5), k % 2 ? 0xa478c5 : 0x875d9e,
        M(dx + 0.06 * Math.sin(i + k * 2), top - 0.45 - len * (k + 1) / 3, z + 0.36, 0.15, size, size, size, 0.23, i));
    }
  }
}

/** 噴水広場の北側。表の切り花桶、段違いの台、苗と水差しをまとめる。 */
export function buildMarketFlorist(b: GeoBatch, detail: GeoBatch, colliders: Colliders): void {
  const x = -1.05, z = -14.30, y = heightAt(x, z), base = M(x, y, z);
  b.setBase(base);
  detail.setBase(base);
  // 棚板と桶の足元は実体のある木箱。地面のスミが足元に残らない。
  const plinth = (cx: number, cz: number, w: number, h: number, d: number) => {
    b.add(box(w, h, d), TIMBER, M(cx, h / 2, cz), { ao: 0.73 });
    b.add(box(w + 0.04, 0.065, d + 0.04), 0xd1a976, M(cx, h - 0.035, cz));
    if (h > 0.19) {
      for (const side of [-1, 1]) b.add(box(0.08, h - 0.07, 0.045), 0x997449, M(cx + side * (w / 2 - 0.07), (h - 0.07) / 2, cz + d / 2));
      detail.add(box(w - 0.15, 0.024, 0.04), 0x9b764c, M(cx, h * 0.44, cz + d / 2));
    }
    colliders.addBox(x + cx, y + h / 2, z + cz, w, h, d);
  };
  for (const p of buckets) {
    plinth(p.x, p.z, p.width, p.y, p.depth);
    colliders.addCyl(x + p.x, z + p.z, y + p.y, y + p.y + 0.48, 0.28);
  }
  trellis(b, detail);
  colliders.addBox(x, y + 0.82, z - 0.64, 4.76, 1.64, 0.18);
  bouquets(b, detail);
  // 育苗台。土にさした品種札、左右に開きたての葉と、使いかけのじょうろ。
  b.add(box(1.78, 0.13, 0.94), 0xb88d62, M(1.40, 0.665, 0.07));
  b.add(box(1.61, 0.09, 0.77), TIMBER, M(1.40, 0.14, 0.07));
  for (const px of [0.65, 2.15]) {
    for (const pz of [-0.29, 0.43]) b.add(box(0.12, 0.64, 0.13), SAGE, M(px, 0.32, pz));
  }
  colliders.addBox(x + 1.40, y + 0.365, z + 0.07, 1.78, 0.73, 0.94);
  // 棚の下に包み紙と折り返した用土袋。種の封筒は手に取りやすい浅い箱に立てる。
  b.add(sph(0.27, 8, 5), 0xd1b489, M(0.97, 0.35, 0.13, 0.2, 1.14, 0.66, 0.8));
  b.add(box(0.37, 0.072, 0.16), CREAM, M(0.96, 0.51, 0.12, -0.14));
  b.add(box(0.66, 0.17, 0.44), SAGE, M(1.76, 0.265, 0.14));
  for (let i = 0; i < 3; i++) {
    const sx = 1.53 + 0.19 * i;
    detail.add(box(0.18, 0.22, 0.042), i % 2 ? 0xe18f80 : CREAM, M(sx, 0.41, 0.17, 0, 1, 1, 1, -0.12, i * 0.07));
    detail.add(leafBlade(0.067, 0.10), LEAF, M(sx, 0.375, 0.208, 0, 1, 1, 1, 0, -0.3));
  }
  for (const px of [0.91, 1.48]) {
    b.add(cyl(0.23, 0.16, 0.29, 8), POT, M(px, 0.875, 0.03));
    b.add(cyl(0.245, 0.24, 0.07, 8), 0xd8825e, M(px, 1.00, 0.03));
    b.add(cyl(0.213, 0.213, 0.02, 8), 0x6f5142, M(px, 1.04, 0.03));
    for (let i = 0; i < 5; i++) {
      const turn = i * 2.40 + px;
      b.add(leafBlade(0.14, 0.40), i % 2 ? SAGE : NEW_LEAF, M(px, 1.04, 0.03, turn, 1, 1, 1, 0.65 + i * 0.07));
    }
    detail.add(box(0.05, 0.33, 0.037), CREAM, M(px + 0.13, 1.19, -0.08, 0, 1, 1, 1, 0, -0.17));
    detail.add(box(0.18, 0.105, 0.04), BUTTER, M(px + 0.16, 1.34, -0.08, 0, 1, 1, 1, 0, -0.17));
  }
  b.add(cyl(0.145, 0.16, 0.27, 9), 0x548b8b, M(2.01, 0.865, 0.12));
  b.add(new THREE.TorusGeometry(0.124, 0.023, 5, 10), 0x638781, M(2.01, 1.04, 0.12));
  b.add(cyl(0.043, 0.071, 0.28, 6), 0x548b8b, M(2.20, 0.93, 0.12, 0, 1, 1, 1, 0, -0.88));
  b.add(cyl(0.069, 0.042, 0.07, 7), CREAM, M(2.31, 1.02, 0.12, 0, 1, 1, 1, 0, -0.88));
}
