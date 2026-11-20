import * as THREE from 'three';
import type { Colliders } from '../colliders';
import { GeoBatch, M, box, cyl } from '../props';
import { heightAt, type PathDef } from '../terrain';

type Crop = 'citrus' | 'flowers' | 'terrace';
interface Field {
  x: number; z: number; length: number; width: number;
  cos: number; sin: number; crop: Crop;
}

function plot(x: number, z: number, length: number, width: number, degrees: number, crop: Crop): Field {
  const angle = degrees * Math.PI / 180;
  return { x, z, length, width, cos: Math.cos(angle), sin: Math.sin(angle), crop };
}

// 北の山腹は段畑と果樹。水際の草地は潮風に沿って花畑と柑橘園を交互に並べる。
// 灯台の裾・泳ぐ浜・北の大岩と桟橋への道を空け、地形の傾きに沿って畝を振る。
const north = [
  plot(-36, -118, 37, 14, -8, 'citrus'), plot(-43, -138, 34, 12, -16, 'terrace'),
  plot(-13, -138, 26, 10, 12, 'terrace'), plot(-4, -112, 21, 13, 8, 'flowers'),
  plot(21, -128, 25, 12, 17, 'citrus'), plot(37, -108, 21, 10, 19, 'terrace'),
  plot(-69, -116, 18, 10, -14, 'citrus'), plot(-74, -125, 16, 8, -19, 'terrace'),
  plot(-56, -152, 22, 9, -12, 'terrace'),
];
const southwest = [
  plot(-111, 57, 21, 8, 55, 'flowers'), plot(-93, 76, 23, 13, 37, 'citrus'),
  plot(-73, 92, 28, 10, 25, 'flowers'), plot(-49, 108, 22, 10, 12, 'citrus'),
  plot(-33, 113, 13, 8, -12, 'flowers'),
];
const southeast = [
  plot(40, 108, 18, 8, -10, 'flowers'), plot(62, 101, 21, 10, -26, 'citrus'),
  plot(86, 84, 19, 9, -38, 'flowers'), plot(110, 66, 17, 8, -51, 'citrus'),
];
const east = [plot(132, 22, 15, 9, 82, 'flowers'), plot(129, -17, 12, 8, -57, 'citrus')];
const districts = [north, southwest, southeast, east];

function point(f: Field, u: number, v: number): [number, number] {
  return [f.x + u * f.cos - v * f.sin, f.z + u * f.sin + v * f.cos];
}

export const outskirtPaths: PathDef[] = [
  { width: 2.0, pts: [[-18, -97], [-18, -105], [-22, -128], [-32, -143], [-44, -149]] },
  { width: 2.1, pts: [[-78, -111], [-62, -120], [-47, -127], [-22, -128], [-6, -124], [9, -119], [28, -111]] },
  { width: 1.8, pts: [[-110, 48], [-101, 64], [-82, 81], [-67, 90], [-57, 100.5], [-39, 105.2], [-28, 108]] },
  { width: 1.8, pts: [[31, 101], [48, 102], [69, 91], [83, 79], [99, 71], [106, 60]] },
];
for (const fields of districts) {
  for (const f of fields) {
    // 軽く重なる2本の帯で角の丸い畑を土のマスクに焼く。
    const span = (f.length - f.width * 0.58) / 2;
    for (const v of [-f.width * 0.21, f.width * 0.21]) {
      outskirtPaths.push({ width: f.width * 0.58, pts: [point(f, -span, v), point(f, span, v)] });
    }
  }
}

const soil = new THREE.Color(0x986c4b), leaf = new THREE.Color(0x678447), foliage = new THREE.Color(0x86a658);
const earth = new THREE.Color(0xb98c62), darkSoil = new THREE.Color(0xa07e50);
const stone = new THREE.Color(0x9a8265), cap = new THREE.Color(0xd2b993);
const blossoms = [0xf5a363, 0xf2c85b, 0xd9879b, 0xffefd4].map(c => new THREE.Color(c));

