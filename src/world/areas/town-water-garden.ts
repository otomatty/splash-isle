import * as THREE from 'three';
import type { PoolDef } from '../area';
import type { Colliders } from '../colliders';
import { GeoBatch, M, box, cyl, sph } from '../props';
import { heightAt } from '../terrain';

const GLAZE = 0x247c86, SKY_TILE = 0x72c7bd, CREAM = 0xf3dfb0;
const LIMESTONE = 0xcbb488, BRICK = 0xb3684e, IRON = 0x355e63, BRASS = 0xcb9b56;
const WOOD = 0x996c44, SOIL = 0x755341;
type Point = [number, number, number];

function rod(b: GeoBatch, start: Point, end: Point, radius: number, color: number): void {
  const a = new THREE.Vector3(...start), tip = new THREE.Vector3(...end);
  const direction = tip.sub(a);
  const geo = cyl(radius, radius, direction.length(), 6);
  geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()));
  a.addScaledVector(direction, 0.5);
  b.add(geo, color, M(a.x, a.y, a.z));
}

/** 水面から少し顔を出す睡蓮と、噴水の石積みに焼き込んだ菱形の陶片。水面と歩ける縁はそのまま使う。 */
export function dressTownFountain(solid: GeoBatch, detail: GeoBatch, x: number, z: number): void {
  solid.setBase(M(x, heightAt(x, z), z));
  detail.setBase(solid.base);
  // 噴水の32面と揃えると石壁への沈みや深度のちらつきが出ない。
  const band = new THREE.LatheGeometry([new THREE.Vector2(3.697, 0.22), new THREE.Vector2(3.676, 0.48)], 32);
  solid.add(band, GLAZE);
  for (let i = 0; i < 32; i++) {
    const angle = (i + 0.5) * Math.PI / 16;
    const r = 3.674;
    detail.add(box(0.21, 0.15, 0.027), i % 4 === 0 ? CREAM : SKY_TILE,
      M(r * Math.sin(angle), 0.35, r * Math.cos(angle), angle, 1, 1, 1, 0, Math.PI / 4));
  }
  for (const [px, pz, scale] of [[2.06, 1.13, 0.85], [-2.16, -0.55, 1]]) {
    for (const [dx, dz, radius, turn] of [[0, 0, 0.39, 0.5], [0.42, 0.3, 0.28, 2.0], [-0.35, 0.26, 0.21, 3.5]]) {
      const disc = new THREE.CircleGeometry(radius * scale, 10, 0.12, 5.85).rotateX(-Math.PI / 2);
      solid.add(disc, dx ? 0x749a62 : 0x628d66, M(px + dx, 0.59, pz + dz, turn));
    }
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3;
      detail.add(sph(0.105, 5, 3), k % 2 ? 0xffddcd : 0xf39ba5,
        M(px + 0.11 * Math.sin(a), 0.69, pz + 0.11 * Math.cos(a), a, 0.66, 1.22, 1.30, -0.55));
    }
    solid.add(sph(0.085, 6, 3), 0xe5af4f, M(px, 0.73, pz));
  }
}

/** 店先の共同井戸。手前の水受けへ寄ると、噴水と同じ仕組みでタンクに水が入る。 */
export function buildMarketPump(solid: GeoBatch, detail: GeoBatch, colliders: Colliders): PoolDef {
  const x = 19.25, z = -6.8, y = heightAt(x, z);
  solid.setBase(M(x, y, z));
  detail.setBase(solid.base);
  // 水受けの内側を空け、水面の前縁をプレイヤーの手が届く高さにする。
  solid.add(box(2.18, 0.18, 2.18), LIMESTONE, M(0, 0.07, 0));
  for (const side of [-1, 1]) {
    solid.add(box(0.16, 0.56, 1.48), CREAM, M(side * 0.89, 0.41, 0.22));
    solid.add(box(1.94, 0.56, 0.16), GLAZE, M(0, 0.41, 0.22 + side * 0.67));
  }
  solid.add(box(1.64, 0.04, 1.18), 0x68c1be, M(0, 0.57, 0.22));
  colliders.addBox(x, y + 0.34, z + 0.22, 1.94, 0.68, 1.5);
  for (let i = -2; i <= 2; i++) {
    detail.add(box(0.16, 0.16, 0.015), CREAM, M(i * 0.33, 0.42, 0.978, 0, 1, 1, 1, 0, Math.PI / 4));
  }

  const mastZ = -0.84;
  const profile = [[0.36, 0.14], [0.36, 0.24], [0.22, 0.32], [0.18, 0.53], [0.21, 1.43],
    [0.29, 1.50], [0.28, 1.65], [0.19, 1.72], [0.17, 2.04], [0.23, 2.08], [0.19, 2.18], [0, 2.22]];
  solid.add(new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), 10), IRON, M(0, 0, mastZ));
  for (const h of [0.32, 1.49, 1.69]) detail.add(cyl(0.24, 0.24, 0.05, 10), BRASS, M(0, h, mastZ));
  rod(solid, [0, 1.66, mastZ], [0, 1.66, -0.16], 0.095, BRASS);
  rod(solid, [0, 1.66, -0.18], [0, 1.52, -0.035], 0.10, BRASS);
  detail.add(cyl(0.023, 0.035, 0.95, 5), 0x9cdad1, M(0, 1.05, -0.03));
  detail.add(new THREE.TorusGeometry(0.18, 0.014, 3, 12).rotateX(Math.PI / 2), 0xb1e5d9, M(0, 0.60, -0.03));
  rod(solid, [-0.25, 1.80, mastZ], [-0.22, 2.14, mastZ], 0.06, BRASS);
  rod(solid, [-0.22, 2.14, mastZ], [-0.88, 1.77, mastZ], 0.06, IRON);
  rod(solid, [-0.88, 1.77, mastZ], [-1.18, 1.44, mastZ], 0.085, WOOD);
  colliders.addCyl(x, z + mastZ, y + 0.12, y + 2.18, 0.23);
  return { x, z: z + 0.58, y: y + 0.60, r: 1.22 };
}

