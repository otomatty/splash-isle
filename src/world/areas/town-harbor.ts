import * as THREE from 'three';
import type { Colliders } from '../colliders';
import { GeoBatch, M, box, cyl, sph } from '../props';
import { heightAt } from '../terrain';

const IRON = 0x364b51, ENAMEL = 0x367c79, RUST = 0xb15036;
const TIMBER = 0x8c6443, PLANK = 0xc89b67, CREAM = 0xf4ddae;
const FISH_HOUSE = { x: 118, z: -13.5 };

/** 倉庫から仕分け場まで、荷車の通り道も含めて空けておく。 */
export function inHarborYard(x: number, z: number): boolean {
  return x >= 98 && x <= 124 && z >= -22 && z <= -5;
}

type Point = [number, number, number];

/** クレーンの斜材と網の綱。両端は台のローカル座標。 */
function spar(batch: GeoBatch, a: Point, b: Point, radius: number, color: number): void {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const direction = end.clone().sub(start);
  const geometry = cyl(radius, radius, direction.length(), 5, 1, true);
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  geometry.applyQuaternion(rotation);
  batch.add(geometry, color, M((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2));
}

function loadingDock(b: GeoBatch, detail: GeoBatch, colliders: Colliders): void {
  // 奥の小倉庫の扉は (105, -13.5)。横づけ用の荷台と二段の踏み段。
  const x = 105, z = -11.5;
  const y = Math.max(...[-4.4, 4.4].flatMap(dx => [-2.13, 2.13].map(dz => heightAt(x + dx, z + dz)))) + 0.10;
  b.setBase(M(x, y, z));
  detail.setBase(b.base);
  b.add(box(8.6, 1.55, 4.15), 0x9d9581, M(0, -0.82, 0), { ao: 0.75 });
  b.add(box(8.8, 0.16, 4.25), PLANK, M(0, -0.08, 0));
  colliders.addBox(x, y - 0.8, z, 8.8, 1.6, 4.25);
  b.add(box(3.2, 0.75, 0.9), 0xc6b393, M(0, -0.68, 2.54));
  colliders.addBox(x, y - 0.68, z + 2.54, 3.2, 0.75, 0.9);
  for (const dx of [-3.45, -2.65, 2.65, 3.45]) {
    b.add(box(0.28, 0.67, 0.18), IRON, M(dx, -0.35, 2.13));
  }

  fishTraps(b, detail, colliders, y);
  // 壁付けの品は、傾斜を均した荷台とは別に倉庫の床から測る。
  b.setBase(M(x, heightAt(x, -17) + 0.58, z));
  detail.setBase(b.base);
  // 引き戸の上の雨よけと、手で巻き上げる縞の帆布。
  b.add(box(5, 0.18, 1.55), ENAMEL, M(0, 3.22, -1.5, 0, 1, 1, 1, 0.19));
  for (const dx of [-2.14, 2.14]) {
    spar(b, [dx, 2.45, -1.98], [dx, 3.15, -0.85], 0.065, IRON);
  }
  for (let i = 0; i < 7; i++) {
    detail.add(cyl(0.12, 0.12, 0.68, 8).rotateZ(Math.PI / 2), i % 2 ? CREAM : ENAMEL, M(-2.04 + i * 0.68, 3, -0.72));
  }

  // 冷蔵庫の排気筒と救命浮環。倉庫正面のしるしは左隣にある。
  for (const dx of [-2.65, 2.25]) {
    b.add(cyl(0.31, 0.37, 1.13, 8), 0x738888, M(dx, 5.77, -6.6));
    b.add(cyl(0.13, 0.57, 0.27, 8), IRON, M(dx, 6.34, -6.6));
  }
  for (let i = 0; i < 8; i++) {
    const ring = new THREE.TorusGeometry(0.42, 0.103, 5, 3, Math.PI / 4).rotateZ(i * Math.PI / 4);
    detail.add(ring, i % 2 ? CREAM : RUST, M(-3.1, 1.47, -1.88));
  }
  for (const dx of [-0.99, 0.99]) {
    spar(detail, [dx, 0.25, -1.85], [-dx, 2.44, -1.85], 0.05, 0x748f98);
  }

  // 桟橋道から見える手回し揚貨機。二股のブームの間に滑車が入る。
  const cx = 111.4, cz = -8.2, cy = heightAt(cx, cz);
  b.setBase(M(cx, cy, cz));
  detail.setBase(b.base);
  b.add(cyl(1.04, 1.22, 0.72, 12), 0xb0a495, M(0, 0.19, 0));
  b.add(cyl(0.64, 0.82, 0.72, 10), IRON, M(0, 0.88, 0));
  b.add(cyl(0.29, 0.46, 3.4, 8), ENAMEL, M(0, 2.85, 0), { top: 0x619c8b });
  colliders.addCyl(cx, cz, cy - 0.5, cy + 0.54, 1.12);
  colliders.addCyl(cx, cz, cy + 0.54, cy + 4.55, 0.4);
  const tip = 3.65;
  for (const side of [-1, 1]) {
    const dz = side * 0.25;
    spar(b, [0, 1.8, dz], [tip, 4.8, dz], 0.13, ENAMEL);
    spar(b, [0, 4.36, dz], [tip, 4.8, dz], 0.075, IRON);
    spar(detail, [0.25, 2.05, dz], [1.2, 4.48, dz], 0.055, ENAMEL);
    spar(detail, [1.2, 4.48, dz], [2.2, 3.6, dz], 0.055, ENAMEL);
    b.add(cyl(0.41, 0.41, 0.09, 12).rotateX(Math.PI / 2), RUST, M(0, 1.73, side * 0.48));
  }
  b.add(cyl(0.28, 0.28, 1.05, 10).rotateX(Math.PI / 2), TIMBER, M(0, 1.73, 0));
  detail.add(box(0.1, 0.55, 0.12), IRON, M(0, 1.47, 0.6));
  detail.add(cyl(0.065, 0.065, 0.32, 6).rotateX(Math.PI / 2), PLANK, M(0, 1.21, 0.75));
  b.add(cyl(0.24, 0.24, 0.5, 10).rotateX(Math.PI / 2), RUST, M(tip, 4.8, 0));
  spar(b, [tip + 0.18, 4.78, 0], [tip + 0.18, 2.12, 0], 0.038, IRON);
  // 荷はベルトで吊って、見えている木箱にだけ当たり判定を付ける。
  const load = tip + 0.18;
  b.add(box(1.4, 0.86, 0.98), PLANK, M(load, 1.13, 0), { ao: 0.73 });
  colliders.addBox(cx + load, cy + 1.13, cz, 1.4, 0.86, 0.98);
  for (const dx of [-0.48, 0.48]) {
    b.add(box(0.12, 0.92, 1.02), RUST, M(load + dx, 1.13, 0));
    for (const dz of [-0.41, 0.41]) spar(b, [load + dx, 1.58, dz], [load, 2.13, 0], 0.028, TIMBER);
  }
}

/** 倉庫と桟橋を往復する二輪の荷車。漁具と標識浮きを荷台に積んでいる。 */
function handcart(b: GeoBatch, fine: GeoBatch, colliders: Colliders): void {
  const x = 102, z = -6.5, yaw = 0.23, y = heightAt(x, z);
  b.setBase(M(x, y, z, yaw));
  fine.setBase(b.base);
  b.add(box(2.45, 0.2, 1.26), PLANK, M(0, 0.65, 0));
  b.add(box(0.11, 0.52, 1.25), TIMBER, M(-1.16, 0.97, 0));
  for (const side of [-1, 1]) {
    b.add(box(2.35, 0.16, 0.09), ENAMEL, M(0, 0.9, side * 0.58));
    spar(b, [0.65, 0.54, side * 0.45], [2.38, 0.97, side * 0.45], 0.075, TIMBER);
    const wheel = new THREE.TorusGeometry(0.48, 0.074, 4, 10);
    b.add(wheel, IRON, M(-0.4, 0.52, side * 0.73));
    for (let i = 0; i < 3; i++) {
      b.add(box(0.93, 0.07, 0.075), PLANK, M(-0.4, 0.52, side * 0.73, 0, 1, 1, 1, 0, i * Math.PI / 3));
    }
    b.add(box(0.14, 0.54, 0.14), IRON, M(0.77, 0.28, side * 0.48));
  }
  colliders.addBox(x, y + 0.7, z, 2.45, 1.02, 1.43, yaw);
  for (const [dx, dz] of [[-0.55, 0], [0.12, 0.13], [0.65, -0.05]]) {
    fine.add(sph(0.24, 8, 5), RUST, M(dx, 1.04, dz, 0, 0.86, 1.25, 0.86), { top: 0xe79155 });
    fine.add(cyl(0.21, 0.21, 0.08, 8), CREAM, M(dx, 1.03, dz));
    fine.add(cyl(0.055, 0.055, 0.12, 6), TIMBER, M(dx, 1.34, dz));
  }
}

/** 魚籠を支える蒲鉾形の竹枠。手前の丸い漏斗を抜けると奥が狭くなる。 */
function fishTraps(b: GeoBatch, fine: GeoBatch, colliders: Colliders, deck: number): void {
  for (const [x, z, yaw] of [[107.9, -12.32, 0.1], [107.1, -10.43, -0.55]]) {
    b.setBase(M(x, deck, z, yaw));
    fine.setBase(b.base);
    b.add(box(1.3, 0.075, 1.41), TIMBER, M(0, 0.045, 0));
    colliders.addBox(x, deck + 0.35, z, 1.31, 0.7, 1.40, yaw);
    for (const dz of [-0.64, -0.34, 0, 0.34, 0.64]) {
      const hoop = new THREE.TorusGeometry(1, 0.05, 4, 8, Math.PI).scale(0.62, 0.64, 0.64);
      (Math.abs(dz) === 0.34 ? fine : b).add(hoop, PLANK, M(0, 0.09, dz));
    }
    for (const a of [0.21, 0.68, 1.18, 1.96, 2.46, 2.93]) {
      b.add(box(0.073, 0.06, 1.39), 0x967542, M(0.63 * Math.cos(a), 0.09 + 0.64 * Math.sin(a), 0, 0, 1, 1, 1, 0, a));
    }
    // 前後を竹のすのこで閉じ、手前の漏斗だけに開口を残す。
    for (const cx of [-0.48, -0.32, -0.16, 0, 0.16, 0.32, 0.48]) {
      const h = 0.64 * Math.sqrt(1 - (cx / 0.62) ** 2);
      fine.add(box(0.054, h, 0.045), PLANK, M(cx, 0.09 + h / 2, -0.64));
      if (Math.abs(cx) > 0.24) fine.add(box(0.054, h, 0.045), PLANK, M(cx, 0.09 + h / 2, 0.64));
    }
    b.add(new THREE.TorusGeometry(0.225, 0.033, 4, 10), TIMBER, M(0, 0.34, 0.67));
    fine.add(new THREE.TorusGeometry(0.12, 0.02, 4, 8), CREAM, M(0, 0.31, 0.18));
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, cx = Math.cos(a), sy = Math.sin(a);
      spar(fine, [0.225 * cx, 0.34 + 0.225 * sy, 0.67], [0.12 * cx, 0.31 + 0.12 * sy, 0.18], 0.019, PLANK);
    }
  }
}

