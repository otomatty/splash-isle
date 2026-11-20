import * as THREE from 'three';
import type { Colliders } from '../colliders';
import { GeoBatch, M, box, cyl, sph } from '../props';
import { heightAt } from '../terrain';

const OAK = 0xb6804d, TIMBER = 0x664735, LINEN = 0xffedce, TEAL = 0x247d82;
const BRICK = 0xb85436, HONEY = 0xe3ac61, INDIGO = 0x334f80;

// 日よけの奥行きに沿った断面。薄い布の裏面も同じバッチで描く。
function canopyStripe(width: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.90, 2.32);
  shape.lineTo(-0.90, 2.37);
  shape.lineTo(-0.44, 2.54);
  shape.lineTo(0.00, 2.60);
  shape.lineTo(0.44, 2.54);
  shape.lineTo(0.90, 2.37);
  shape.lineTo(0.90, 2.32);
  shape.lineTo(0.44, 2.49);
  shape.lineTo(0.00, 2.55);
  shape.lineTo(-0.44, 2.49);
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false })
    .rotateY(-Math.PI / 2).translate(width / 2, 0, 0);
}

function citrusStall(b: GeoBatch, detail: GeoBatch): void {
  // 通りからも見える柑橘の木札と、箱いっぱいの島みかん。
  b.add(cyl(0.31, 0.31, 0.08, 12).rotateX(Math.PI / 2), 0xe88c25, M(0, 0.55, 0.57));
  b.add(sph(0.13, 6, 3), 0x497145, M(0.13, 0.86, 0.58, 0, 1.25, 0.48, 0.35, 0, 0.38));
  const colors = [0xf1a235, 0xffc74d, 0xe7782f];
  for (const side of [-1, 1]) {
    const cx = side * 0.66;
    b.add(box(1.12, 0.12, 0.78), OAK, M(cx, 1.12, 0));
    for (const z of [-0.36, 0.36]) b.add(box(1.12, 0.15, 0.055), TIMBER, M(cx, 1.21, z));
    for (const x of [-0.53, 0.53]) b.add(box(0.055, 0.15, 0.69), TIMBER, M(cx + x, 1.21, 0));
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 3; i++) {
        const x = cx + (i - 1) * 0.33 + 0.025 * row, z = -0.15 + row * 0.28;
        b.add(sph(0.17, 6, 4), colors[(i + row) % 3], M(x, 1.31, z, i * 0.5, 1, 0.94, 1));
      }
    }
    for (let i = 0; i < 2; i++) {
      const x = cx - 0.18 + i * 0.34;
      detail.add(sph(0.16, 7, 4), colors[1 + i], M(x, 1.50, 0.01));
      detail.add(sph(0.06, 5, 3), 0x506f3f, M(x + 0.04, 1.64, 0.01, 0, 1.4, 0.35, 0.75));
    }
  }
}

function weaversStall(b: GeoBatch, detail: GeoBatch): void {
  // 前掛けの織り模様と、芯と小口が見える横置きの反物。
  b.add(box(1.42, 0.74, 0.05), INDIGO, M(0, 0.62, 0.57));
  for (let i = -1; i <= 1; i++) {
    b.add(box(0.21, 0.21, 0.035), LINEN, M(i * 0.42, 0.65, 0.61, 0, 1, 1, 1, 0, Math.PI / 4));
  }
  const dye = [INDIGO, 0xcb7367, 0x4d9e94];
  for (let i = 0; i < 3; i++) {
    const x = -0.93 + i * 0.33;
    b.add(cyl(0.16, 0.16, 0.77, 9).rotateX(Math.PI / 2), dye[i], M(x, 1.24, 0.04));
    detail.add(cyl(0.085, 0.085, 0.04, 8).rotateX(Math.PI / 2), LINEN, M(x, 1.24, 0.44));
    detail.add(cyl(0.04, 0.04, 0.04, 6).rotateX(Math.PI / 2), TIMBER, M(x, 1.24, 0.46));
  }
  for (let i = 0; i < 4; i++) {
    b.add(box(0.75, 0.095, 0.68 - i * 0.04), i % 2 ? LINEN : dye[2], M(0.66, 1.10 + i * 0.098, 0.03, i % 2 * 0.05));
  }
  detail.add(cyl(0.035, 0.035, 2.43, 5).rotateZ(Math.PI / 2), HONEY, M(0, 2.13, -0.61));
  for (let i = 0; i < 5; i++) {
    const x = -0.90 + i * 0.45;
    detail.add(box(0.38, 0.42 + i % 2 * 0.12, 0.03), dye[i % 3], M(x, 1.94 - i % 2 * 0.06, -0.61));
    detail.add(box(0.38, 0.045, 0.04), LINEN, M(x, 1.79 - i % 2 * 0.12, -0.61));
  }
}

