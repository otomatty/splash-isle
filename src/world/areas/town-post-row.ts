import * as THREE from 'three';
import type { Colliders } from '../colliders';
import { M, box, type GeoBatch } from '../props';
import { heightAt } from '../terrain';
import { postRoad } from './town-post-office';

const LIME = 0xffefcf, GLASS = 0x345b62, WALNUT = 0x74543e, PAVING = 0xd4b794;
type Use = 'bindery' | 'stationery' | 'lodging' | 'dispatch' | 'home';

interface House {
  left: number;
  width: number;
  front: number;
  depth: number;
  eaves: number;
  wall: number;
  paint: number;
  tile: number;
  use: Use;
}

// 正面は通り（+Z）へ向く。隣同士は界壁を揃え、店先と裏庭の奥行きだけを変える。
const houses: House[] = [
  { left: -30, width: 6.4, front: -54.3, depth: 5.7, eaves: 5.2, wall: 0xe8af85, paint: 0x426c62, tile: 0xaf6150, use: 'bindery' },
  { left: -23.6, width: 7.2, front: -53.7, depth: 6.4, eaves: 8.1, wall: 0xf0d99e, paint: 0x536b78, tile: 0x95725d, use: 'stationery' },
  { left: -16.4, width: 6.2, front: -54.2, depth: 4.8, eaves: 5.5, wall: 0xe5b5a5, paint: 0x596f85, tile: 0xb97755, use: 'lodging' },
  { left: 10.8, width: 8.3, front: -52.6, depth: 6.4, eaves: 5.7, wall: 0xd6c698, paint: 0x3e7c76, tile: 0x807565, use: 'dispatch' },
  { left: 19.1, width: 7.1, front: -52.2, depth: 5.2, eaves: 6.1, wall: 0xeac9ad, paint: 0xad634c, tile: 0x9f6146, use: 'home' },
];

function roadEdge(x: number): number {
  const pts = postRoad.pts;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    if (x >= ax && x <= bx) return az + (bz - az) * (x - ax) / (bx - ax) - postRoad.width / 2 + 0.20;
  }
  return postRoad.pts[0][1] - postRoad.width / 2;
}

/** 店先の石敷き・壁際に野草や岩が突き抜けない範囲。建物間と郵便局脇の路地は空ける。 */
export function inPostRow(x: number, z: number): boolean {
  return houses.some(p => x >= p.left - 0.45 && x <= p.left + p.width + 0.45 &&
    z >= p.front - p.depth - 0.45 && z <= roadEdge(x) + 0.45);
}