function cutFish(): THREE.Shape {
  // 尾で吊るした開き。左右の身の間に切れ目が見える輪郭。
  const shape = new THREE.Shape();
  shape.moveTo(-0.16, 0.16);
  for (const [x, y] of [[0, 0.10], [0.16, 0.16], [0.055, -0.04], [0.20, -0.21],
    [0.26, -0.43], [0.22, -0.65], [0.11, -0.74], [0, -0.57], [-0.13, -0.75],
    [-0.23, -0.65], [-0.26, -0.44], [-0.21, -0.22], [-0.055, -0.04]]) shape.lineTo(x, y);
  shape.closePath();
  return shape;
}

/** 荷車道と漁協の間の物干し。尾を挟んで吊り、銀皮の縁・朱色の身・斜めの骨を見せる。 */
function catchDryer(b: GeoBatch, fine: GeoBatch, colliders: Colliders): void {
  const x = 119, z = -9.35, y = heightAt(x, z), spread = 1.75;
  const rack = M(x, y, z);
  b.setBase(rack);
  for (const end of [-spread, spread]) {
    for (const side of [-1, 1]) spar(b, [end, -0.20, side * 0.49], [end, 2.12, side * -0.04], 0.068, TIMBER);
    colliders.addBox(x + end, y + 0.98, z, 0.15, 2.15, 0.82);
  }
  spar(b, [-spread - 0.15, 2.02, 0], [spread + 0.15, 2.02, 0], 0.065, PLANK);
  const shape = cutFish();
  for (let i = 0; i < 5; i++) {
    const dx = (i - 2) * 0.65, turn = [0.25, -0.40, 0.14, 0.52, -0.17][i];
    const scale = i % 2 ? 0.8 : 1;
    const center = rack.clone().multiply(M(dx, 1.78, 0, turn, scale, scale, scale));
    b.setBase(center);
    fine.setBase(center);
    b.add(box(0.07, 0.19, 0.12), 0x68513b, M(0, 0.16, 0));
    b.add(new THREE.ExtrudeGeometry(shape, { depth: 0.065, bevelEnabled: false }), 0x6d827d, undefined, { top: 0xa5aba0 });
    // 身は表側だけ。風で向きの違う魚は裏に回ると銀皮が見える。
    b.add(new THREE.ShapeGeometry(shape), i % 2 ? 0xd68c67 : 0xebac81, M(0, -0.02, 0.07, 0, 0.83, 0.92, 1));
    for (const side of [-1, 1]) {
      for (const h of [-0.22, -0.34, -0.46]) {
        spar(fine, [0, h + 0.03, 0.076], [side * (h === -0.22 ? 0.12 : 0.16), h - 0.065, 0.076], 0.012, 0xffdfb6);
      }
    }
  }
}