/** 島の出荷箱。青い横板の柑橘マークは浜に着いた箱にも同じように残る。 */
export function citrusCrate(b: GeoBatch, detail: GeoBatch, base: THREE.Matrix4): void {
  b.setBase(base); detail.setBase(base);
  b.add(box(1.15, 0.40, 0.86), 0x966244, M(0, 0.22, 0));
  for (const side of [-1, 1]) {
    b.add(box(1.23, 0.15, 0.065), 0x317880, M(0, 0.18, side * 0.46));
    b.add(box(1.23, 0.09, 0.065), 0xdca56c, M(0, 0.41, side * 0.46));
    for (const dx of [-0.55, 0.55]) detail.add(box(0.09, 0.49, 0.08), 0xe0ad77, M(dx, 0.25, side * 0.47));
  }
  detail.add(cyl(0.10, 0.10, 0.025, 8).rotateX(Math.PI / 2), 0xffac38, M(0, 0.20, 0.51));
  detail.add(box(0.11, 0.045, 0.027), 0xc4cf68, M(0.05, 0.30, 0.51, 0, 1, 1, 1, 0, 0.31));
  for (let i = 0; i < 8; i++) {
    const x = ((i % 4) - 1.5) * 0.265, z = (i < 4 ? -1 : 1) * 0.18;
    b.add(new THREE.IcosahedronGeometry(0.155), i % 3 ? 0xf59734 : 0xffbf42, M(x, 0.45, z, i));
  }
}

/** 柑橘園の端で選果・計量し、同じ箱を隣の荷車へ積み替える。 */
function packingYard(b: GeoBatch, detail: GeoBatch, colliders: Colliders): void {
  const x = 51, z = 111, y = heightAt(x, z), stand = M(x, y, z);
  b.setBase(stand); detail.setBase(stand);
  const wood = 0x946748, timber = 0xc89661, blue = 0x317880;
  // 背の高い木枠から秤を吊る。吊り秤の円盤と下げ皿は浜道からも見える。
  for (const dx of [-1.9, 1.9]) {
    b.add(box(0.17, 3.28, 0.17), wood, M(dx, 1.40, -0.56));
    b.add(box(0.16, 1.39, 0.15), timber, M(dx, 0.48, 0.56));
  }
  b.add(box(4.11, 0.18, 0.18), timber, M(0, 2.97, -0.56));
  for (let i = 0; i < 5; i++) b.add(box(0.82, 0.10, 1.24), i % 2 ? 0xe7b94f : 0xffe9bc, M((i - 2) * 0.82, 2.95, -0.83, 0, 1, 1, 1, -0.17));
  b.add(box(4.12, 0.16, 1.54), timber, M(0, 1.03, 0));
  colliders.addBox(x, y + 0.47, z, 4.12, 1.28, 1.54);
  const sx = -0.86;
  b.add(cyl(0.045, 0.045, 0.31, 6), blue, M(sx, 2.71, -0.55));
  b.add(cyl(0.30, 0.30, 0.18, 16).rotateX(Math.PI / 2), blue, M(sx, 2.43, -0.54));
  b.add(cyl(0.24, 0.24, 0.04, 12).rotateX(Math.PI / 2), 0xffebbf, M(sx, 2.43, -0.43));
  b.add(box(0.034, 0.18, 0.04), 0xbc583e, M(sx + 0.04, 2.49, -0.40, 0, 1, 1, 1, 0, -0.58));
  for (const side of [-1, 1]) b.add(cyl(0.020, 0.020, 0.63, 5), blue, M(sx + 0.12 * side, 1.89, -0.52, 0, 1, 1, 1, 0, side * 0.41));
  b.add(cyl(0.33, 0.24, 0.10, 10), blue, M(sx, 1.55, -0.52));
  b.add(new THREE.IcosahedronGeometry(0.17), 0xffae39, M(sx, 1.69, -0.52));
  citrusCrate(b, detail, stand.clone().multiply(M(0.73, 1.11, 0.03, 0.07)));
  const crateX = x + 1.02, crateZ = z + 1.52, crateY = heightAt(crateX, crateZ);
  citrusCrate(b, detail, M(crateX, crateY, crateZ, -0.14));
  colliders.addBox(crateX, crateY + 0.25, crateZ, 1.18, 0.50, 0.94, -0.14);
  // 一本の車軸と二本の引き手。浜の方に向けて置いた積み荷を農園側からも見通せる。
  const cartX = 47.4, cartZ = 112.6, cartY = heightAt(cartX, cartZ), yaw = -0.60;
  const cart = M(cartX, cartY, cartZ, yaw);
  b.setBase(cart); detail.setBase(cart);
  b.add(box(1.38, 0.14, 2.32), wood, M(0, 0.71, 0));
  b.add(cyl(0.055, 0.055, 1.80, 7).rotateZ(Math.PI / 2), blue, M(0, 0.58, -0.08));
  for (const side of [-1, 1]) {
    const wheel = M(0.84 * side, 0.59, -0.08, Math.PI / 2);
    b.add(new THREE.TorusGeometry(0.50, 0.082, 5, 14), blue, wheel);
    for (let i = 0; i < 4; i++) {
      const spokes = i % 2 ? detail : b;
      spokes.add(box(0.055, 0.96, 0.065), timber, wheel.clone().multiply(M(0, 0, 0, 0, 1, 1, 1, 0, Math.PI * i / 4)));
    }
    b.add(box(0.105, 0.12, 1.77), timber, M(side * 0.54, 0.56, 1.80, 0, 1, 1, 1, 0.25));
    b.add(box(0.09, 0.27, 2.23), timber, M(side * 0.66, 0.90, 0));
  }
  colliders.addBox(cartX, cartY + 0.83, cartZ, 1.60, 1.06, 2.24, yaw);
  for (const row of [-1, 1]) citrusCrate(b, detail, cart.clone().multiply(M(0, 0.78, row * 0.49)));
}