function marketStall(b: GeoBatch, detail: GeoBatch, colliders: Colliders, x: number, z: number, yaw: number, fruit: boolean): THREE.Vector3 {
  const y = heightAt(x, z);
  const base = M(x, y, z, yaw);
  b.setBase(base);
  detail.setBase(base);
  const accent = fruit ? 0xc75e36 : TEAL;
  b.add(box(2.5, 0.94, 1.03), fruit ? 0xd9a46e : 0x739492, M(0, 0.54, 0), { ao: 0.7 });
  b.add(box(2.65, 0.14, 1.17), HONEY, M(0, 0.99, 0));
  for (const side of [-1, 1]) {
    for (const back of [-1, 1]) {
      b.add(box(0.10, 2.38, 0.10), TIMBER, M(1.27 * side, 1.20, 0.67 * back));
    }
    b.add(box(2.7, 0.11, 0.10), OAK, M(0, 2.31, side * 0.67));
  }
  for (let i = 0; i < 7; i++) {
    const sx = (i - 3) * 0.40, color = i % 2 ? LINEN : accent;
    b.add(canopyStripe(0.40), color, M(sx, 0, 0));
    for (const side of [-1, 1]) {
      b.add(box(0.40, i % 2 ? 0.14 : 0.22, 0.05), color, M(sx, i % 2 ? 2.28 : 2.24, side * 0.88));
    }
  }
  if (fruit) citrusStall(b, detail);
  else weaversStall(b, detail);
  colliders.addBox(x, y + 0.53, z, 2.65, 1.06, 1.17, yaw);
  // 頂点の高さと幅の違う3枚の当たり判定で、丸屋根の上でも足が浮かないようにする。
  for (const [offset, depth, top] of [[-0.62, 0.56, 2.50], [0, 0.68, 2.60], [0.62, 0.56, 2.50]]) {
    colliders.addBox(x + Math.sin(yaw) * offset, y + top - 0.065, z + Math.cos(yaw) * offset, 2.8, 0.13, depth, yaw);
  }
  return new THREE.Vector3(x, y + 2.6, z);
}

function loaf(b: GeoBatch, x: number, y: number, z: number, yaw: number): void {
  b.add(sph(0.24, 8, 4), 0xcf884b, M(x, y, z, yaw, 1.52, 0.72, 0.88), { top: 0xf0bf7d });
}

