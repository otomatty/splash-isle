import * as THREE from 'three';
import { type GeoBatch, M, box, cyl, sph } from '../props';
import type { Colliders } from '../colliders';
import { heightAt } from '../terrain';

const CEDAR = 0xaa7951, END_GRAIN = 0xd5ab75, IRON = 0x485862, BRASS = 0xd49e46;
const LINEN = 0xffeac5, INDIGO = 0x33657b, RED = 0xcb6248;
type Point = [number, number, number];

function spar(batch: GeoBatch, from: Point, to: Point, radius: number, color: number): void {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const delta = b.clone().sub(a);
  const rod = cyl(radius, radius, delta.length(), 6);
  rod.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
  a.lerp(b, 0.5);
  batch.add(rod, color, M(a.x, a.y, a.z));
}

function hoop(batch: GeoBatch, x: number, y: number, z: number, r: number, color: number): void {
  batch.add(new THREE.TorusGeometry(r, 0.035, 4, 14), color, M(x, y, z, 0, 1, 1, 1, Math.PI / 2));
}

/** 湯だまりの脇で、湯番が竹籠ごと卵を温めている。 */
export function dressSpring(b: GeoBatch, fine: GeoBatch, c: Colliders): void {
  const x = -8.3, z = 76.2, y = heightAt(x, z);
  b.setBase(M(x, y, z));
  fine.setBase(b.base);
  for (const side of [-1, 1]) {
    b.add(cyl(0.09, 0.12, 2.65, 7), CEDAR, M(side * 1.64, 1.20, 0));
    c.addCyl(x + side * 1.64, z, y - 0.15, y + 2.53, 0.12);
  }
  spar(b, [-1.84, 2.39, 0], [1.84, 2.39, 0], 0.085, END_GRAIN);
  for (const side of [-1, 1]) {
    // 湯に下ろした籠と引き上げた籠は、釣り紐の長さで見分けられる。
    const cx = side * 0.77, cy = side < 0 ? 0.53 : 1.03;
    b.add(cyl(0.54, 0.39, 0.45, 10), END_GRAIN, M(cx, cy, -0.40), { ao: 0.72 });
    hoop(fine, cx, cy + 0.20, -0.40, 0.53, CEDAR);
    hoop(fine, cx, cy - 0.04, -0.40, 0.46, CEDAR);
    for (const k of [-1, 1]) spar(b, [cx, 2.38, 0], [cx + k * 0.49, cy + 0.2, -0.4], 0.027, IRON);
    for (const [ex, ez] of [[0, 0], [-0.23, 0.12], [0.22, 0.1], [0.09, -0.22], [-0.21, -0.19]]) {
      fine.add(sph(0.135, 7, 5), LINEN, M(cx + ex, cy + 0.25, -0.4 + ez, ex, 1, 1.3, 1));
    }
  }
  // すのこ、使い終わった手桶、柄杓。石の縁を空けて湯だまりに入れる。
  for (let i = 0; i < 5; i++) b.add(box(1.32, 0.09, 0.17), END_GRAIN, M(2.8, 0.04, 0.05 + i * 0.2));
  b.add(cyl(0.35, 0.27, 0.45, 9, 1, true), CEDAR, M(2.64, 0.31, 0.51));
  fine.add(cyl(0.29, 0.29, 0.03, 9), 0x516552, M(2.64, 0.21, 0.51));
  hoop(fine, 2.64, 0.31, 0.51, 0.315, IRON);
  spar(fine, [2.6, 0.48, 0.53], [3.39, 0.72, 0.61], 0.048, END_GRAIN);
  fine.add(cyl(0.14, 0.10, 0.15, 8), END_GRAIN, M(2.59, 0.48, 0.53));
}