/** 畝・野面積み・花を地区ごとに1メッシュへ。各頂点は町の衝突地形から高さを採る。 */
function beds(fields: Field[], colliders: Colliders): { soil: THREE.BufferGeometry; plants: THREE.BufferGeometry } {
  const positions: number[] = [], colors: number[] = [], indices: number[] = [], plantIndices: number[] = [];
  function vertex(f: Field, u: number, v: number, lift: number, color: THREE.Color): number {
    const [x, z] = point(f, u, v);
    const index = positions.length / 3;
    positions.push(x, heightAt(x, z) + lift, z);
    colors.push(color.r, color.g, color.b);
    return index;
  }
  function ribbon(f: Field, v: number, rim: number, wall: boolean): void {
    const length = f.length - 2.9, count = Math.ceil(length / 2);
    const crown = f.crop === 'terrace' ? foliage : earth;
    for (let i = 0; i < count; i++) {
      // 石は短い目地で区切り、花畑・果樹園の土の畝は途切れずに流す。
      const gap = wall ? 0.04 : 0, w = wall ? 0.43 : 0.50;
      const h = wall ? rim + 0.045 * Math.sin(i * 4.1 + v) : rim;
      const u0 = length * (i / count - 0.5) + gap;
      const u1 = length * ((i + 1) / count - 0.5) - gap;
      const start = positions.length / 3;
      for (const u of [u0, u1]) {
        vertex(f, u, v - w, 0.035, wall ? stone : soil);
        vertex(f, u, v - w * 0.55, h, wall ? cap : crown);
        vertex(f, u, v + w * 0.55, h, wall ? cap : darkSoil);
        vertex(f, u, v + w, 0.035, wall ? stone : soil);
      }
      for (let j = 0; j < 3; j++) {
        const a = start + j;
        indices.push(a, a + 1, a + 4, a + 1, a + 5, a + 4);
      }
      if (wall) indices.push(start, start + 2, start + 1, start, start + 3, start + 2,
        start + 4, start + 5, start + 6, start + 4, start + 6, start + 7);
    }
  }

  fields.forEach((f, index) => {
    const rows = f.crop === 'citrus' ? 2 : Math.max(3, Math.floor(f.width / 2.35));
    for (let row = 0; row < rows; row++) {
      const v = (row / (rows - 1) - 0.5) * (f.width - 3.1);
      ribbon(f, v, f.crop === 'citrus' ? 0.15 : 0.26, false);
      if (f.crop === 'terrace' && row % 2 === 0) ribbon(f, v - 0.75, 0.35, true);
      if (f.crop === 'citrus') continue;
      for (let u = -f.length / 2 + 2; u < f.length / 2 - 1.3; u += f.crop === 'flowers' ? 1.40 : 1.95) {
        const side = v + 0.17 * Math.sin(2.51 * u + row);
        // 左右に開く葉を二枚。一株ずつ向きをずらして畝の土を透かす。
        for (const dir of [-1, 1]) {
          const start = vertex(f, u, side, 0.20, leaf);
          vertex(f, u - 0.16, side + dir * 0.20, 0.40, foliage);
          vertex(f, u + 0.19 * dir, side + dir * 0.41, 0.51, foliage);
          vertex(f, u + 0.16, side + dir * 0.18, 0.38, leaf);
          if (dir > 0) plantIndices.push(start, start + 1, start + 2, start, start + 2, start + 3);
          else plantIndices.push(start, start + 2, start + 1, start, start + 3, start + 2);
        }
        if (f.crop !== 'flowers') continue;
        const bloom = blossoms[(row + index) % blossoms.length], lift = 0.50 + 0.06 * Math.sin(u);
        const center = vertex(f, u, side, lift - 0.025, blossoms[1]);
        // 五枚の花弁。光を受ける先を少し反らし、小さな株も歩く目線で読めるようにする。
        for (let k = 0; k < 10; k++) {
          const a = -k * Math.PI / 5 + u, radius = k % 2 === 0 ? 0.31 : 0.14;
          vertex(f, u + radius * Math.cos(a), side + radius * Math.sin(a),
            lift + (k % 2 === 0 ? 0.09 : 0.015), bloom);
        }
        for (let k = 0; k < 10; k++) plantIndices.push(center, center + k + 1, center + (k + 1) % 10 + 1);
      }
    }
  });
  if (fields === southeast) {
    const yard = new GeoBatch(), detail = new GeoBatch();
    packingYard(yard, detail, colliders);
    // 畑のバッファに足すので、集荷場のための描画命令は増えない。
    for (const [batch, target] of [[yard, indices], [detail, plantIndices]] as const) {
      const g = batch.build(), pos = g.getAttribute('position'), color = g.getAttribute('color');
      const offset = positions.length / 3;
      for (let i = 0; i < pos.count; i++) {
        positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        colors.push(color.getX(i), color.getY(i), color.getZ(i));
      }
      const count = g.index?.count ?? pos.count;
      for (let i = 0; i < count; i++) target.push(offset + (g.index ? g.index.getX(i) : i));
      g.dispose();
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex([...indices, ...plantIndices]);
  geo.computeVertexNormals();
  // 地区内の属性バッファは共有し、低画質では花・若苗のインデックスだけを描かない。
  const plants = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(geo.attributes)) plants.setAttribute(name, attribute);
  plants.setIndex(plantIndices);
  geo.setIndex(indices);
  return { soil: geo, plants };
}

function citrusTree(): THREE.BufferGeometry {
  const b = new GeoBatch();
  b.add(cyl(0.13, 0.22, 1.63, 6), 0x936645, M(0, 0.81, 0));
  for (const s of [-1, 1]) {
    b.add(cyl(0.09, 0.13, 0.9, 5), 0x976c49, M(s * 0.23, 1.36, 0, 0, 1, 1, 1, 0, -s * 0.56));
    b.add(new THREE.DodecahedronGeometry(0.99), s < 0 ? 0x548749 : 0x43764b,
      M(s * 0.52, 1.96 - 0.13 * s, 0, s * 0.34, 1.18, 1.02, 1.12), { top: 0x8baa54 });
  }
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4;
    const side = Math.cos(a) < 0 ? -1 : 1;
    b.add(new THREE.OctahedronGeometry(0.19), i % 2 ? 0xffbb38 : 0xf18b2e,
      M(side * 0.52 + Math.cos(a) * 0.99, 1.58 + (i % 3) * 0.23, Math.sin(a) * 0.97));
  }
  return b.build();
}