// 朝市の島みかんをパン用に煮る台。広場から来ると、開いた銅鍋と詰めかけの瓶が見える。
function marmaladeTable(b: GeoBatch, detail: GeoBatch, colliders: Colliders, x: number, z: number): void {
  const y = heightAt(x, z), yaw = -Math.PI / 2;
  const base = M(x, y, z, yaw);
  b.setBase(base);
  detail.setBase(base);
  const copper = 0xac6747, peel = 0xf4ab3d, syrup = 0xc26424;
  b.add(box(2.67, 0.16, 0.97), OAK, M(0, 0.89, 0));
  for (const ox of [-1.17, 1.17]) {
    for (const oz of [-0.34, 0.34]) b.add(box(0.13, 0.86, 0.13), TIMBER, M(ox, 0.43, oz));
  }
  b.add(box(2.40, 0.11, 0.78), OAK, M(0, 0.23, 0));
  // 銅鍋は外側と口の折り返しを一緒に旋回させる。両脇の持ち手に木べらが渡る。
  const rim = [[0.25,0], [0.31,0.05], [0.42,0.27], [0.43,0.38], [0.40,0.40], [0.37,0.38], [0.34,0.25]];
  b.add(new THREE.LatheGeometry(rim.map(([r, h]) => new THREE.Vector2(r, h)), 12), copper, M(-0.66, 0.97, 0.04), { ao: 0.75 });
  b.add(cyl(0.37, 0.35, 0.03, 12), syrup, M(-0.66, 1.265, 0.04));
  for (const side of [-1, 1]) b.add(new THREE.TorusGeometry(0.10, 0.026, 4, 8), TIMBER, M(-0.66 + side * 0.48, 1.28, 0.04));
  b.add(box(1.02, 0.045, 0.071), 0xe7be7b, M(-0.69, 1.41, 0.04, 0.23));
  for (const [dx, dz] of [[-0.18, 0.12], [0.03, -0.16], [0.16, 0.14]]) {
    detail.add(cyl(0.075, 0.075, 0.018, 7), peel, M(-0.66 + dx, 1.288, 0.04 + dz));
  }
  for (const [jx, jz, filled] of [[0.22, -0.16, 1], [0.69, -0.17, 1], [0.96, 0.18, 0]]) {
    b.add(cyl(0.14, 0.13, 0.30, 8), filled ? syrup : 0x99a78c, M(jx, 1.13, jz), { top: filled ? 0xe19842 : 0xc8d4b8 });
    b.add(cyl(0.15, 0.15, 0.075, 8), filled ? LINEN : 0x75938e, M(jx, 1.30, jz));
    if (filled) {
      detail.add(box(0.15, 0.11, 0.02), LINEN, M(jx, 1.13, jz + 0.13));
      detail.add(cyl(0.049, 0.049, 0.024, 7).rotateX(Math.PI / 2), peel, M(jx, 1.13, jz + 0.145));
    }
  }
  // 断面を上にした半割りの実と、次の一鍋を待つみかんのかご。
  detail.add(box(0.47, 0.03, 0.31), 0xf3dec1, M(0.32, 0.989, 0.24, 0.09));
  detail.add(cyl(0.105, 0.070, 0.07, 9), peel, M(0.31, 1.039, 0.24));
  detail.add(cyl(0.085, 0.085, 0.011, 9), 0xffcc71, M(0.31, 1.08, 0.24));
  b.add(cyl(0.42, 0.34, 0.30, 10), 0xbe9763, M(0.58, 0.44, 0));
  for (const [ox, oz] of [[0.37,-0.13], [0.68,-0.12], [0.51,0.15], [0.79,0.11]]) {
    detail.add(sph(0.14, 7, 4), peel, M(ox, 0.62, oz));
  }
  colliders.addBox(x, y + 0.49, z, 2.67, 0.98, 0.97, yaw);
}

