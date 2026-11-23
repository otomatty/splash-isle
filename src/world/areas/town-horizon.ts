import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32, sstep } from '../../engine/noise';
import { GeoBatch, M, box, cyl, sph } from '../props';
import { GRID, heightAt } from '../terrain';

export const TOWN_WORLD = 512;
const STEP = 16;
const cape = [[218, -240], [274, -255], [326, -238], [368, -215], [388, -187], [384, -160], [366, -140], [344, -130], [330, -131]];

/** 北西の陸橋から山麓、北東の岩礁へ続く本島。町のグリッド内外で同じ海岸線を使う。 */
export function mainlandHeight(x: number, z: number): number {
  const shore = -118 - 88 * sstep(-37, 18, x) + 6 * Math.sin(x * 0.038) - 5 * Math.cos(x * 0.017);
  const inland = Math.min(shore - z, x + 520 + 9 * Math.cos(z * 0.022), 424 - x + 12 * Math.sin(z * 0.035), z + 630);
  const ridge = (cx: number, cz: number, rx: number, rz: number) => Math.exp(-(((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2));
  let h = -18 + 25 * sstep(-22, 20, inland);
  if (inland > 0) {
    const relief = 14 + 9 * Math.sin(x * 0.037 + z * 0.019) + 5 * Math.cos(z * 0.085)
      + 44 * ridge(-224, -329, 71, 86) + 50 * ridge(22, -367, 76, 79) + 38 * ridge(157, -315, 68, 49);
    h += sstep(0, 103, inland) * relief;
  }
  if (x > 190 && z < -102 && z > -280) {
    // 細くなりながら西へ曲がる岬。背後は本島の陸地と重なる。
    for (let i = 1; i < cape.length; i++) {
      const [ax, az] = cape[i - 1], [bx, bz] = cape[i];
      const dx = bx - ax, dz = bz - az;
      const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
      const u = (i - 1 + t) / (cape.length - 1);
      const dist = Math.hypot(x - ax - t * dx, z - az - t * dz);
      h = Math.max(h, (23 - 14 * u) * (1 - (dist / (24 - 12 * u)) ** 2));
    }
  }
  return h;
}

/** 町の正方形のグリッドの外だけを粗い格子でつなぐ。接合する辺だけは町と同じ頂点間隔。 */
function outerLand(): THREE.BufferGeometry {
  const pos: number[] = [], colors: number[] = [], indices: number[] = [];
  const vertices = new Map<string, number>();
  const shore = new THREE.Color(0xf0d9ab), grass = new THREE.Color(0x83af64), upland = new THREE.Color(0x84a274);
  const stone = new THREE.Color(0xb5a48c), color = new THREE.Color();
  const vertex = (x: number, z: number) => {
    const key = `${x},${z}`;
    const found = vertices.get(key);
    if (found !== undefined) return found;
    const i = pos.length / 3, h = mainlandHeight(x, z);
    vertices.set(key, i);
    pos.push(x, h, z);
    const slope = Math.hypot(mainlandHeight(x + 2, z) - mainlandHeight(x - 2, z), mainlandHeight(x, z + 2) - mainlandHeight(x, z - 2)) / 4;
    color.copy(shore).lerp(grass, sstep(1, 7, h)).lerp(upland, sstep(8, 35, h));
    color.lerp(stone, sstep(0.32, 0.96, slope) * sstep(1, 9, h));
    color.multiplyScalar(0.94 + 0.10 * Math.cos(0.06 * x + 0.035 * z) + 0.05 * Math.sin(0.073 * z));
    colors.push(color.r, color.g, color.b);
    return i;
  };
  const half = TOWN_WORLD / 2;
  for (let z = -656; z < -96; z += STEP) {
    for (let x = -560; x < 464; x += STEP) {
      const x1 = x + STEP, z1 = z + STEP;
      if (x >= -half && x1 <= half && z >= -half) continue;
      if (mainlandHeight(x + STEP / 2, z + STEP / 2) < -8 && Math.max(mainlandHeight(x, z), mainlandHeight(x1, z), mainlandHeight(x, z1), mainlandHeight(x1, z1)) < -5) continue;
      const a = vertex(x, z), b = vertex(x1, z), c = vertex(x, z1), d = vertex(x1, z1);
      const northSeam = z1 === -half && x >= -half && x1 <= half;
      const westSeam = x1 === -half && z >= -half, eastSeam = x === half && z >= -half;
      if (northSeam || westSeam || eastSeam) {
        const center = vertex(x + STEP / 2, z + STEP / 2);
        const edge = (ax: number, az: number, bx: number, bz: number, seam: boolean) => {
          const n = seam ? STEP * GRID / TOWN_WORLD : 1;
          for (let j = 0; j < n; j++) indices.push(center,
            vertex(ax + (bx - ax) * j / n, az + (bz - az) * j / n),
            vertex(ax + (bx - ax) * (j + 1) / n, az + (bz - az) * (j + 1) / n));
        };
        edge(x, z, x, z1, eastSeam); edge(x, z1, x1, z1, northSeam);
        edge(x1, z1, x1, z, westSeam); edge(x1, z, x, z, false);
      } else indices.push(a, c, b, b, c, d);
    }
  }
  return coloredGeometry(pos, colors, indices);
}

function coloredGeometry(pos: number[], colors: number[], indices: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** 斜面の色帯、削れた稜線、火口の内壁まで同じ輪郭からつなぐ。 */
type Ring = [radius: number, height: number, color: number];
function mountain(cx: number, cz: number, rx: number, rz: number, phase: number, rings: Ring[]): THREE.BufferGeometry {
  const pos: number[] = [], colors: number[] = [], indices: number[] = [];
  const sides = 32, color = new THREE.Color();
  for (const [r, h, tint] of rings) {
    for (let i = 0; i < sides; i++) {
      const a = i * Math.PI * 2 / sides;
      const fold = Math.cos(7 * a + phase + 1.3 * r);
      const ridge = 1 + 0.13 * Math.cos(3 * a + phase) + 0.085 * fold + 0.03 * Math.sin(11 * a);
      pos.push(cx + rx * r * ridge * Math.cos(a), h + 2.5 * Math.sin(a * 3 + phase) + 1.4 * Math.sin(a * 5), cz + rz * r * ridge * Math.sin(a));
      color.setHex(tint).multiplyScalar(0.88 + 0.19 * fold + 0.06 * Math.sin(3 * a));
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < sides; i++) {
      const o = j * sides + i, next = j * sides + (i + 1) % sides;
      indices.push(o, o + sides, next, next, o + sides, next + sides);
    }
  }
  const last = (rings.length - 1) * sides;
  for (let i = 1; i < sides - 1; i++) indices.push(last, last + i + 1, last + i);
  return coloredGeometry(pos, colors, indices);
}

function windmill(b: GeoBatch, x: number, y: number, z: number): void {
  b.setBase(M(x, y, z, 0.62));
  b.add(cyl(1.7, 3.0, 11, 8), 0xf6dfaa, M(0, 5.5, 0));
  b.add(cyl(0.4, 2.5, 2.9, 8), 0xbb654a, M(0, 12, 0));
  for (let i = 0; i < 4; i++) {
    const axis = M(0, 10, 2.5, 0, 1, 1, 1, 0, i * Math.PI / 2 + 0.45);
    b.add(box(0.46, 7.5, 0.38), 0x775c4e, axis.clone().multiply(M(0, 3.7, 0)));
    b.add(box(1.8, 4, 0.34), 0xfdf3d3, axis.clone().multiply(M(0.65, 5.5, 0.15)));
  }
}

function balloon(b: GeoBatch, x: number, y: number, z: number, hue: number): void {
  b.setBase(M(x, y, z));
  const lathe = new THREE.LatheGeometry([[1.4,0],[2.1,1.3],[5.4,5.2],[7.7,10.3],[7.6,14.3],[5.1,18.2],[0.12,20]]
    .map(([r, h]) => new THREE.Vector2(r, h)), 16);
  b.add(lathe, hue, undefined, { paint: (px, _y, pz, color) => {
    if (Math.cos(Math.atan2(px, pz) * 4) > 0.45) color.setHex(0xffe7b2);
  } });
  for (const dx of [-1.15, 1.15]) b.add(cyl(0.12, 0.12, 3.3, 5), 0x67514a, M(dx, -1.35, 0));
  b.add(box(2.9, 1.8, 2.1), 0xa7683d, M(0, -3.5, 0));
}

function wreck(b: GeoBatch): void {
  // 入り江の内側に座礁し、片舷と折れたマストだけが水面からのぞく。
  b.setBase(M(344, -0.35, -159, -0.47, 1.13, 1.13, 1.13, -0.19, 0.16));
  const side = new THREE.Shape();
  side.moveTo(-13, 3.5); side.lineTo(-11, -0.8); side.lineTo(8, -1.6); side.lineTo(13, 4.5);
  side.lineTo(10, 3.5); side.lineTo(7, 3.7); side.lineTo(5.3, 1.7); side.lineTo(3.4, 3.4); side.lineTo(-5, 2.8); side.lineTo(-10, 4.2); side.closePath();
  for (const dz of [-2.7, 2.7]) b.add(new THREE.ExtrudeGeometry(side, {depth: 0.65, bevelEnabled: false}), 0x75513e, M(0, 0, dz));
  b.add(box(16, 0.9, 5.2), 0xad8556, M(-2.2, 1.7, 0));
  const mast = M(-2, 2.1, 0, 0, 1, 1, 1, 0, -0.48);
  b.add(cyl(0.21, 0.50, 18, 7), 0x5f5046, mast.clone().multiply(M(0, 9, 0)));
  b.add(box(12, 0.45, 0.45), 0x695446, mast.clone().multiply(M(0, 15.6, 0)));
  b.add(cyl(0.26, 0.44, 6.8, 6), 0x74573f, M(-8, 5.2, 0, 0, 1, 1, 1, 0, 0.37));
  const cloth = new THREE.Shape();
  cloth.moveTo(-5.6, 0); cloth.lineTo(5.6, -1.1); cloth.lineTo(3.6, -4.8); cloth.lineTo(1.2, -3.6);
  cloth.lineTo(0.3, -6.3); cloth.lineTo(-2.9, -4.8); cloth.lineTo(-4.9, -6.7); cloth.closePath();
  const sail = new THREE.ExtrudeGeometry(cloth, { depth: 0.15, bevelEnabled: false });
  b.add(sail, 0xebd7a3, mast.multiply(M(0, 15.5, 0.18)));
}

/** 尾根の下のまとまった樹冠、崖から突き出た岩棚、岬を取り巻く白い礁。 */
function woodedSlopes(b: GeoBatch): void {
  b.setBase(M());
  const random = mulberry32(8012);
  const ground = (x: number, z: number) => {
    if (Math.abs(x) < TOWN_WORLD / 2 && z > -TOWN_WORLD / 2) return heightAt(x, z);
    // 遠景の岩や樹木の足元も、表示した粗い三角形の面に合わせる。
    const x0 = Math.floor(x / STEP) * STEP, z0 = Math.floor(z / STEP) * STEP;
    const u = (x - x0) / STEP, v = (z - z0) / STEP;
    const ax = mainlandHeight(x0 + STEP, z0), az = mainlandHeight(x0, z0 + STEP);
    if (u + v <= 1) return mainlandHeight(x0, z0) * (1 - u - v) + ax * u + az * v;
    return mainlandHeight(x0 + STEP, z0 + STEP) * (u + v - 1) + ax * (1 - v) + az * (1 - u);
  };
  const groves = [[-158,-164,22,9],[-98,-153,26,10],[-58,-174,28,12],[-114,-207,30,14],[-14,-227,30,12],
    [18,-277,45,22],[78,-261,27,13],[143,-265,38,12],[187,-234,29,12],[-236,-271,30,15],[-305,-197,25,14],[306,-236,18,8]];
  for (const [cx, cz, rx, rz] of groves) {
    for (let i = 0; i < 11; i++) {
      const a = random() * Math.PI * 2, r = Math.sqrt(random()), s = 3.4 + 3.1 * random();
      const x = cx + rx * r * Math.cos(a), z = cz + rz * r * Math.sin(a), y = ground(x, z);
      if (y < 3) continue;
      b.add(cyl(0.30, 0.44, s * 1.7, 5, 1, true), 0x746d51, M(x, y + s * 0.4, z));
      b.add(sph(1, 7, 4), i % 3 ? 0x517e56 : 0x5b895b,
        M(x, y + s * 0.99, z, a, s * 1.12, s * (0.72 + 0.34 * random()), s * 0.97), { ao: 0.78, top: i % 3 ? 0x87a86b : 0x77a16d });
    }
  }
  for (const [cx, cz, scale] of [[-136,-181,1],[-73,-209,1.2],[40,-267,1.4],[128,-272,1.3],[253,-255,0.9],[362,-151,0.7],[334,-123,0.55]]) {
    for (let i = 0; i < 6; i++) {
      const x = cx + (i - 2.5) * 4.3 * scale, z = cz + (random() - 0.5) * 5, y = ground(x, z);
      const coast = x > 245;
      b.add(new THREE.DodecahedronGeometry(1, 0), coast ? 0xb5a17e : 0x8b8979,
        M(x, Math.max(-1.5, y) + scale, z, random(), (3 + random() * 3) * scale, (2 + random() * 4) * scale, 3.8 * scale),
        { ao: 0.8, top: coast ? 0xe8d4ad : 0xafa98f });
    }
  }
}

function steam(): THREE.Mesh {
  const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 160;
  const c = canvas.getContext('2d')!, random = mulberry32(275);
  for (let i = 0; i < 55; i++) {
    const t = i / 54, size = 4 + 22 * t;
    const x = 26 + t * t * 40 + (random() - 0.5) * size * 1.2;
    const y = 156 - t * 132 + (random() - 0.5) * size * 0.8;
    const glow = c.createRadialGradient(x, y, 0, x, y, size);
    glow.addColorStop(0, `rgba(255,250,228,${(1 - t * 0.8) * 0.44})`); glow.addColorStop(1, 'rgba(255,251,234,0)');
    c.fillStyle = glow; c.fillRect(x - size, y - size, size * 2, size * 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  mat.forceSinglePass = true;
  const plume = new THREE.Mesh(new THREE.PlaneGeometry(70, 85), mat);
  plume.position.set(-131, 182, -450); plume.rotation.y = 0.32;
  return plume;
}

export function buildTownHorizon(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'town-horizon';
  const formations = [outerLand(), mountain(-145, -450, 157, 131, 0.8, [
    [1.20, 8, 0x689774], [0.92, 36, 0x74946c], [0.70, 62, 0x828c70], [0.55, 87, 0x987e6c],
    [0.49, 94, 0xb19775], [0.47, 98, 0x967968], [0.32, 129, 0xab816d], [0.22, 146, 0xb29881],
    [0.145, 143, 0xccab8e], [0.08, 128, 0x79685e],
  ])];
  const mesas = [[-391, -266, 80, 67, 116], [-336, -230, 57, 48, 85], [-411, -189, 46, 38, 65]];
  for (const [x, z, rx, rz, h] of mesas) {
    formations.push(mountain(x, z, rx, rz, x * 0.03, [
      [1.22, 7, 0x76986c], [0.98, h * 0.32, 0x8c9e6b], [0.87, h * 0.34, 0xa59a74], [0.79, h * 0.62, 0xb29876],
      [0.72, h * 0.65, 0x839e6e], [0.66, h - 5, 0xa1987a], [0.64, h, 0x8db075], [0.22, h + 1.2, 0x95b878],
    ]));
  }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const ground = mergeGeometries(formations, false)!;
  for (const g of formations) g.dispose();
  root.add(new THREE.Mesh(ground, mat));
  const b = new GeoBatch();
  windmill(b, -336, 86, -229); windmill(b, -378, 116, -250);
  balloon(b, -366, 118, -202, 0xde7859); balloon(b, -426, 135, -242, 0x559b97);
  wreck(b);
  woodedSlopes(b);
  root.add(new THREE.Mesh(b.build(), mat), steam());
  return root;
}
