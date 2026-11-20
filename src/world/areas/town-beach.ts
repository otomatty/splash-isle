import * as THREE from 'three';
import { lerp, sstep } from '../../engine/noise';
import type { Colliders } from '../colliders';
import { GeoBatch, M, box, cyl, sph } from '../props';
import { heightAt } from '../terrain';

const WHITE = 0xfff3d6, JADE = 0x238e92, DEEP_BLUE = 0x32637b;
const CORAL = 0xdb5d46, HONEY = 0xdbab69, WOOD = 0x966d48;

/** 南の入江に奥浜と遠浅の砂棚を作る。波打ち際は元の海岸線に合わせる。 */
export function beachShelf(x: number, z: number, height: number): number {
  if (z < 98 || z > 216 || Math.abs(x) >= 78) return height;
  if (height >= 0) {
    const backshore = sstep(98, 110, z) * (1 - sstep(121, 132, z)) * (1 - sstep(32, 50, Math.abs(x)));
    return height - backshore * 0.95 * Math.max(0, height - 0.92);
  }
  const cove = (1 - sstep(48, 78, Math.abs(x))) * sstep(105, 135, z) * (1 - sstep(185, 216, z));
  const slope = lerp(0.24, 1, sstep(4.4, 11.5, -height));
  return lerp(height, height * slope, cove);
}

export function inBeachAccess(x: number, z: number): boolean {
  return z > 98 && z < 144 && x > -23 && x < 24;
}

/** 町の浜道に沿った板敷き。砂の高さから四隅を取り、波打ち際へはそのまま歩き出せる。 */
function approach(b: GeoBatch): void {
  b.setBase(M());
  const path = [[0, 98], [-3, 112], [2, 128]];
  for (let segment = 1; segment < path.length; segment++) {
    const [ax, az] = path[segment - 1], [bx, bz] = path[segment];
    const dx = bx - ax, dz = bz - az, length = Math.hypot(dx, dz);
    const sideX = 1.43 * dz / length, sideZ = -1.43 * dx / length;
    const count = Math.ceil(length / 0.58);
    for (let i = 0; i < count; i++) {
      const corners: number[] = [];
      for (const [across, along] of [[-1, 0.06], [-1, 0.94], [1, 0.94], [1, 0.06]]) {
        const t = (i + along) / count;
        const x = ax + dx * t + across * sideX, z = az + dz * t + across * sideZ;
        corners.push(x, heightAt(x, z) + 0.05, z);
      }
      const plank = new THREE.BufferGeometry();
      plank.setAttribute('position', new THREE.Float32BufferAttribute(corners, 3));
      plank.setIndex([0, 1, 2, 0, 2, 3]);
      plank.computeVertexNormals();
      b.add(plank, [0xc89762, 0xd7af80, 0xcda16e][i % 3]);
    }
  }
}

/** 細長い板の輪郭を型取りし、中央のストリンガーと鼻先の差し色を重ねる。 */
function boards(b: GeoBatch, detail: GeoBatch, c: Colliders): void {
  const x = -16, z = 124, y = heightAt(x, z);
  const base = M(x, y, z);
  b.setBase(base);
  detail.setBase(base);
  for (const side of [-1, 1]) {
    b.add(box(0.17, 1.64, 0.20), WOOD, M(2.0 * side, 0.82, 0));
  }
  b.add(box(4.25, 0.17, 0.23), HONEY, M(0, 1.32, 0));
  b.add(box(4.25, 0.19, 0.34), WOOD, M(0, 0.16, 0.50));
  c.addBox(x, y + 0.77, z + 0.21, 4.22, 1.54, 0.82);

  const colors = [JADE, CORAL, 0xf4c359, DEEP_BLUE];
  for (let i = 0; i < colors.length; i++) {
    const width = i % 2 ? 0.41 : 0.34, h = i % 2 ? 2.26 : 2.62;
    const outline = new THREE.Shape();
    outline.moveTo(0, 0); outline.quadraticCurveTo(-width, 0.12, -width, h * 0.55);
    outline.quadraticCurveTo(-width, h * 0.85, 0, h);
    outline.quadraticCurveTo(width, h * 0.87, width, h * 0.55);
    outline.quadraticCurveTo(width, 0.15, 0, 0);
    const geometry = new THREE.ExtrudeGeometry(outline, { depth: 0.09, bevelEnabled: false, curveSegments: 4 });
    const m = M((i - 1.5) * 0.87, 0.08, 0.61, 0, 1, 1, 1, -0.24, (i - 1.5) * 0.075);
    b.add(geometry, colors[i], m);
    detail.add(box(0.045, h * 0.87, 0.025), WHITE, m.clone().multiply(M(0, h * 0.48, 0.10)));
    detail.add(box(width * 1.65, 0.11, 0.028), WHITE, m.clone().multiply(M(0, h * 0.36, 0.104)));
  }
}