// 港通りへ曲がる角のパン工房。窯の火口と売り窓を石のカウンターでつなぐ。
function bakery(b: GeoBatch, detail: GeoBatch, colliders: Colliders): void {
  const x = 27.5, z = -9, y = heightAt(x, z);
  const base = M(x, y, z);
  b.setBase(base);
  detail.setBase(base);
  const wall = 0xefc490, trim = 0xffe7bc;
  b.add(box(6.4, 3.58, 4.6), wall, M(0, 1.79, 0), { ao: 0.83 });
  b.add(box(6.5, 0.44, 4.65), 0xa38b76, M(0, 0.22, 0));
  b.add(box(6.62, 0.21, 4.85), BRICK, M(0, 3.63, 0));
  b.add(box(6.42, 0.13, 4.67), 0xd9a578, M(0, 3.79, 0));
  colliders.addBox(x, y + 1.93, z, 6.55, 3.86, 4.74);
  // 港側の搬入口は青緑の板戸。反対側は広場から見える引き違いの格子窓。
  b.add(box(0.14, 2.43, 1.48), trim, M(3.23, 1.22, -0.42));
  b.add(box(0.12, 2.21, 1.27), TEAL, M(3.31, 1.11, -0.42));
  for (const h of [0.40, 1.01, 1.98]) detail.add(box(0.045, 0.10, 1.2), 0x4e9594, M(3.39, h, -0.42));
  detail.add(box(0.09, 0.08, 0.21), HONEY, M(3.41, 0.96, -0.84));
  b.add(box(0.13, 1.43, 2.20), trim, M(-3.23, 1.86, 0.05));
  b.add(box(0.10, 1.18, 1.94), 0x505e62, M(-3.32, 1.86, 0.05));
  b.add(box(0.14, 1.20, 0.09), OAK, M(-3.37, 1.86, 0.05));
  b.add(box(0.14, 0.08, 1.94), OAK, M(-3.37, 1.96, 0.05));
  b.add(box(0.32, 0.13, 2.27), BRICK, M(-3.31, 1.17, 0.05));
  // 石窯の上はパン職人の仕事部屋。煙道の側と店先を後退させ、下屋から上階へ登れる。
  b.add(box(3.62, 2.48, 3.50), 0xf1d8a9, M(0.94, 5.08, -0.24), { ao: 0.86 });
  b.add(box(3.95, 0.22, 3.82), BRICK, M(0.94, 6.42, -0.24));
  colliders.addBox(x + 0.94, y + 5.08, z - 0.24, 3.62, 2.48, 3.50);
  colliders.addBox(x + 0.94, y + 6.42, z - 0.24, 3.95, 0.22, 3.82);
  for (const side of [-1, 1]) {
    const wallZ = -0.24 + side * 1.78;
    for (const wx of [0.12, 1.76]) {
      b.add(box(1.19, 1.42, 0.14), TEAL, M(wx, 5.08, wallZ));
      b.add(box(0.88, 1.16, 0.11), 0x355464, M(wx, 5.08, wallZ + side * 0.10));
      detail.add(box(0.89, 0.08, 0.08), trim, M(wx, 5.21, wallZ + side * 0.17));
    }
    b.add(box(0.11, 1.16, 1.26), 0x355464, M(0.94 + 1.82 * side, 5.09, -0.31));
  }
  // 背の違う煙突の輪郭が、通りから店の目印になる。
  b.add(box(0.95, 1.45, 0.99), wall, M(-1.74, 4.47, -0.7), { ao: 0.8 });
  b.add(box(1.13, 0.15, 1.12), BRICK, M(-1.74, 5.15, -0.7));
  for (const [dx, dz, ht] of [[-0.19, 0.12, 0.56], [0.22, -0.22, 0.84]]) {
    b.add(cyl(0.15, 0.19, ht, 8), BRICK, M(-1.74 + dx, 5.20 + ht / 2, -0.7 + dz));
    b.add(cyl(0.18, 0.18, 0.10, 8), TIMBER, M(-1.74 + dx, 5.20 + ht, -0.7 + dz));
  }
  colliders.addBox(x - 1.74, y + 4.53, z - 0.7, 1.01, 1.36, 1.02);
  colliders.addBox(x - 1.74 + 0.22, y + 5.63, z - 0.7 - 0.22, 0.36, 0.89, 0.36);
  colliders.addBox(x - 1.74 - 0.19, y + 5.50, z - 0.7 + 0.12, 0.36, 0.62, 0.36);

  // 左の石窯のアーチ。くさび石の中心をそれぞれ火口へ向ける。
  b.add(box(1.82, 1.04, 0.30), 0x9f634b, M(-1.77, 0.92, 2.40));
  b.add(cyl(0.84, 0.84, 0.28, 16).rotateX(Math.PI / 2), 0x683d31, M(-1.77, 1.48, 2.43));
  b.add(box(1.05, 0.62, 0.07), 0x59392c, M(-1.77, 1.30, 2.58));
  for (let i = 0; i < 9; i++) {
    const a = (i + 0.5) * Math.PI / 9;
    b.add(box(0.39, 0.40, 0.36), i % 2 ? BRICK : 0xc77652, M(-1.77 + Math.cos(a) * 0.86, 1.48 + Math.sin(a) * 0.86, 2.43, 0, 1, 1, 1, 0, a - Math.PI / 2));
  }
  for (const dx of [-0.87, 0.87]) b.add(box(0.36, 0.53, 0.35), BRICK, M(-1.77 + dx, 1.20, 2.43));
  // 売り窓、折れ戸、ひさしと、その下に並ぶ焼きたてのパン。
  b.add(box(2.55, 1.36, 0.15), TIMBER, M(1.13, 1.84, 2.33));
  for (const side of [-1, 1]) {
    b.add(box(0.40, 1.38, 0.11), TEAL, M(1.13 + side * 1.48, 1.84, 2.37));
    for (let i = 0; i < 5; i++) detail.add(box(0.37, 0.062, 0.08), 0x80afa0, M(1.13 + side * 1.48, 1.36 + i * 0.23, 2.44));
  }
  b.add(box(2.48, 0.09, 0.21), OAK, M(1.13, 1.83, 2.44));
  for (let i = 0; i < 5; i++) detail.add(sph(0.145, 7, 4), HONEY, M(0.24 + i * 0.43, 1.99, 2.43, i * 0.52, 1.26, 0.86, 0.80));
  b.add(box(6.0, 0.95, 0.65), 0xc79069, M(0, 0.47, 2.54));
  b.add(box(6.15, 0.16, 0.85), trim, M(0, 1.02, 2.58));
  colliders.addBox(x, y + 0.55, z + 2.58, 6.15, 1.10, 0.85);
  for (let i = 0; i < 5; i++) loaf(b, -2.12 + i * 0.88, 1.23, 2.64, (i % 2 ? 1 : -1) * 0.28);
  b.add(box(3.7, 0.15, 1.48), TEAL, M(1.14, 2.79, 2.89, 0, 1, 1, 1, 0.13));
  b.add(box(3.7, 0.18, 0.08), 0x8fc1ac, M(1.14, 2.63, 3.60));
  colliders.addBox(x + 1.14, y + 2.79, z + 2.89, 3.7, 0.17, 1.48);
  // 看板の浮き彫り。文字やテクスチャを使わずパンの切り込みで読ませる。
  b.add(box(2.35, 0.52, 0.13), TIMBER, M(0.65, 3.30, 2.35));
  b.add(sph(0.31, 10, 5), HONEY, M(0.65, 3.30, 2.43, 0, 2.48, 0.67, 0.30));
  for (const u of [-0.32, 0, 0.32]) detail.add(box(0.06, 0.20, 0.04), 0x8e5638, M(0.65 + u, 3.32, 2.52, 0, 1, 1, 1, 0, -0.46));
}