export function buildOutskirts(
  root: THREE.Group, material: THREE.Material, colliders: Colliders, detailMeshes: THREE.Object3D[], softShadow: THREE.Object3D[],
): void {
  const tree = citrusTree();
  for (const fields of districts) {
    const { soil, plants } = beds(fields, colliders);
    const mesh = new THREE.Mesh(soil, material);
    mesh.name = 'farm-beds';
    mesh.receiveShadow = true;
    root.add(mesh);
    const flowers = new THREE.Mesh(plants, material);
    flowers.name = 'crop-leaves-and-flowers';
    flowers.receiveShadow = true;
    root.add(flowers);
    detailMeshes.push(flowers);

    const positions: THREE.Matrix4[] = [];
    for (const f of fields) {
      if (f.crop !== 'citrus') continue;
      const columns = Math.max(2, Math.floor((f.length - 2) / 5));
      for (const side of [-1, 1]) {
        for (let col = 0; col < columns; col++) {
          const u = ((col + 0.5) / columns - 0.5) * (f.length - 1);
          const [x, z] = point(f, u, side * (f.width - 3.1) / 2);
          const y = heightAt(x, z), scale = 0.91 + 0.11 * Math.sin(x * 4 + z);
          positions.push(M(x, y, z, col * 1.63 + f.x, scale, scale, scale));
          colliders.addCyl(x, z, y, y + scale * 1.7, scale * 0.20);
        }
      }
    }
    const trees = new THREE.InstancedMesh(tree, material, positions.length);
    trees.name = 'citrus-orchard';
    positions.forEach((transform, i) => trees.setMatrixAt(i, transform));
    trees.castShadow = true;
    trees.receiveShadow = true;
    trees.computeBoundingSphere();
    root.add(trees);
    softShadow.push(trees);
  }
}
