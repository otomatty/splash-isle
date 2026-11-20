import * as THREE from 'three';
import { M, box, cyl, type GeoBatch } from '../props';
import { heightAt, type PathDef } from '../terrain';
import type { Colliders } from '../colliders';

/** 手紙を港へ運ぶ裏通り。灯台の道から郵便局前を通り、港通りの家と家の間に抜ける。 */
export const postRoad: PathDef = {
  pts: [[-49, -35], [-44, -45], [-26, -47], [0, -45], [22, -43], [43.6, -27], [43.6, 0]],
  width: 4.2,
};
export const postSquare = { x: 0, z: -45, r: 8 };

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
}