function potteryCart(b: GeoBatch, detail: GeoBatch, colliders: Colliders): void {
  const x = 26.1, z = 9.5, y = heightAt(x, z), yaw = -0.16;
  const base = M(x, y, z, yaw);
  b.setBase(base);
  detail.setBase(base);
  b.add(box(3.05, 0.17, 1.35), TIMBER, M(0, 0.77, 0));
  b.add(box(2.8, 0.34, 1.22), 0xbc8d56, M(0, 0.97, 0));
  for (const side of [-1, 1]) {
    b.add(box(1.22, 0.10, 0.10), OAK, M(1.88, 0.72, side * 0.52, 0, 1, 1, 1, 0, 0.08));
    b.add(box(0.11, 0.75, 0.12), TIMBER, M(1.24, 0.39, side * 0.43));
    b.add(new THREE.TorusGeometry(0.40, 0.07, 5, 12), TIMBER, M(-0.52, 0.46, side * 0.72));
    b.add(cyl(0.105, 0.105, 0.15, 8).rotateX(Math.PI / 2), OAK, M(-0.52, 0.46, side * 0.72));
    for (let i = 0; i < 4; i++) b.add(box(0.06, 0.79, 0.065), OAK, M(-0.52, 0.46, side * 0.72, 0, 1, 1, 1, 0, i * Math.PI / 4));
  }
  colliders.addBox(x, y + 0.58, z, 3.1, 1.16, 1.47, yaw);
  // 口を折り返して内側まで作った釉薬の壺。遠目にも見える白い帯を胴にまわす。
  const profile = [[0.12, 0], [0.23, 0.08], [0.31, 0.34], [0.30, 0.46], [0.16, 0.60], [0.17, 0.69], [0.19, 0.70], [0.19, 0.74], [0.14, 0.74], [0.13, 0.61]];
  const points = profile.map(([r, h]) => new THREE.Vector2(r, h));
  for (const [px, pz, size, glaze] of [[-0.98, 0.04, 1.00, TEAL], [-0.40, -0.12, 0.88, BRICK], [0.24, 0.02, 1.18, INDIGO], [0.94, -0.10, 0.74, 0x4e9b91]]) {
    b.add(new THREE.LatheGeometry(points, 9), glaze, M(px, 1.14, pz, 0, size, size, size), { ao: 0.76 });
    detail.add(cyl(0.310 * size, 0.304 * size, 0.065 * size, 9, 1, true), LINEN, M(px, 1.14 + size * 0.32, pz));
  }
}

/** 広場の朝市。最初の日よけの上にヒトデが載る。 */
export function buildTownMarket(b: GeoBatch, detail: GeoBatch, colliders: Colliders): THREE.Vector3[] {
  const fruitTop = marketStall(b, detail, colliders, 9.5, -7.5, 0.9, true);
  const textileTop = marketStall(b, detail, colliders, -10.5, 7, -2.2, false);
  bakery(b, detail, colliders);
  marmaladeTable(b, detail, colliders, 23.55, -7.9);
  potteryCart(b, detail, colliders);
  return [fruitTop, textileTop];
}