/** 支柱の内側に合羽とゴム長を置く。市場側の通り抜けと裏の昇り口を空ける。 */
function oilskins(b: GeoBatch, fine: GeoBatch, colliders: Colliders, x: number, y: number, z: number): void {
  const base = M(x + 3.45, y, z, Math.PI / 2);
  b.setBase(base);
  fine.setBase(base);
  const coat = new THREE.Shape();
  coat.moveTo(-0.15, 0.52);
  for (const [px, py] of [[0, 0.43], [0.15, 0.52], [0.36, 0.45], [0.49, 0.03], [0.38, -0.025],
    [0.26, 0.17], [0.32, -0.56], [-0.32, -0.56], [-0.26, 0.17], [-0.38, -0.025], [-0.49, 0.03], [-0.36, 0.45]]) coat.lineTo(px, py);
  coat.closePath();
  b.add(box(3.6, 0.10, 0.10), TIMBER, M(0, 2.35, 0));
  b.add(box(0.06, 0.22, 0.09), IRON, M(0.25, 2.23, 0));
  b.add(new THREE.ExtrudeGeometry(coat, { depth: 0.11, bevelEnabled: false }), 0xe9ac38, M(0.25, 1.64, 0), { top: 0xffce5e });
  fine.add(box(0.035, 0.95, 0.035), 0xac7133, M(0.25, 1.57, 0.115));
  fine.add(box(0.21, 0.17, 0.035), 0xc58a26, M(0.09, 1.48, 0.115));
  for (const [pos, angle] of [[0.04, -0.12], [0.42, 0.15]]) {
    b.add(cyl(0.13, 0.10, 0.44, 8), 0x354f5d, M(pos, 0.27, 0.12, angle));
    b.add(sph(0.16, 8, 4), 0x354f5d, M(pos, 0.12, 0.23, angle, 0.87, 0.62, 1.45));
    fine.add(cyl(0.138, 0.13, 0.044, 8), CREAM, M(pos, 0.49, 0.12));
  }
  colliders.addBox(x + 3.45, y + 1.36, z - 0.25, 0.18, 1.48, 0.91);
}