/** 海を向いた二人分ずつのデッキチェア。背もたれに張った帆布を木枠が挟む。 */
function deckChairs(b: GeoBatch, detail: GeoBatch, c: Colliders): void {
  for (const [x, z, yaw, color] of [[-29, 126, -0.22, JADE], [-26.8, 125.6, -0.12, JADE], [22, 127.2, 0.20, CORAL], [24.2, 127.6, 0.13, CORAL]]) {
    const y = heightAt(x, z), base = M(x, y, z, yaw);
    b.setBase(base);
    detail.setBase(base);
    const recline = 0.75;
    for (const dx of [-0.41, 0.41]) {
      b.add(box(0.09, 0.14, 1.64), WOOD, M(dx, 0.29, 0.25));
      b.add(box(0.09, 0.12, 1.02), HONEY, M(dx, 0.64, -0.80, 0, 1, 1, 1, recline));
      for (const dz of [-0.60, 0.88]) b.add(box(0.11, 0.49, 0.13), WOOD, M(dx, 0.11, dz));
    }
    b.add(box(0.78, 0.08, 1.62), color, M(0, 0.33, 0.24));
    const back = M(0, 0.68, -0.80, 0, 1, 1, 1, recline);
    b.add(box(0.78, 0.085, 1.04), color, back);
    for (const dx of [-0.23, 0.23]) {
      detail.add(box(0.08, 0.025, 1.58), WHITE, M(dx, 0.374, 0.24));
      detail.add(box(0.08, 0.025, 1), WHITE, back.clone().multiply(M(dx, 0.052, 0)));
    }
    c.addBox(x, y + 0.14, z, 0.9, 0.44, 2.1, yaw);
  }
}

/** 砂浜側に監視窓と張り出しデッキを向けた救護所。下階は波板の道具庫。 */
function watchHouse(b: GeoBatch, detail: GeoBatch, c: Colliders): void {
  const x = 13, z = 118, y = heightAt(x, z);
  const base = M(x, y, z);
  b.setBase(base);
  detail.setBase(base);
  const solid = (px: number, py: number, pz: number, w: number, h: number, d: number, color: number) => {
    b.add(box(w, h, d), color, M(px, py, pz), { ao: 0.86 });
    c.addBox(x + px, y + py, z + pz, w, h, d);
  };
  solid(0, 1.17, -0.32, 4.3, 2.8, 2.8, JADE);
  solid(0, 2.66, 0.48, 5.55, 0.18, 4.95, WHITE);
  solid(0, 3.77, -0.43, 4.28, 2.04, 2.83, CORAL);
  solid(0, 4.89, -0.24, 5.22, 0.20, 3.9, WHITE);
  solid(0, 5.06, -0.26, 4.95, 0.14, 3.63, JADE);
  b.add(box(3.73, 0.96, 0.13), DEEP_BLUE, M(0, 4.01, 1.02));
  b.add(box(2.65, 0.96, 0.14), DEEP_BLUE, M(0, 4.01, -1.86));
  b.add(box(0.12, 1.02, 0.14), WHITE, M(0, 4.01, -1.91));
  b.add(box(2.7, 1.9, 0.13), 0x397575, M(0, 1.05, -1.76));
  for (let i = 0; i < 6; i++) detail.add(box(2.65, 0.055, 0.07), JADE, M(0, 0.36 + i * 0.27, -1.85));
  for (const side of [-1, 1]) {
    b.add(box(0.13, 0.97, 2.15), DEEP_BLUE, M(side * 2.17, 4.01, -0.38));
    b.add(box(0.10, 1.02, 0.16), WHITE, M(side * 0.69, 4.01, 1.11));
    b.add(box(0.15, 1.03, 0.15), WHITE, M(side * 2.23, 4.01, -0.38));
    solid(side * 2.48, 0.98, 2.55, 0.20, 3.30, 0.20, WOOD);
    for (const pz of [-0.6, 0.92, 2.55]) b.add(box(0.11, 0.82, 0.11), WHITE, M(side * 2.52, 3.15, pz));
    const railLength = side < 0 ? 1.55 : 3.24;
    b.add(box(0.12, 0.12, railLength), JADE, M(side * 2.52, 3.60, -0.62 + railLength / 2));
  }
  b.add(box(5.14, 0.12, 0.12), JADE, M(0, 3.60, 2.55));
  b.add(box(0.12, 0.82, 0.12), WHITE, M(0, 3.15, 2.55));
  // 西側の外階段から海を望むデッキへ。
  for (let i = 0; i < 8; i++) {
    const top = 2.75 * (i + 1) / 8, run = 0.53;
    const pz = -2.36 + i * run;
    solid(-3.29, (top - 0.45) / 2, pz, 1.12, top + 0.45, run, HONEY);
    detail.add(box(1.13, 0.065, run + 0.03), WHITE, M(-3.29, top - 0.033, pz));
  }
  solid(-3.09, 2.66, 2.06, 1.55, 0.18, 0.91, WHITE);
  // 救命浮環は道具庫の壁とバルコニーの正面に掛ける。
  for (const [px, py, pz, r] of [[-1.13, 1.38, 1.14, 0.47], [1.17, 3.20, 2.68, 0.32]]) {
    b.add(new THREE.TorusGeometry(r, r * 0.25, 6, 20), WHITE, M(px, py, pz), {
      paint: (rx, ry, _rz, out) => { if (Math.cos(4 * Math.atan2(ry, rx)) > 0) out.set(CORAL); },
    });
  }
  b.add(box(1.02, 1.97, 0.13), 0x417677, M(0.70, 1.01, 1.13));
  for (let i = -3; i <= 3; i++) detail.add(box(0.78, 0.065, 0.07), WHITE, M(0.70, 1.30 + 0.12 * i, 1.22));
  b.add(cyl(0.045, 0.06, 2.26, 7), HONEY, M(-1.70, 6.24, -1.22));
  const flag = new THREE.Shape();
  flag.moveTo(0, 0); flag.lineTo(1.56, -0.20); flag.lineTo(0, -0.58); flag.closePath();
  b.add(new THREE.ExtrudeGeometry(flag, { depth: 0.045, bevelEnabled: false }), 0xffbc49, M(-1.65, 7.30, -1.22));
}