/** 根元から折った菱形の葉。外周の葉ほど傾け、株ごとに読み取れる輪郭にする。 */
function herbLeaves(count: number, width: number, spread: number, height: number): THREE.BufferGeometry {
  const vertices: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = i * 2.4, dx = Math.sin(a), dz = Math.cos(a);
    const reach = spread * (0.65 + 0.08 * (i % 5)), h = height * (0.75 + 0.12 * (i % 4));
    const mx = dx * reach * 0.62, mz = dz * reach * 0.62;
    const root = [dx * 0.03, 0, dz * 0.03], tip = [dx * reach, h, dz * reach];
    const left = [mx - dz * width, h * 0.60, mz + dx * width], right = [mx + dz * width, h * 0.60, mz - dx * width];
    const shoulder = width * 0.73;
    const upperLeft = [dx * reach * 0.86 - dz * shoulder, h * 0.85, dz * reach * 0.86 + dx * shoulder];
    const upperRight = [dx * reach * 0.86 + dz * shoulder, h * 0.85, dz * reach * 0.86 - dx * shoulder];
    const fold = [mx, h * 0.88, mz];
    for (const face of [[root, left, fold], [fold, left, upperLeft], [fold, upperLeft, tip],
      [root, fold, right], [fold, tip, upperRight], [fold, upperRight, right]]) {
      vertices.push(...face[0], ...face[1], ...face[2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.computeVertexNormals();
  return g;
}

/** 海辺へ向かう道の脇。石の縁で腰を下ろせる日時計花壇。 */
export function buildDialBed(solid: GeoBatch, detail: GeoBatch, colliders: Colliders): void {
  const x = -5.2, z = 14.4, y = heightAt(x, z);
  solid.setBase(M(x, y, z));
  detail.setBase(solid.base);
  solid.add(cyl(1.60, 1.68, 0.34, 16), LIMESTONE, M(0, 0.17, 0));
  solid.add(cyl(1.46, 1.46, 0.035, 16), 0x788250, M(0, 0.347, 0));
  colliders.addCyl(x, z, y, y + 0.34, 1.62);
  // 中央の銅板に北を向いた三角の影針を立てる。
  solid.add(cyl(0.26, 0.44, 0.62, 10), CREAM, M(0, 0.62, 0));
  solid.add(cyl(0.68, 0.57, 0.12, 16), IRON, M(0, 0.95, 0));
  solid.add(cyl(0.64, 0.64, 0.022, 16), BRASS, M(0, 1.02, 0));
  const blade = new THREE.Shape();
  blade.moveTo(-0.35, 0); blade.lineTo(0.33, 0); blade.lineTo(0.33, 0.44); blade.closePath();
  solid.add(new THREE.ExtrudeGeometry(blade, { depth: 0.035, bevelEnabled: false }).rotateY(Math.PI / 2), IRON, M(0, 1.035, 0));
  colliders.addCyl(x, z, y + 0.34, y + 1.04, 0.62);
  for (let i = -4; i <= 4; i++) {
    const a = i * Math.PI / 11;
    detail.add(box(0.035, 0.013, i % 2 ? 0.085 : 0.14), IRON, M(Math.sin(a) * 0.52, 1.037, -Math.cos(a) * 0.52, -a));
  }
  for (let i = 0; i < 9; i++) {
    const a = i * Math.PI * 2 / 9, dx = Math.sin(a) * 1.01, dz = Math.cos(a) * 1.01;
    solid.add(herbLeaves(8, 0.11, 0.47, i % 2 ? 0.37 : 0.48), i % 2 ? 0x598465 : 0x829a52, M(dx, 0.36, dz, a), { ao: 0.68 });
    if (i % 2 === 0) {
      detail.add(sph(0.115, 5, 3), 0xc88a90, M(dx, 0.80, dz, a, 1.3, 0.65, 1));
      detail.add(sph(0.06, 5, 3), 0xe6bb65, M(dx, 0.86, dz));
    }
  }
}

export function buildKitchenGarden(solid: GeoBatch, detail: GeoBatch, colliders: Colliders): void {
  const x = 36.7, z = 17.4, y = heightAt(x, z);
  solid.setBase(M(x, y, z));
  detail.setBase(solid.base);
  // 菜園の両端に薄い草地を残し、石の小径に向いた側は歩けるように開ける。
  const lawn = new THREE.Shape();
  const edge = [[-2.88,-2.16],[-2.40,-2.91],[-0.60,-3.01],[1.1,-2.83],[2.42,-2.76],
    [3.02,-1.97],[2.85,-0.08],[3.13,1.32],[2.84,2.49],[1.46,2.94],[-0.49,2.83],[-2.29,2.99],[-2.93,2.36],[-2.78,0.8],[-2.95,-0.54]];
  lawn.moveTo(edge[0][0], -edge[0][1]);
  for (const [lx, lz] of edge.slice(1)) lawn.lineTo(lx, -lz);
  lawn.closePath();
  solid.add(new THREE.ShapeGeometry(lawn).rotateX(-Math.PI / 2), 0x93a66e, M(0, 0.012, 0),
    { jitter: 0.075 });
  // 曲がり角から二列の間を歩ける。畝床を丸ごと一つの立てる面として扱う。
  for (const side of [-1, 1]) {
    const cz = side * 1.68;
    solid.add(box(5.05, 0.29, 1.45), BRICK, M(0, 0.145, cz));
    solid.add(box(4.84, 0.09, 1.25), SOIL, M(0, 0.295, cz));
    for (const edge of [-1, 1]) {
      solid.add(box(5.08, 0.085, 0.12), LIMESTONE, M(0, 0.31, cz + edge * 0.69));
      solid.add(box(0.12, 0.085, 1.28), LIMESTONE, M(edge * 2.47, 0.31, cz));
    }
    colliders.addBox(x, y + 0.17, z + cz, 5.08, 0.34, 1.45);
    for (let i = 0; i < 5; i++) {
      const rx = (i - 2) * 0.93;
      const basil = side === 1;
      solid.add(herbLeaves(basil ? 13 : 19, basil ? 0.16 : 0.05, 0.56, basil ? 0.62 : 0.88),
        basil ? 0x529050 : 0x6c917b, M(rx, 0.34, cz, i * 1.7), { ao: 0.75, top: basil ? 0x8eae5c : 0x9eafa0 });
      if (!basil) for (let stem = 0; stem < 3; stem++) {
        const offset = (stem - 1) * 0.14, h = 0.78 + (i + stem) % 3 * 0.11;
        rod(detail, [rx + offset, 0.45, cz], [rx + 1.4 * offset, h + 0.35, cz + offset], 0.017, 0x648468);
        detail.add(sph(0.09, 5, 3), 0x9b88b3, M(rx + 1.4 * offset, h + 0.36, cz + offset, i, 0.73, 2.1, 0.75));
      }
    }
  }
  for (let i = -2; i <= 2; i++) {
    solid.add(cyl(0.42, 0.46, 0.065, 6), i % 2 ? 0xcfb991 : 0xdcc69f, M(i * 1.04, 0.025, i % 2 * 0.09, i * 0.3, 1.2, 1, 1));
  }

  // 収穫した葉を奥の木枠に干す。横木に通した紐と、下へ垂れた三束。
  for (const side of [-1, 1]) {
    solid.add(cyl(0.068, 0.086, 2.38, 6), WOOD, M(side * 1.30, 1.18, -2.35));
    colliders.addCyl(x + side * 1.30, z - 2.35, y, y + 2.37, 0.085);
  }
  rod(solid, [-1.47, 2.32, -2.35], [1.47, 2.32, -2.35], 0.073, WOOD);
  for (let i = -1; i <= 1; i++) {
    const cx = i * 0.72, h = 1.92 + 0.06 * i;
    rod(solid, [cx, 2.31, -2.35], [cx, h, -2.30], 0.027, BRASS);
    solid.add(herbLeaves(10, 0.07, 0.25, 0.51), 0x8e9b5c, M(cx, h, -2.30, i, 1, 1, 1, Math.PI));
    detail.add(cyl(0.055, 0.055, 0.055, 7), BRICK, M(cx, h - 0.025, -2.30));
  }
}