/** 網目は奥の梁に掛けて、上綱の両端に浮きを結んだもの。 */
function dryingNet(b: GeoBatch, fine: GeoBatch): void {
  const half = 2.72, bottom = 1.18, height = 1.42, z = -1.82;
  b.add(box(5.9, 0.1, 0.13), TIMBER, M(0, bottom + height, z));
  for (const side of [-1, 1]) {
    for (let i = 0; i <= 12; i++) {
      // 網の両端で斜めの綱を切って、長方形の干し網にする。
      const x0 = -half - 1.12 + i * 0.56;
      const from = Math.max(0, (-half - x0) / 1.12);
      const to = Math.min(1, (half - x0) / 1.12);
      if (from >= to) continue;
      const netPoint = (t: number): Point => [x0 + t * 1.12, bottom + (side > 0 ? t : 1 - t) * height, z];
      spar(fine, netPoint(from), netPoint(to), 0.019, 0x467571);
    }
  }
  for (let i = 0; i < 9; i++) {
    fine.add(sph(0.1, 6, 4), i % 3 ? CREAM : RUST, M(-half + i * half / 4, bottom + height + 0.045, z));
  }
}

/** せり場の二階は漁協の帳場。裏階段を上がり、海側の開いた戸口から入れる。 */
function tallyOffice(b: GeoBatch, fine: GeoBatch, colliders: Colliders, x: number, y: number, z: number): void {
  const floor = 3.16, eave = 6.06, width = 7.68, depth = 4.12;
  const siding = 0xb7cebe, sash = 0xffecbd, glass = 0x426578;
  const solid = (cx: number, cy: number, cz: number, w: number, h: number, d: number, color: number) => {
    b.add(box(w, h, d), color, M(cx, cy, cz), { ao: 0.9 });
    colliders.addBox(x + cx, y + cy, z + cz, w, h, d);
  };
  solid(0, floor - 0.12, 0, width + 0.3, 0.24, depth + 0.3, ENAMEL);
  const wallH = eave - floor, mid = (eave + floor) / 2;
  solid(0, mid, depth / 2, width, wallH, 0.16, siding);
  for (const side of [-1, 1]) solid(side * (width / 2 - 0.08), mid, 0, 0.16, wallH, depth, siding);
  // 裏壁の間に幅1.4 mの戸口を切り、引き戸を壁沿いに寄せる。
  const back = -depth / 2, doorX = 2, jambL = doorX - 0.7, jambR = doorX + 0.7;
  solid((jambL - width / 2) / 2, mid, back, width / 2 + jambL, wallH, 0.16, siding);
  solid((jambR + width / 2) / 2, mid, back, width / 2 - jambR, wallH, 0.16, siding);
  solid(doorX, eave - 0.31, back, 1.4, 0.62, 0.16, siding);
  b.add(box(1.38, 2.2, 0.1), ENAMEL, M(jambL - 0.7, floor + 1.1, back - 0.11));
  fine.add(box(3, 0.09, 0.12), IRON, M(doorX - 0.7, floor + 2.25, back - 0.15));

  // 通りに面した連窓と、見張りの窓がある妻側。窓枠は低品質でも残す。
  for (const dx of [-2.47, 0, 2.47]) {
    b.add(box(1.96, 1.39, 0.1), sash, M(dx, mid + 0.12, depth / 2 + 0.11));
    b.add(box(1.73, 1.16, 0.07), glass, M(dx, mid + 0.12, depth / 2 + 0.18), { top: 0x719896 });
    b.add(box(0.075, 1.17, 0.07), sash, M(dx, mid + 0.12, depth / 2 + 0.23));
    fine.add(box(1.75, 0.065, 0.06), sash, M(dx, mid + 0.38, depth / 2 + 0.23));
  }
  for (const side of [-1, 1]) {
    const wx = side * (width / 2 + 0.03);
    b.add(box(0.1, 1.2, 1.39), sash, M(wx, mid + 0.13, 0));
    b.add(box(0.11, 0.98, 1.16), glass, M(wx + side * 0.055, mid + 0.13, 0), { top: 0x719896 });
    const end = new THREE.Shape();
    end.moveTo(-depth / 2, 0);
    end.lineTo(depth / 2, 0);
    end.lineTo(0, 0.6);
    end.closePath();
    const gable = new THREE.ExtrudeGeometry(end, { depth: 0.14, bevelEnabled: false }).rotateY(Math.PI / 2);
    b.add(gable, ENAMEL, M(side * width / 2 - (side > 0 ? 0.14 : 0), eave - 0.03, 0));
  }
  const ridge = 6.65, pitch = 0.28;
  for (const side of [-1, 1]) {
    b.add(box(8.45, 0.13, 2.62), 0x437e91, M(0, ridge - 0.35, side * 1.24, 0, 1, 1, 1, side * pitch), { top: 0x5c9aac });
    fine.add(box(1.25, 0.05, 2.6), CREAM, M(1.95, ridge - 0.26, side * 1.24, 0, 1, 1, 1, side * pitch));
  }
  b.add(box(8.5, 0.14, 0.17), IRON, M(0, ridge + 0.03, 0));
  for (const [dz, top] of [[0, ridge + 0.07], [-1.66, ridge - 0.39], [1.66, ridge - 0.39]]) {
    colliders.addBox(x, y + top - 0.16, z + dz, 8.45, 0.32, 1.66);
  }

  // 倉庫裏の勾配に合わせて最下段を決め、歩いて上がれる蹴上げにする。
  const stairZ = -2.87, tread = 0.56, steps = 11, firstX = -4.65;
  const foot = heightAt(x + firstX - tread / 2, z + stairZ) - y;
  const landing = floor - 0.11; // 戸口の敷居を一段上げる
  const rise = (landing - foot) / steps;
  for (let i = 0; i < steps - 1; i++) {
    const cx = firstX + i * tread, top = foot + (i + 1) * rise;
    solid(cx, top - 0.085, stairZ, tread + 0.01, 0.17, 1.47, PLANK);
    if (i % 4 === 0) {
      b.add(box(0.09, 0.86, 0.09), ENAMEL, M(cx, top + 0.4, stairZ - 0.69));
    }
  }
  const lastX = firstX + (steps - 1) * tread;
  // 外桁を渡し、下側をプレイヤーが通れる木造階段にする。
  for (const side of [-1, 1]) {
    const edge = stairZ + side * 0.67;
    spar(b, [firstX, foot + rise - 0.2, edge], [lastX, landing - 0.2, edge], 0.11, TIMBER);
  }
  spar(b, [firstX, foot + rise + 0.81, stairZ - 0.69], [lastX, landing + 0.81, stairZ - 0.69], 0.05, ENAMEL);
  const landingStart = lastX - tread / 2, landingEnd = 3.16;
  solid((landingStart + landingEnd) / 2, landing - 0.10, stairZ, landingEnd - landingStart, 0.20, 1.6, PLANK);
  b.add(box(0.10, 0.85, 0.10), ENAMEL, M(landingEnd, landing + 0.4, stairZ - 0.72));
  b.add(box(landingEnd - lastX, 0.10, 0.1), ENAMEL, M((landingEnd + lastX) / 2, landing + 0.81, stairZ - 0.72));
  b.add(box(0.1, 0.85, 0.1), TIMBER, M(landingEnd, landing + 0.4, stairZ + 0.67));
  b.add(box(0.1, 0.1, 1.4), ENAMEL, M(landingEnd, landing + 0.81, stairZ));

  // 室内の帳付け台と、濡れた手でも読める厚い帳簿。
  solid(-2.04, floor + 0.4, 0.95, 2.2, 0.8, 0.82, PLANK);
  fine.add(box(0.75, 0.065, 0.51), IRON, M(-1.8, floor + 0.85, 0.91, -0.12));
  fine.add(box(0.69, 0.05, 0.46), CREAM, M(-1.8, floor + 0.90, 0.91, -0.12));
}