/** 難破船の位置を測る小卓。海図の赤い印と望遠鏡は、同じ入り江の中央を示す。 */
export function dressLagoon(b: GeoBatch, fine: GeoBatch, c: Colliders): void {
  const x = 6.5, z = 67.4, y = heightAt(x, z);
  b.setBase(M(x, y, z));
  fine.setBase(b.base);
  for (const dx of [-1.37, 1.37]) for (const dz of [-0.58, 0.58]) {
    b.add(box(0.14, 1.36, 0.14), CEDAR, M(dx, 0.56, dz));
  }
  b.add(box(3.13, 0.15, 1.48), END_GRAIN, M(0, 1.26, 0));
  c.addBox(x, y + 0.66, z, 3.13, 1.35, 1.48);
  b.add(box(1.97, 0.026, 1.14), 0x9dc3bf, M(-0.30, 1.35, 0));
  for (const dx of [-1.33, 0.73]) fine.add(cyl(0.072, 0.072, 1.2, 8), LINEN, M(dx, 1.395, 0, 0, 1, 1, 1, Math.PI / 2));
  fine.add(new THREE.TorusGeometry(0.37, 0.041, 4, 15), LINEN, M(-0.30, 1.37, 0, 0, 1.72, 1, 1, Math.PI / 2));
  fine.add(box(0.17, 0.025, 0.18), RED, M(-0.30, 1.383, 0, 0.65));
  // 真鍮の羅針盤には盤面と赤い北針を重ねる。
  b.add(cyl(0.24, 0.22, 0.12, 12), BRASS, M(1.12, 1.40, 0.15));
  fine.add(cyl(0.198, 0.198, 0.015, 12), LINEN, M(1.12, 1.469, 0.15));
  fine.add(box(0.045, 0.016, 0.24), RED, M(1.12, 1.485, 0.11));
  // 観測脚を砂に差し、太い対物側を海に向ける。
  const tripodX = x - 2.55, tripodY = heightAt(tripodX, z);
  b.setBase(M(tripodX, tripodY, z));
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3;
    spar(b, [Math.sin(a) * 0.65, -0.1, Math.cos(a) * 0.65], [0, 1.72, 0], 0.062, CEDAR);
  }
  spar(b, [0, 1.81, 0.54], [0, 2.04, -0.84], 0.13, BRASS);
  spar(b, [0, 2.03, -0.68], [0, 2.09, -1.02], 0.19, INDIGO);
  spar(b, [0, 2.09, -1.02], [0, 2.10, -1.04], 0.14, 0x6ac2bf);
  c.addCyl(tripodX, z, tripodY - 0.1, tripodY + 1.85, 0.35);
}

/** 気球の乗り場。吹き流しの開口、三杯式風速計、索の巻き枠を風の来る側へ置く。 */
export function dressPlateau(b: GeoBatch, fine: GeoBatch, c: Colliders): void {
  const x = -56.6, z = 17.7, y = heightAt(x, z);
  b.setBase(M(x, y, z));
  fine.setBase(b.base);
  b.add(cyl(0.1, 0.14, 4.45, 8), END_GRAIN, M(0, 2.18, 0));
  b.add(cyl(0.34, 0.46, 0.28, 8), IRON, M(0, 0.14, 0));
  c.addCyl(x, z, y - 0.1, y + 4.4, 0.18);
  // 円錐台を交互の色で継いで、風下の先だけが垂れる形を描く。
  for (let i = 0; i < 5; i++) {
    const r = 0.48 - 0.065 * i;
    b.add(cyl(r - 0.065, r, 0.56, 10, 1, true), i % 2 ? LINEN : RED,
      M(0.52 + i * 0.53, 3.93 - 0.035 * i * i, 0, 0, 1, 1, 1, 0, -Math.PI / 2 - 0.13 * i));
  }
  for (const dz of [-0.4, 0.4]) spar(fine, [0, 4.36, 0], [0.29, 3.94, dz], 0.027, IRON);
  const mast = -1.85;
  b.add(cyl(0.06, 0.095, 2.65, 7), IRON, M(mast, 1.27, 0.2));
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3, dx = Math.cos(angle), dz = Math.sin(angle);
    spar(b, [mast, 2.56, 0.2], [mast + dx * 0.52, 2.56, 0.2 + dz * 0.52], 0.027, BRASS);
    const cup = new THREE.SphereGeometry(0.20, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    b.add(cup, BRASS, M(mast + dx * 0.52, 2.56, 0.2 + dz * 0.52, -angle, 1, 1, 1, Math.PI / 2));
  }
  const spool = 2.0;
  for (const side of [-1, 1]) {
    b.add(box(0.19, 0.92, 1.12), CEDAR, M(spool + side * 0.59, 0.46, 0.96));
    const rimX = spool + side * 0.51;
    b.add(cyl(0.53, 0.53, 0.1, 12), END_GRAIN, M(rimX, 0.83, 0.96, 0, 1, 1, 1, 0, Math.PI / 2));
    // 十二角形の外輪だけを段状に拾う。軸の中央には高さ1.36 mの足場を作らない。
    for (const [top, depth] of [[1.20, 0.73], [1.31, 0.44], [1.36, 0.15]]) {
      c.addBox(x + rimX, y + (1.04 + top) / 2, z + 0.96, 0.1, top - 1.04, depth);
    }
  }
  b.add(cyl(0.37, 0.37, 1.04, 10), BRASS, M(spool, 0.83, 0.96, 0, 1, 1, 1, 0, Math.PI / 2));
  for (let i = -3; i <= 3; i++) fine.add(new THREE.TorusGeometry(0.37, 0.036, 4, 12), LINEN, M(spool + i * 0.13, 0.83, 0.96, Math.PI / 2));
  c.addBox(x + spool, y + 0.52, z + 0.96, 1.38, 1.04, 1.12);
}