function buildHouse(p: House, matte: GeoBatch, detail: GeoBatch, colliders: Colliders): void {
  const cx = p.left + p.width / 2, y = heightAt(cx, p.front);
  const base = M(cx, y, p.front), w = p.width, d = p.depth, h = p.eaves;
  matte.setBase(base);
  detail.setBase(base);
  // ローカル座標は玄関の中央が原点。足をかけられる屋根・庇・バルコニーには当たりも付く。
  function block(x: number, cy: number, z: number, width: number, height: number, depth: number, color: number, solid = false): void {
    matte.add(box(width, height, depth), color, M(x, cy, z), { ao: 0.86 });
    if (solid) colliders.addBox(cx + x, y + cy, p.front + z, width, height, depth);
  }

  // 石敷きは戸口から既存の曲がった街路までつなぐ。隣り合う敷地で同じ辺を使う。
  const pavement = new THREE.BufferGeometry(), right = p.left + w;
  // 奥の辺は左右の家で共通、壁の下へ差し込む。
  const zBack = -55 - p.front;
  pavement.setAttribute('position', new THREE.Float32BufferAttribute([
    -w / 2, 0.035, zBack, w / 2, 0.035, zBack,
    w / 2, 0.035, roadEdge(right) - p.front, -w / 2, 0.035, roadEdge(p.left) - p.front,
  ], 3));
  pavement.setIndex([0, 2, 1, 0, 3, 2]);
  pavement.computeVertexNormals();
  matte.add(pavement, PAVING);
  for (const x of [-w * 0.28, w * 0.23]) {
    const len = roadEdge(cx + x) - p.front;
    detail.add(box(0.045, 0.015, len - 0.12), 0xbca385, M(x, 0.045, len / 2));
  }

  const firstCeiling = p.use === 'dispatch' ? 3.2 : 2.85;
  block(0, firstCeiling / 2 - 0.1, -d / 2, w, firstCeiling + 0.2, d, p.wall, true);
  const higher = new THREE.Color(p.wall).lerp(new THREE.Color(LIME), 0.22).getHex();
  block(0, (firstCeiling + h) / 2, -d / 2, w, h - firstCeiling, d, higher, true);
  block(0, firstCeiling, -d / 2, w, 0.15, d + 0.31, LIME);
  if (p.use === 'stationery') block(0, 5.51, -d / 2, w, 0.13, d + 0.22, p.tile);
  block(0, 0.24, 0.015, w, 0.42, 0.10, 0xb59779);
  block(0, h - 0.18, -d / 2, w + 0.05, 0.16, d + 0.20, LIME);
  const gable = p.use === 'bindery' || p.use === 'home';
  if (gable) {
    const rise = 1.12;
    const profile = new THREE.Shape();
    profile.moveTo(-d / 2, 0); profile.lineTo(0, rise); profile.lineTo(d / 2, 0); profile.closePath();
    const endWall = new THREE.ExtrudeGeometry(profile, { depth: w, bevelEnabled: false });
    endWall.rotateY(Math.PI / 2).translate(-w / 2, 0, -d / 2);
    matte.add(endWall, p.wall, M(0, h, 0));
    const slope = Math.atan2(rise, d / 2);
    for (const side of [-1, 1]) {
      matte.add(box(w + 0.18, 0.18, Math.hypot(d / 2, rise) + 0.35), p.tile,
        M(0, h + rise / 2 + 0.08, -d / 2 + side * d / 4, 0, 1, 1, 1, side * slope));
    }
    block(0, h + rise + 0.12, -d / 2, w + 0.24, 0.19, 0.26, p.tile);
    for (let i = 0; i < 6; i++) {
      const z = (i + 0.5) * d / 6;
      const roof = h + rise * (1 - Math.abs(2 * z / d - 1)) + 0.17;
      colliders.addBox(cx, y + (h + roof) / 2, p.front - z, w + 0.18, roof - h, d / 6);
    }
  } else {
    block(0, h + 0.11, -d / 2, w + 0.19, 0.22, d + 0.38, p.tile, true);
    block(0, h + 0.45, -d + 0.10, w, 0.46, 0.22, p.wall, true);
    block(0, h + 0.72, -d + 0.10, w + 0.10, 0.10, 0.32, p.tile);
  }

  // 窓枠・上げ下げ窓・水切り。端の家だけ妻側にも開口をつける。
  function windowBay(x: number, cy: number, z: number, yaw: number, width: number, tall: number): void {
    const f = M(x, cy, z, yaw);
    matte.add(box(width + 0.22, tall + 0.22, 0.14), LIME, f);
    matte.add(box(width, tall, 0.10), GLASS, f.clone().multiply(M(0, 0, 0.10)));
    detail.add(box(0.075, tall, 0.07), p.paint, f.clone().multiply(M(0, 0, 0.16)));
    detail.add(box(width, 0.07, 0.07), LIME, f.clone().multiply(M(0, tall * 0.13, 0.16)));
    detail.add(box(width + 0.34, 0.09, 0.28), p.tile, f.clone().multiply(M(0, -tall / 2 - 0.11, 0.05)));
  }
  for (const x of [-w * 0.26, w * 0.26]) {
    windowBay(x, h - 1.08, 0.03, 0, 1.0, 1.24);
    windowBay(x, h - 1.16, -d - 0.03, Math.PI, 0.9, 1.04);
    if (p.use === 'stationery') {
      windowBay(x, 4.22, 0.03, 0, 1.10, 1.36);
      windowBay(x, 4.22, -d - 0.03, Math.PI, 0.90, 1.16);
    }
  }
  if (p.use !== 'stationery') {
    const side = p.use === 'bindery' || p.use === 'dispatch' ? -1 : 1;
    windowBay(side * (w / 2 + 0.025), h - 1.16, -d * 0.54, side * Math.PI / 2, 1.14, 1.2);
  }

  const entrance = w * 0.27;
  block(entrance, 1.22, 0.06, 1.42, 2.42, 0.15, LIME);
  block(entrance, 1.12, 0.15, 1.16, 2.16, 0.11, p.paint);
  detail.add(box(0.72, 0.74, 0.06), GLASS, M(entrance, 1.62, 0.23));
  block(entrance, 0.11, 0.33, 1.63, 0.19, 0.66, 0xc5ac86, true);
  if (p.use === 'bindery' || p.use === 'stationery') {
    const display = -w * 0.18;
    windowBay(display, 1.60, 0.04, 0, 2.55, 1.52);
    block(display, 0.82, 0.19, 2.84, 0.15, 0.40, WALNUT);
    block(display, 2.65, 0.49, 3.45, 0.16, 1.08, p.paint, true);
    block(display, 2.48, 1.00, 3.47, 0.20, 0.09, p.paint);
    if (p.use === 'bindery') {
      // 看板の開いた本、売り窓には背の色が違う本が並ぶ。
      for (const side of [-1, 1]) {
        matte.add(box(0.66, 0.44, 0.13), LIME, M(display + side * 0.30, 2.55, 1.09, 0, 1, 1, 1, 0, side * 0.16));
      }
      for (let i = 0; i < 7; i++) {
        const tall = 0.36 + (i % 3) * 0.10;
        detail.add(box(0.20, tall, 0.15), [0x9e5149, 0x497977, 0xdaaa65][i % 3], M(display - 0.78 + i * 0.255, 0.92 + tall / 2, 0.24));
      }
    } else {
      for (let i = -1; i <= 1; i++) {
        detail.add(box(0.48, 0.58, 0.035), i === 0 ? 0xc9745c : 0xe9d397, M(display + i * 0.63, 1.51, 0.23, 0, 1, 1, 1, 0, i * 0.09));
      }
    }
  } else if (p.use === 'dispatch') {
    // 荷を雨に濡らさず積める引き違い戸と荷捌き台。
    block(-1.18, 1.38, 0.07, 4.04, 2.68, 0.17, WALNUT);
    for (const side of [-1, 1]) {
      block(-1.18 + side * 0.95, 1.38, 0.19, 1.82, 2.45, 0.10, p.paint);
      detail.add(box(0.09, 0.4, 0.07), LIME, M(-1.18 + side * 0.16, 1.13, 0.27));
    }
    block(-1.18, 0.24, 0.71, 4.46, 0.47, 1.42, 0xb29777, true);
    block(-1.18, 2.92, 0.77, 4.76, 0.20, 1.62, p.tile, true);
    for (const [x, z, size] of [[-2.4, 0.70, 0.64], [-1.72, 0.94, 0.49]]) {
      block(x, 0.48 + size / 2, z, size, size, size, 0xc09b66, true);
      detail.add(box(0.09, 0.025, size + 0.015), LIME, M(x, 0.5 + size, z));
    }
  } else {
    windowBay(-1.23, 1.51, 0.05, 0, 1.65, 1.27);
    block(-0.35, h - 1.92, 0.50, w - 1.30, 0.18, 1.15, LIME, true);
    block(-0.35, h - 1.28, 1.02, w - 1.32, 0.13, 0.16, p.paint, true);
    for (let i = 0; i < 6; i++) {
      block(-0.35 + (i / 5 - 0.5) * (w - 1.52), h - 1.59, 1.02, 0.095, 0.64, 0.12, p.paint);
    }
  }
}

export function buildPostRow(matte: GeoBatch, detail: GeoBatch, colliders: Colliders): void {
  for (const house of houses) buildHouse(house, matte, detail, colliders);
}
