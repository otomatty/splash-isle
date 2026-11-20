import * as THREE from 'three';
import { M, box, cyl, sph, type GeoBatch } from '../props';
import { heightAt, type PathDef } from '../terrain';
import type { Colliders } from '../colliders';

/** 手紙を港へ運ぶ裏通り。灯台の道から郵便局前を通り、港通りの家と家の間に抜ける。 */
export const postRoad: PathDef = {
  pts: [[-49, -35], [-44, -45], [-26, -47], [0, -45], [22, -43], [43.6, -27], [43.6, 0]],
  width: 4.2,
};
export const postSquare = { x: 0, z: -45, r: 8 };

// 荷台に集配鞄を下げ、次の便に出る途中の実用車。回廊の外のベンチ横に停める。
function deliveryBicycle(b: GeoBatch, detail: GeoBatch, colliders: Colliders): void {
  const x = -3.50, z = -51.65, y = heightAt(x, z), yaw = -0.13;
  const base = M(x, y, z, yaw);
  b.setBase(base);
  detail.setBase(base);
  const rubber = 0x343940, rim = 0xb3b5a2, frame = 0xb94632, leather = 0x855031;
  const rear = -0.80, front = 0.80, axle = 0.46;
  for (const wx of [rear, front]) {
    b.add(new THREE.TorusGeometry(0.415, 0.045, 5, 16), rubber, M(wx, axle, 0));
    b.add(new THREE.TorusGeometry(0.49, 0.032, 4, 10, Math.PI), frame, M(wx, axle, 0));
    b.add(cyl(0.075, 0.075, 0.14, 8).rotateX(Math.PI / 2), rim, M(wx, axle, 0));
    for (let i = 0; i < 4; i++) {
      b.add(box(0.024, 0.78, 0.024), rim, M(wx, axle, 0, 0, 1, 1, 1, 0, i * Math.PI / 4));
    }
  }
  // フレームの管は、車輪の軸・ペダル・サドル・ハンドルを同じ平面で結ぶ。
  function tube(ax: number, ay: number, bx: number, by: number, radius: number, color: number, offset = 0): void {
    const dx = bx - ax, dy = by - ay;
    b.add(cyl(radius, radius, Math.hypot(dx, dy), 6), color,
      M((ax + bx) / 2, (ay + by) / 2, offset, 0, 1, 1, 1, 0, -Math.atan2(dx, dy)));
  }
  tube(rear, axle, -0.14, 0.42, 0.045, frame);
  tube(rear, axle, -0.38, 1.09, 0.042, frame);
  tube(-0.14, 0.42, -0.40, 1.25, 0.051, frame);
  tube(-0.14, 0.42, 0.49, 0.98, 0.059, frame);
  tube(-0.28, 0.83, 0.40, 0.86, 0.04, frame);
  tube(front, axle, 0.36, 1.34, 0.052, frame, 0.07);
  tube(0.36, 1.34, 0.43, 1.48, 0.035, rim);
  b.add(cyl(0.032, 0.032, 0.64, 6).rotateX(Math.PI / 2), rim, M(0.43, 1.48, 0));
  for (const side of [-1, 1]) {
    b.add(box(0.21, 0.064, 0.07), rubber, M(0.37, 1.48, 0.29 * side));
  }
  b.add(sph(0.17, 8, 4), leather, M(-0.40, 1.27, 0, 0, 1.55, 0.45, 1.03));
  b.add(cyl(0.15, 0.15, 0.065, 10).rotateX(Math.PI / 2), 0x696e67, M(-0.14, 0.42, 0.095));
  tube(-0.14, 0.42, -0.06, 0.24, 0.026, rim, 0.16);
  b.add(box(0.14, 0.046, 0.12), rubber, M(-0.06, 0.24, 0.22));
  b.add(box(0.08, 0.51, 0.07), rubber, M(-0.34, 0.255, 0.17, 0, 1, 1, 1, 0.47, 0.18));
  // 後輪の上に手紙を詰めた帆布鞄。口から封筒と筒がのぞく。
  b.add(box(0.87, 0.07, 0.40), 0x546564, M(-0.82, 0.99, 0));
  tube(rear, axle, -1.08, 0.97, 0.023, rim, -0.12);
  tube(rear, axle, -0.55, 0.97, 0.023, rim, -0.12);
  b.add(box(0.63, 0.44, 0.28), 0x355f62, M(-0.85, 0.83, 0.27), { ao: 0.78 });
  b.add(box(0.62, 0.15, 0.30), leather, M(-0.85, 1.02, 0.28));
  for (const ox of [-0.20, 0.20]) detail.add(box(0.047, 0.31, 0.025), 0xe0b46d, M(-0.85 + ox, 0.91, 0.44));
  b.add(box(0.37, 0.23, 0.03), 0xffeed1, M(-0.91, 1.13, 0.23, 0, 1, 1, 1, 0, -0.10));
  detail.add(box(0.058, 0.057, 0.013), frame, M(-0.80, 1.20, 0.25));
  b.add(cyl(0.065, 0.065, 0.44, 8), 0xe8c898, M(-0.62, 1.15, 0.22, 0, 1, 1, 1, 0, -0.20));
  b.add(box(0.22, 0.042, 0.075), rim, M(0.48, 1.24, 0.07));
  detail.add(cyl(0.079, 0.10, 0.14, 8).rotateZ(Math.PI / 2), 0x62706b, M(0.56, 1.28, 0.07));
  detail.add(sph(0.085, 8, 4), 0xf9d68b, M(0.63, 1.28, 0.07, 0, 0.38, 0.93, 0.93));
  colliders.addBox(x, y + 0.57, z, 2.40, 1.14, 0.48, yaw);
}