/** 遊泳区域の沖側に半円のブイを浮かべる。ロープの下は泳いで通れる。 */
function swimCove(b: GeoBatch, detail: GeoBatch, c: Colliders): void {
  b.setBase(M());
  detail.setBase(M());
  let previous: THREE.Vector3 | undefined;
  for (let i = 0; i <= 20; i++) {
    const angle = Math.PI * i / 20;
    const x = 36 * Math.cos(angle), z = 152.5 + 11.5 * Math.sin(angle);
    const large = i % 5 === 0;
    const r = large ? 0.42 : 0.25;
    b.add(sph(r, 8, 5), i % 2 ? WHITE : CORAL, M(x, 0.08, z, 0, 1, large ? 1.3 : 0.85, 1));
    if (large) b.add(cyl(r * 0.96, r * 0.96, 0.13, 10), WHITE, M(x, 0.22, z));
    const anchor = new THREE.Vector3(x, 0.08, z);
    if (previous) {
      const d = anchor.clone().sub(previous);
      const rope = cyl(0.045, 0.045, d.length(), 5, 1, true);
      rope.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
      const mid = anchor.clone().lerp(previous, 0.5);
      detail.add(rope, 0xf4d6a2, M(mid.x, mid.y, mid.z));
    }
    previous = anchor;
  }
  // 浅い喫水の休憩台。砂浜の中央から泳ぐ人の正面は開けてある。
  const x = 15, z = 156;
  b.setBase(M(x, 0, z));
  detail.setBase(b.base);
  for (const dx of [-1.56, 1.56]) {
    b.add(cyl(0.28, 0.28, 3.3, 8).rotateX(Math.PI / 2), JADE, M(dx, 0.02, 0));
  }
  for (let i = -4; i <= 4; i++) b.add(box(0.46, 0.17, 3.6), i % 2 ? HONEY : 0xe3bd89, M(i * 0.47, 0.28, 0));
  c.addBox(x, 0.17, z, 4.22, 0.39, 3.6);
}

export function buildSwimBeach(matte: GeoBatch, detail: GeoBatch, colliders: Colliders): void {
  approach(matte);
  boards(matte, detail, colliders);
  deckChairs(matte, detail, colliders);
  watchHouse(matte, detail, colliders);
  swimCove(matte, detail, colliders);
}
