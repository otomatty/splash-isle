import * as THREE from 'three';
import type { Colliders } from '../colliders';
import { GeoBatch, M, cyl } from '../props';
import { heightAt } from '../terrain';

type Limb = [x: number, y: number, z: number, radius: number];
type Crown = [x: number, y: number, z: number, width: number, height: number, depth: number];
const up = new THREE.Vector3(0, 1, 0);

// 筋が緩くねじれる幹。根元の張りから枝先まで繋いだ輪を使い、枝分かれに角を残さない。
function wood(points: Limb[], sides: number): THREE.BufferGeometry {
  const vertices: number[] = [], indices: number[] = [];
  const orientation = new THREE.Quaternion(), axis = new THREE.Vector3(), p = new THREE.Vector3();
  for (let j = 0; j < points.length; j++) {
    const [x, y, z, r] = points[j], before = points[Math.max(0, j - 1)], after = points[Math.min(j + 1, points.length - 1)];
    axis.set(after[0] - before[0], after[1] - before[1], after[2] - before[2]).normalize();
    orientation.setFromUnitVectors(up, axis);
    for (let i = 0; i < sides; i++) {
      const a = i * 2 * Math.PI / sides + 0.09 * j;
      const groove = r * (1 + 0.12 * Math.cos(i * 3 + j * 0.55));
      p.set(Math.cos(a) * groove, 0, Math.sin(a) * groove).applyQuaternion(orientation);
      vertices.push(x + p.x, y + p.y, z + p.z);
      if (j === 0) continue;
      const lo = (j - 1) * sides + i, next = (j - 1) * sides + (i + 1) % sides;
      indices.push(lo, lo + sides, next, next, lo + sides, next + sides);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// 横に広がる枝ごとに、葉の塊の下面を少し持ち上げ、外縁に不規則な房を出す。
function leafCrown(seed: number): THREE.BufferGeometry {
  const vertices = [0, -0.61, 0], indices: number[] = [];
  const rings = [[0.48, -0.46], [0.88, -0.19], [1, 0.07], [0.79, 0.38], [0.34, 0.61]];
  const n = 12;
  for (const [j, [radius, h]] of rings.entries()) {
    for (let i = 0; i < n; i++) {
      const a = i * Math.PI * 2 / n + seed * 0.4;
      const tuft = Math.cos(5 * a - seed + 0.4 * j);
      const r = radius * (1 + 0.12 * Math.sin(3 * a + seed) + 0.15 * tuft);
      vertices.push(Math.cos(a) * r, h + radius * (0.12 * tuft + 0.10 * Math.cos(3 * a + j * 0.7)), Math.sin(a) * r);
      const k = 1 + j * n + i, next = 1 + j * n + (i + 1) % n;
      if (j === 0) indices.push(0, k, next);
      else indices.push(k - n, k, next - n, next - n, k, next);
    }
  }
  const top = vertices.length / 3;
  vertices.push(-0.05, 0.68, 0.04);
  for (let i = 0; i < n; i++) indices.push(top - n + i, top, top - n + (i + 1) % n);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

const oliveCanopy: Crown[] = [
  [-2.00, 3.67, 0.52, 1.61, 0.98, 1.31], [-1.32, 4.24, -0.62, 1.77, 1.14, 1.47],
  [-0.42, 4.60, 0.37, 1.69, 1.24, 1.34], [0.98, 4.42, -0.73, 1.56, 1.06, 1.39],
  [1.58, 3.93, 0.46, 1.34, 0.95, 1.20], [0.34, 4.04, 1.12, 1.36, 0.94, 1.12],
];
const jacarandaCanopy: Crown[] = [
  [-1.72, 3.88, -0.14, 1.46, 1.03, 1.37], [-0.80, 4.54, 0.82, 1.40, 1.18, 1.31],
  [-0.21, 4.86, -0.48, 1.59, 1.24, 1.44], [1.26, 4.66, 0.52, 1.64, 1.08, 1.39],
  [2.10, 4.04, -0.32, 1.49, 0.93, 1.18],
];

/** 広場の外周の空き地にオリーブとジャカランダ。歩道側の枝は頭上に逃がす。 */
export function buildPlazaTrees(matte: GeoBatch, detail: GeoBatch, colliders: Colliders): void {
  for (const [tree, crowns] of [oliveCanopy, jacarandaCanopy].entries()) {
    const olive = tree === 0, x = olive ? -11.5 : 13.1, z = olive ? -2.2 : -4.6;
    const y = heightAt(x, z), base = M(x, y, z, olive ? -0.18 : 0.24);
    matte.setBase(base);
    detail.setBase(base);

    // 段差のない多角形の樹木ます。土と鋳鉄を同心円に分け、低画質でも幹元が石畳に馴染む。
    matte.add(cyl(1.04, 1.04, 0.056, 12), 0xbbac91, M(0, 0.019, 0));
    matte.add(cyl(0.85, 0.85, 0.033, 12), 0x55625b, M(0, 0.051, 0));
    matte.add(cyl(0.46, 0.46, 0.021, 12), 0x73573b, M(0, 0.072, 0));
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      detail.add(new THREE.BoxGeometry(0.052, 0.018, 0.31), 0xabb2a0,
        M(0.65 * Math.sin(a), 0.073, 0.65 * Math.cos(a), a));
    }

    const bark = olive ? 0x827662 : 0x826a59, turn = olive ? -1 : 1;
    matte.add(wood([[0, 0.02, 0, 0.40], [-0.06, 0.32, 0.03, 0.31], [turn * 0.13, 1.10, 0.02, 0.24],
      [turn * 0.16, 1.88, -0.06, 0.22], [0.02, 2.45, 0.02, 0.19], [turn * 0.26, 3.1, 0.04, 0.10]], 8), bark, undefined, { ao: 0.72 });
    colliders.addCyl(x, z, y, y + 2.45, 0.34);

    crowns.forEach(([cx, cy, cz, w, h, d], i) => {
      const start = 2.30 + (i % 3) * 0.19;
      matte.add(wood([[0.02, start, 0, 0.16], [cx * 0.41, start + 0.25, cz * 0.46, 0.13],
        [cx * 0.78, cy - 0.62, cz * 0.87, 0.086], [cx, cy - 0.20, cz, 0.046]], 6), bark);
      const shade = olive ? [0x607951, 0x506f59, 0x71835c][i % 3] : [0x997ba7, 0x63826b, 0x8c72a6][i % 3];
      const light = olive ? [0xacb894, 0xb6c5a7, 0xa1b58c][i % 3] : [0xd5b2df, 0xa1b598, 0xc5a8da][i % 3];
      const yaw = i * 0.53;
      matte.add(leafCrown(3 * tree + i), shade, M(cx, cy, cz, yaw, w, h, d), { top: light, ao: 0.76, jitter: 0.26 });
      // 樹冠の内側に隠れないよう、外向きの枝先だけに若葉・花房を置く。
      const outward = Math.atan2(cz, cx);
      for (let j = -1; j <= 1; j++) {
        const a = outward + j * 0.75, u = w * Math.cos(a + yaw), v = d * Math.sin(a + yaw);
        const px = cx + (u * Math.cos(yaw) + v * Math.sin(yaw)) * 0.98;
        const pz = cz + (v * Math.cos(yaw) - u * Math.sin(yaw)) * 0.98;
        if (olive) {
          for (let k = 0; k < 3; k++) {
            detail.add(new THREE.OctahedronGeometry(1), k % 2 ? 0xc4cba1 : 0x91a37c,
              M(px + 0.11 * k * Math.cos(a), cy + 0.04 + k * 0.04, pz + 0.11 * k * Math.sin(a), -a + (k % 2 ? -0.60 : 0.55), 0.28, 0.055, 0.10, 0, 0.2 - k * 0.22));
          }
        } else {
          for (let k = 0; k < 3; k++) {
            const r = 0.17 - 0.033 * k;
            detail.add(new THREE.OctahedronGeometry(r), k % 2 ? 0xd3b5e2 : 0xb497d0,
              M(px + k * 0.06, cy + 0.01 - k * 0.13, pz + 0.05 * Math.cos(j + k), a, 1.32, 1.05, 1));
          }
        }
      }
    });
  }
}