/** 海鳥郵便局。道路側の回廊は通り抜けられ、三つのアーチの奥に受付と仕分け窓がある。 */
export function buildPostOffice(matte: GeoBatch, detail: GeoBatch, colliders: Colliders): void {
  const z = -58, y = heightAt(0, z);
  const base = M(0, y, z);
  const b = matte.setBase(base), trim = detail.setBase(base);
  const cream = 0xffedcc, stone = 0xc6ac86, jade = 0x32776c, dark = 0x274957, red = 0xb84937;

  function block(x: number, h: number, depth: number, w: number, tall: number, d: number, color: number): void {
    b.add(box(w, tall, d), color, M(x, h, depth), { ao: 0.84 });
    colliders.addBox(x, y + h, z + depth, w, tall, d);
  }

  // 基礎と2段の屋上。階下の回廊は両脇からも入れる。
  block(0, 0.04, 1.1, 12.8, 0.28, 9.4, stone);
  block(0, 2.63, -0.65, 12.2, 4.9, 5.7, cream);
  block(0, 4.37, 4.03, 12.8, 0.35, 3.67, jade);
  block(0, 5.18, -0.65, 12.65, 0.2, 6.15, jade);
  // 2階の事務室は回廊の屋根から一段引く。正面・裏面とも窓を通して階が読める。
  block(0, 6.57, -0.65, 9.5, 2.58, 3.5, 0xe5ae69);
  block(0, 7.97, -0.65, 9.95, 0.22, 3.99, jade);
  for (const side of [-1, 1]) {
    const wallZ = -0.65 + side * 1.79;
    for (const wx of [-3.35, -1.88, 1.88, 3.35]) {
      b.add(box(1.0, 1.34, 0.13), cream, M(wx, 6.6, wallZ));
      b.add(box(0.79, 1.10, 0.11), dark, M(wx, 6.6, wallZ + side * 0.09));
      trim.add(box(0.80, 0.07, 0.07), jade, M(wx, 6.75, wallZ + side * 0.15));
    }
    b.add(box(0.11, 1.20, 1.25), dark, M(side * 4.79, 6.6, -0.66));
  }

  const span = 3.76, radius = 1.52, spring = 2.45, lip = 5.45;
  for (const column of [-1.5, -0.5, 0.5, 1.5]) {
    block(column * span, (spring + 0.18) / 2, lip, span - radius * 2, spring - 0.18, 0.65, stone);
  }
  const arch = new THREE.Shape();
  arch.moveTo(-span / 2, spring);
  arch.lineTo(-radius, spring);
  arch.absarc(0, spring, radius, Math.PI, 0, true);
  arch.lineTo(span / 2, spring);
  arch.lineTo(span / 2, 4.25);
  arch.lineTo(-span / 2, 4.25);
  arch.closePath();
  for (const x of [-span, 0, span]) {
    b.add(new THREE.ExtrudeGeometry(arch, { depth: 0.65, bevelEnabled: false, curveSegments: 5 }),
      cream, M(x, 0, lip - 0.325));
    // アーチの帯に沿った頭上の当たり判定。開口部の中央を高く空ける。
    for (let i = 0; i < 5; i++) {
      const width = span / 5, offset = (i - 2) * width;
      const nearest = Math.max(0, Math.abs(offset) - width / 2);
      const bottom = spring + Math.sqrt(Math.max(0, radius * radius - nearest * nearest));
      colliders.addBox(x + offset, y + (4.25 + bottom) / 2, z + lip, width, 4.25 - bottom, 0.65);
    }
    const service = x === 0;
    b.add(box(service ? 1.55 : 2.2, service ? 2.6 : 1.45, 0.16), dark, M(x, service ? 1.48 : 2.0, 2.27));
    b.add(box(service ? 1.3 : 2.44, 0.14, 0.45), service ? jade : stone, M(x, service ? 2.7 : 1.3, 2.4));
    if (!service) {
      for (let i = -1; i <= 1; i++) trim.add(box(0.065, 1.4, 0.12), jade, M(x + i * 0.68, 2, 2.38));
    }
  }

  // 正面の立ち上がりに封筒の看板。庇の上からも街区を見分けられる。
  b.add(box(2.45, 1.23, 0.16), red, M(0, 6.65, 1.16));
  b.add(box(1.72, 0.83, 0.09), cream, M(0, 6.65, 1.27));
  for (const side of [-1, 1]) {
    b.add(box(0.95, 0.085, 0.06), red, M(side * 0.4, 6.79, 1.34, 0, 1, 1, 1, 0, side * 0.52));
  }
  for (const wx of [-4.6, -1.65, 1.65, 4.6]) {
    trim.add(box(1.18, 1.65, 0.12), jade, M(wx, 2.64, -3.53));
    trim.add(box(0.06, 1.65, 0.08), cream, M(wx, 2.64, -3.61));
  }
  // 道路から手紙が出せる丸ポスト。投函口は通りに向ける。
  const px = 7.15, pz = 6.55;
  b.add(cyl(0.46, 0.54, 0.25, 12), stone, M(px, 0.125, pz));
  b.add(cyl(0.38, 0.36, 1.33, 12), red, M(px, 0.88, pz));
  b.add(cyl(0.19, 0.46, 0.22, 12), red, M(px, 1.65, pz));
  b.add(box(0.48, 0.11, 0.12), dark, M(px, 1.22, pz + 0.33));
  trim.add(box(0.32, 0.25, 0.1), cream, M(px, 0.85, pz + 0.33));
  colliders.addCyl(px, z + pz, y, y + 1.76, 0.42);
  deliveryBicycle(b, trim, colliders);
}