/** 長靴で入れる吹きさらしの仕分け場。魚箱・氷・台ばかりは作業台の上。 */
function fishHouse(b: GeoBatch, fine: GeoBatch, colliders: Colliders): void {
  const { x, z } = FISH_HOUSE;
  const y = Math.max(...[-3.5, 3.5].flatMap(dx => [-1.8, 1.8].map(dz => heightAt(x + dx, z + dz)))) + 0.1;
  b.setBase(M(x, y, z));
  fine.setBase(b.base);
  b.add(box(7.8, 1.5, 4.6), 0xb1a68e, M(0, -0.78, 0), { ao: 0.75 });
  b.add(box(7.86, 0.12, 4.66), 0xd6cbb4, M(0, -0.06, 0));
  colliders.addBox(x, y - 0.75, z, 7.86, 1.5, 4.66);
  for (const dx of [-3.48, 3.48]) {
    for (const dz of [-1.85, 1.85]) {
      b.add(box(0.2, 3.05, 0.2), TIMBER, M(dx, 1.52, dz));
      colliders.addBox(x + dx, y + 1.52, z + dz, 0.2, 3.05, 0.2);
    }
    b.add(box(0.17, 0.24, 4.3), TIMBER, M(dx, 2.93, 0));
    for (const side of [-1, 1]) spar(fine, [dx, 2.38, side * 1.85], [dx, 2.89, side * 1.05], 0.06, TIMBER);
  }
  tallyOffice(b, fine, colliders, x, y, z);

  dryingNet(b, fine);
  b.add(box(5.3, 0.14, 1.46), PLANK, M(-0.36, 0.92, 0.21));
  for (const dx of [-2.65, 1.96]) {
    for (const dz of [-0.38, 0.8]) b.add(box(0.14, 0.88, 0.14), TIMBER, M(dx, 0.44, dz));
  }
  colliders.addBox(x - 0.36, y + 0.49, z + 0.21, 5.3, 0.98, 1.46);
  for (const dx of [-1.94, -0.40]) {
    // 浅いせり箱。魚の銀腹・青い背・三角の尾は色付きの小面だけで描く。
    b.add(box(1.38, 0.11, 1), 0x8ba8a8, M(dx, 1.05, 0.21));
    for (const side of [-1, 1]) {
      b.add(box(1.41, 0.22, 0.07), 0xae8051, M(dx, 1.12, 0.21 + side * 0.49));
      b.add(box(0.07, 0.22, 0.94), PLANK, M(dx + side * 0.66, 1.12, 0.21));
    }
    for (let i = 0; i < 3; i++) {
      const fz = -0.08 + i * 0.29;
      fine.add(sph(1, 7, 4), 0xc9e3d9, M(dx + 0.05, 1.155, fz, i * 0.06 - 0.07, 0.37, 0.10, 0.12), { top: 0x408696 });
      fine.add(cyl(0.12, 0.018, 0.19, 3).rotateZ(Math.PI / 2), 0x457e85, M(dx - 0.36, 1.16, fz, 0, 1, 0.48, 1));
    }
  }
  // 台ばかりの目盛板は正面へ。円盤と針を同じ頂点カラーバッチにまとめる。
  b.add(box(0.69, 0.13, 0.62), ENAMEL, M(1.42, 1.05, 0.2));
  b.add(cyl(0.24, 0.3, 0.35, 8), ENAMEL, M(1.42, 1.27, 0.2));
  b.add(cyl(0.37, 0.18, 0.13, 10), IRON, M(1.42, 1.51, 0.2));
  fine.add(cyl(0.21, 0.21, 0.055, 12).rotateX(Math.PI / 2), CREAM, M(1.42, 1.31, 0.46));
  fine.add(box(0.024, 0.17, 0.025), RUST, M(1.39, 1.36, 0.49, 0, 1, 1, 1, 0, 0.62));
  oilskins(b, fine, colliders, x, y, z);
}

export function buildHarborYard(matte: GeoBatch, detail: GeoBatch, colliders: Colliders): void {
  loadingDock(matte, detail, colliders);
  handcart(matte, detail, colliders);
  catchDryer(matte, detail, colliders);
  fishHouse(matte, detail, colliders);
}
