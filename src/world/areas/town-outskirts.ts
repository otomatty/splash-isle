import * as THREE from 'three';
import type { Colliders } from '../colliders';
import { GeoBatch, M, cyl } from '../props';
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

/** 畝・野面積み・花を地区ごとに1メッシュへ。各頂点は町の衝突地形から高さを採る。 */
function beds(fields: Field[]): { soil: THREE.BufferGeometry; plants: THREE.BufferGeometry } {
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
    const { soil, plants } = beds(fields);
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
