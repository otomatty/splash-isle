import * as THREE from 'three';

/** 海面の高さ */
export const SEA = 0;
/** 地形グリッドの分割数（どのエリアでも共通。覆う範囲はエリアごとに変わる） */
export const GRID = 288;
const N = GRID + 1;
export const DEEP = -13;

type RGB = [number, number, number];

export interface PathDef {
  pts: [number, number][];
  width: number;
}

/** 地面の色合い（リニア色空間の RGB） */
export interface Palette {
  sandA: RGB; sandB: RGB;
  grassA: RGB; grassB: RGB; grassC: RGB;
  rockA: RGB; rockB: RGB;
  dirtA: RGB; dirtB: RGB;
  tileA: RGB; tileB: RGB;
  /** 砂から草へ切り替わる高さの範囲 */
  grassFrom: number; grassTo: number;
  /** 岩肌になる傾斜のしきい値（小さいほど岩が多い） */
  rockSlope: number;
}

export const DEFAULT_PALETTE: Palette = {
  sandA: [0.70, 0.56, 0.36], sandB: [0.86, 0.74, 0.52],
  grassA: [0.07, 0.27, 0.05], grassB: [0.26, 0.50, 0.10], grassC: [0.40, 0.52, 0.13],
  rockA: [0.36, 0.32, 0.29], rockB: [0.66, 0.60, 0.52],
  dirtA: [0.52, 0.40, 0.25], dirtB: [0.74, 0.61, 0.42],
  tileA: [0.66, 0.54, 0.42], tileB: [0.82, 0.74, 0.62],
  grassFrom: 1.5, grassTo: 3.1, rockSlope: 0.27,
};

/** エリアの地形の定義 */
export interface TerrainDef {
  /** グリッドが覆う一辺の長さ（m） */
  world: number;
  /** 高さを返す関数（エリアに入るときに1回だけグリッドへ焼き込む） */
  raw: (x: number, z: number) => number;
  /** 土の小道 */
  paths: PathDef[];
  /** 石畳の通り */
  streets: PathDef[];
  /** 石畳の広場（先頭の広場は放射状の模様になる） */
  plazas: { x: number; z: number; r: number }[];
  palette: Palette;
}

let def: TerrainDef | null = null;
let WORLD = 384;
let HALF = WORLD / 2;
let CELL = WORLD / GRID;
const heights = new Float32Array(N * N);

/** いまの地形が覆う範囲の半分（m） */
export function worldHalf(): number {
  return HALF;
}

/** 地面の高さ（双線形補間）。グリッド外は深い海底 */
export function heightAt(x: number, z: number): number {
  const u = (x + HALF) / CELL;
  const v = (z + HALF) / CELL;
  if (u < 0 || v < 0 || u >= GRID || v >= GRID) return DEEP;
  const i = u | 0, j = v | 0;
  const fu = u - i, fv = v - j;
  const k = j * N + i;
  const a = heights[k], b = heights[k + 1], c = heights[k + N], d = heights[k + N + 1];
  return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
}

/** 地面の法線（out に書き込む） */
export function normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
  const e = 0.75;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return out.set(-dx, 2 * e, -dz).normalize();
}

function polyDistance(list: PathDef[], x: number, z: number): number {
  let best = Infinity;
  for (const path of list) {
    const pts = path.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
      const abx = bx - ax, abz = bz - az;
      let t = ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - (ax + abx * t), z - (az + abz * t)) - path.width / 2;
      if (d < best) best = d;
    }
  }
  return best;
}

/** 石畳（通り・広場）の縁までの距離。負なら石畳の上 */
export function pavedDistance(x: number, z: number): number {
  if (!def) return Infinity;
  let best = polyDistance(def.streets, x, z);
  for (const p of def.plazas) best = Math.min(best, Math.hypot(x - p.x, z - p.z) - p.r);
  return best;
}

/** 小道・通り・広場のうち一番近いものの縁までの距離。負なら道の上 */
export function pathDistance(x: number, z: number): number {
  if (!def) return Infinity;
  return Math.min(polyDistance(def.paths, x, z), pavedDistance(x, z));
}

export interface TerrainUniforms {
  uTime: { value: number };
  tGoop: { value: THREE.Texture | null };
  uGoopRect: { value: THREE.Vector4 };
}

export interface Terrain {
  mesh: THREE.Group;
  uniforms: TerrainUniforms;
  heightTex: THREE.DataTexture;
  /** 地形を別のエリアのものに差し替える */
  apply(def: TerrainDef): void;
  updateDetail(camera: THREE.Vector3): void;
  /** 海シェーダー用: uv = (xz + x) * y + z */
  heightUV: THREE.Vector3;
}

const MASK = 512;
const TILES_PER_SIDE = 4;
const TILE = GRID / TILES_PER_SIDE;
const ROW = TILE + 1;

/** 土と石畳のマスク。道幅と縁のぼかしが届く画素だけに、各図形の被覆率を重ねる。 */
function paintPathMask(data: Uint8Array, terrain: TerrainDef): void {
  data.fill(0);
  const pixel = terrain.world / MASK, halfWorld = terrain.world / 2;
  const edge = 1.2;
  const texel = (v: number) => Math.floor((v + halfWorld) / pixel);
  const stroke = (ax: number, az: number, bx: number, bz: number, radius: number, channel: number) => {
    const reach = radius + edge;
    const left = Math.max(0, texel(Math.min(ax, bx) - reach)), right = Math.min(MASK - 1, texel(Math.max(ax, bx) + reach));
    const top = Math.max(0, texel(Math.min(az, bz) - reach)), bottom = Math.min(MASK - 1, texel(Math.max(az, bz) + reach));
    const dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
    for (let j = top; j <= bottom; j++) {
      const z = -halfWorld + (j + 0.5) * pixel;
      for (let i = left; i <= right; i++) {
        const x = -halfWorld + (i + 0.5) * pixel;
        const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
        const distance = Math.hypot(x - (ax + t * dx), z - (az + t * dz)) - radius;
        const value = Math.round(255 * Math.max(0, Math.min(1, 0.5 - distance / (2 * edge))));
        const k = (j * MASK + i) * 2 + channel;
        data[k] = Math.max(data[k], value);
      }
    }
  };
  for (const [channel, paths] of [terrain.paths, terrain.streets].entries()) {
    for (const { pts, width } of paths) {
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
        if (ax !== bx || az !== bz) stroke(ax, az, bx, bz, width / 2, channel);
      }
    }
  }
  for (const p of terrain.plazas) stroke(p.x, p.z, p.x, p.z, p.r, 1);
}

/** 遠景でも区画の外周と、崖など線形補間から大きく外れる中点を残す。 */
function coarseTerrainIndices(pos: THREE.BufferAttribute): number[] {
  const indices: number[] = [];
  const bent = (a: number, b: number) =>
    Math.abs(pos.getY((a + b) / 2) - (pos.getY(a) + pos.getY(b)) / 2) > 0.12;
  // AB の中点を残す三角形。ほかの2辺でも中点が要るときだけ分割する。
  const splitAB = (a: number, b: number, c: number, keepBC: boolean, keepCA: boolean) => {
    const ab = (a + b) / 2, bc = (b + c) / 2, ca = (c + a) / 2;
    if (keepBC && keepCA) {
      indices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
      return;
    }
    if (keepBC) indices.push(ab, b, bc, ab, bc, c);
    else indices.push(ab, b, c);
    if (keepCA) indices.push(ab, c, ca, ab, ca, a);
    else indices.push(ab, c, a);
  };
  const triangle = (a: number, b: number, c: number, ab: boolean, bc: boolean, ca: boolean) => {
    if (ab) splitAB(a, b, c, bc, ca);
    else if (bc) splitAB(b, c, a, ca, false);
    else if (ca) splitAB(c, a, b, false, false);
    else indices.push(a, b, c);
  };
  for (let z = 0; z < TILE; z += 2) {
    for (let x = 0; x < TILE; x += 2) {
      const a = z * ROW + x, b = a + 2, c = a + 2 * ROW, d = c + 2;
      const diagonal = bent(b, c);
      triangle(a, c, b, x === 0 || bent(a, c), diagonal, z === 0 || bent(b, a));
      triangle(b, c, d, diagonal, z + 2 === TILE || bent(c, d), x + 2 === TILE || bent(d, b));
    }
  }
  return indices;
}

export function createTerrain(noiseTex: THREE.Texture): Terrain {
  const half = new Uint16Array(N * N);
  const heightTex = new THREE.DataTexture(half, N, N, THREE.RedFormat, THREE.HalfFloatType);
  heightTex.minFilter = heightTex.magFilter = THREE.LinearFilter;
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;

  // R: 土の小道 / G: 石畳
  const maskData = new Uint8Array(MASK * MASK * 2);
  const maskTex = new THREE.DataTexture(maskData, MASK, MASK, THREE.RGFormat, THREE.UnsignedByteType);
  maskTex.minFilter = maskTex.magFilter = THREE.LinearFilter;

  const uniforms: TerrainUniforms = {
    uTime: { value: 0 },
    tGoop: { value: null },
    uGoopRect: { value: new THREE.Vector4(0, 0, 1, 1) },
  };
  const v3 = () => ({ value: new THREE.Vector3() });
  const pal = {
    uSandA: v3(), uSandB: v3(), uGrassA: v3(), uGrassB: v3(), uGrassC: v3(), uRockA: v3(), uRockB: v3(),
    uDirtA: v3(), uDirtB: v3(), uTileA: v3(), uTileB: v3(),
    uGrassH: { value: new THREE.Vector3(1.5, 3.1, 0.27) },
  };
  const uPlaza = { value: new THREE.Vector3(0, 0, -100) };
  const uWorld = { value: new THREE.Vector2(HALF, 1 / WORLD) };
  const heightUV = new THREE.Vector3();

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, pal, {
      tNoise: { value: noiseTex }, tGoop: uniforms.tGoop, uGoopRect: uniforms.uGoopRect, uTime: uniforms.uTime,
      uPlaza, tMask: { value: maskTex }, uWorld,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform sampler2D tNoise;
        uniform sampler2D tGoop;
        uniform sampler2D tMask;
        uniform vec2 uWorld;
        uniform vec4 uGoopRect;
        uniform vec3 uPlaza;
        uniform vec3 uSandA, uSandB, uGrassA, uGrassB, uGrassC, uRockA, uRockB, uDirtA, uDirtB, uTileA, uTileB, uGrassH;
        uniform float uTime;
        varying vec3 vWPos;
        varying vec3 vWNrm;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        vec2 t_p = vWPos.xz;
        float t_h = vWPos.y;
        vec4 t_n1 = texture2D(tNoise, t_p * 0.021);
        vec4 t_n2 = texture2D(tNoise, t_p * 0.13);
        vec4 t_n3 = texture2D(tNoise, t_p * 0.61);
        float t_slope = 1.0 - normalize(vWNrm).y;

        // 砂（濡れた波打ち際は濃く）
        vec3 t_sand = mix(uSandA, uSandB, t_n2.r * 0.7 + t_n3.g * 0.3);
        float t_wet = 1.0 - smoothstep(0.02, 0.55, t_h + (t_n1.g - 0.5) * 0.25);
        t_sand = mix(t_sand, t_sand * vec3(0.62, 0.60, 0.56), t_wet);
        t_sand *= 0.95 + 0.07 * sin((t_p.x + t_p.y * 0.6) * 2.4 + t_n2.b * 6.0);

        // 草（明るい草と濃い草のまだら＋細かい粒）
        vec3 t_grass = mix(uGrassA, uGrassB, t_n1.r * 0.65 + t_n2.g * 0.35);
        t_grass *= 0.82 + 0.36 * t_n3.r;
        t_grass = mix(t_grass, uGrassC, smoothstep(0.62, 0.9, t_n1.a) * 0.5);

        // 岩（急斜面）。高さ方向の縞で地層らしく
        vec3 t_rock = mix(uRockA, uRockB, t_n2.b * 0.6 + t_n3.a * 0.4);
        t_rock *= 0.8 + 0.4 * smoothstep(0.3, 0.7, texture2D(tNoise, vec2(t_h * 0.35, t_p.x * 0.05 + t_p.y * 0.05)).g);

        float t_g = smoothstep(uGrassH.x, uGrassH.y, t_h + (t_n1.b - 0.5) * 1.8);
        vec3 t_col = mix(t_sand, t_grass, t_g);
        t_col = mix(t_col, t_rock, smoothstep(uGrassH.z, uGrassH.z + 0.13, t_slope + (t_n2.a - 0.5) * 0.12));

        // 踏み固められた小道と石畳（縁はノイズで崩す）
        vec2 t_mk = texture2D(tMask, (t_p + uWorld.x) * uWorld.y).rg;
        float t_path = smoothstep(0.42, 0.58, t_mk.r + (t_n2.g - 0.5) * 0.28 + (t_n3.r - 0.5) * 0.1);
        vec3 t_dirt = mix(uDirtA, uDirtB, t_n2.b * 0.6 + t_n3.a * 0.4);
        t_dirt *= 1.0 - 0.35 * smoothstep(0.72, 0.9, t_n3.b);
        t_col = mix(t_col, t_dirt, t_path * t_g);

        float t_pm = smoothstep(0.40, 0.56, t_mk.g + (t_n1.a - 0.5) * 0.2 + (t_n3.r - 0.5) * 0.08);
        float t_dp = length(t_p - uPlaza.xy);
        float t_radial = 1.0 - step(uPlaza.z + 2.0, t_dp);
        // 中央広場は放射状、通りはれんが積みの石畳
        float t_ang = atan(t_p.y - uPlaza.y, t_p.x - uPlaza.x);
        float t_ringI = floor(t_dp / 1.5);
        float t_cnt = max(6.0, floor((t_ringI + 0.5) * 1.5 * 6.2832 / 1.9));
        vec2 t_tuvR = vec2(t_dp / 1.5, t_ang / 6.2832 * t_cnt + t_ringI * 0.37);
        vec2 t_tuvS = vec2(t_p.x / 1.7 + floor(t_p.y / 1.1) * 0.5, t_p.y / 1.1);
        vec2 t_tuv = mix(t_tuvS, t_tuvR, t_radial);
        vec2 t_tf = abs(fract(t_tuv) - 0.5);
        vec2 t_ti = floor(t_tuv);
        float t_tr = fract(sin(dot(t_ti, vec2(12.9898, 78.233))) * 43758.5453);
        float t_grout = smoothstep(0.455, 0.49, max(t_tf.x, t_tf.y));
        vec3 t_tile = mix(uTileA, uTileB, t_tr);
        t_tile *= 0.90 + 0.2 * t_n3.b;
        float t_accent = (step(abs(t_ringI - 5.0), 0.5) + step(abs(t_ringI - 11.0), 0.5)) * t_radial;
        t_tile = mix(t_tile, mix(vec3(0.70, 0.36, 0.24), vec3(0.20, 0.50, 0.62), step(0.5, fract(t_ti.y * 0.5))), min(t_accent, 1.0) * 0.75);
        t_tile = mix(t_tile, t_tile * 0.55, t_grout);
        t_col = mix(t_col, t_tile, t_pm);

        // 水中の砂にコースティクス（光のゆらめき）
        float t_uw = smoothstep(0.05, -0.5, t_h);
        vec2 t_cuv = t_p * 0.085;
        float t_c1 = texture2D(tNoise, t_cuv + vec2(uTime * 0.031, uTime * 0.019)).r;
        float t_c2 = texture2D(tNoise, t_cuv * 1.37 - vec2(uTime * 0.023, -uTime * 0.027)).g;
        float t_ca = pow(1.0 - abs(t_c1 - t_c2), 10.0);
        t_col += t_uw * t_ca * vec3(0.55, 0.60, 0.45) * exp(t_h * 0.22);

        // スミ（汚れ）
        vec2 t_guv = (t_p - uGoopRect.xy) * uGoopRect.zw;
        float t_gm = texture2D(tGoop, clamp(t_guv, 0.0, 1.0)).r;
        t_gm *= step(0.0, t_guv.x) * step(t_guv.x, 1.0) * step(0.0, t_guv.y) * step(t_guv.y, 1.0);
        float t_ge = t_gm + (t_n2.r - 0.5) * 0.22 + (t_n3.g - 0.5) * 0.08;
        float t_goop = smoothstep(0.44, 0.52, t_ge);
        float t_goopRim = smoothstep(0.36, 0.46, t_ge) - t_goop;
        vec2 t_fl = t_p * 0.33 + vec2(uTime * 0.013, -uTime * 0.009);
        float t_sw = texture2D(tNoise, t_fl + t_n2.rg * 0.25).b;
        vec3 t_goopCol = mix(vec3(0.07, 0.02, 0.13), vec3(0.34, 0.05, 0.36), t_sw * t_sw);
        t_goopCol += vec3(0.05, 0.42, 0.55) * pow(t_sw, 6.0) * 1.5;
        t_col = mix(t_col, t_col * vec3(0.55, 0.42, 0.62), t_goopRim);
        t_col = mix(t_col, t_goopCol, t_goop);
        diffuseColor.rgb = t_col;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.55, t_wet * (1.0 - t_g));
        roughnessFactor = mix(roughnessFactor, 0.78, t_pm);
        roughnessFactor = mix(roughnessFactor, 0.22, t_goop);`,
      );
  };
  const mesh = new THREE.Group();
  mesh.name = 'terrain';
  // 近景は旧グリッドと同じ対角線で張り、全区画でインデックスを共有する。
  const fine: number[] = [];
  for (let z = 0; z < TILE; z++) {
    for (let x = 0; x < TILE; x++) {
      const a = z * ROW + x, b = a + 1, c = a + ROW;
      fine.push(a, c, b, b, c, c + 1);
    }
  }
  const nearIndex = new THREE.Uint16BufferAttribute(fine, 1);
  const tiles = Array.from({ length: TILES_PER_SIDE ** 2 }, (_, i) => {
    const x = (i % TILES_PER_SIDE) * TILE, z = Math.floor(i / TILES_PER_SIDE) * TILE;
    const geo = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(ROW * ROW * 3), 3);
    const nrm = new THREE.BufferAttribute(new Float32Array(ROW * ROW * 3), 3);
    geo.setAttribute('position', pos);
    geo.setAttribute('normal', nrm);
    geo.setIndex(nearIndex);
    const part = new THREE.Mesh(geo, mat);
    part.receiveShadow = true;
    mesh.add(part);
    const farIndex = new THREE.BufferAttribute(new Uint16Array(nearIndex.count), 1);
    return { x, z, geo, pos, nrm, farIndex, farCount: 0 };
  });

  const n = new THREE.Vector3();
  const apply = (d: TerrainDef): void => {
    def = d;
    WORLD = d.world;
    HALF = WORLD / 2;
    CELL = WORLD / GRID;
    for (let j = 0; j < N; j++) {
      const z = -HALF + j * CELL;
      for (let i = 0; i < N; i++) heights[j * N + i] = d.raw(-HALF + i * CELL, z);
    }
    for (const tile of tiles) {
      for (let z = 0; z < ROW; z++) {
        const j = tile.z + z;
        for (let x = 0; x < ROW; x++) {
          const i = tile.x + x, k = z * ROW + x;
          tile.pos.setXYZ(k, -HALF + i * CELL, heights[j * N + i], -HALF + j * CELL);
          const xl = heights[j * N + Math.max(i - 1, 0)], xr = heights[j * N + Math.min(i + 1, GRID)];
          const zu = heights[Math.max(j - 1, 0) * N + i], zd = heights[Math.min(j + 1, GRID) * N + i];
          n.set(xl - xr, 2 * CELL, zu - zd).normalize();
          tile.nrm.setXYZ(k, n.x, n.y, n.z);
        }
      }
      tile.pos.needsUpdate = true;
      tile.nrm.needsUpdate = true;
      tile.geo.computeBoundingBox();
      tile.geo.computeBoundingSphere();
      const coarse = coarseTerrainIndices(tile.pos);
      tile.farCount = coarse.length;
      tile.farIndex.set(coarse);
      tile.farIndex.needsUpdate = true;
      tile.geo.setIndex(nearIndex);
      tile.geo.setDrawRange(0, nearIndex.count);
    }
    for (let i = 0; i < N * N; i++) half[i] = THREE.DataUtils.toHalfFloat(heights[i]);
    heightTex.needsUpdate = true;
    paintPathMask(maskData, d);
    maskTex.needsUpdate = true;
    const p = d.palette;
    pal.uSandA.value.fromArray(p.sandA); pal.uSandB.value.fromArray(p.sandB);
    pal.uGrassA.value.fromArray(p.grassA); pal.uGrassB.value.fromArray(p.grassB); pal.uGrassC.value.fromArray(p.grassC);
    pal.uRockA.value.fromArray(p.rockA); pal.uRockB.value.fromArray(p.rockB);
    pal.uDirtA.value.fromArray(p.dirtA); pal.uDirtB.value.fromArray(p.dirtB);
    pal.uTileA.value.fromArray(p.tileA); pal.uTileB.value.fromArray(p.tileB);
    pal.uGrassH.value.set(p.grassFrom, p.grassTo, p.rockSlope);
    const pz = d.plazas[0];
    if (pz) uPlaza.value.set(pz.x, pz.z, pz.r);
    else uPlaza.value.set(0, 0, -100);
    uWorld.value.set(HALF, 1 / WORLD);
    heightUV.set(HALF, GRID / (WORLD * N), 0.5 / N);
  };

  const updateDetail = (camera: THREE.Vector3): void => {
    for (const tile of tiles) {
      const near = tile.geo.index === nearIndex;
      const distance = tile.geo.boundingBox!.distanceToPoint(camera);
      // 少し離れてから粗くし、境目で立ち止まっても切り替わりを繰り返さない。
      const useNear = distance < (near ? 64 : 52);
      if (useNear === near) continue;
      tile.geo.setIndex(useNear ? nearIndex : tile.farIndex);
      tile.geo.setDrawRange(0, useNear ? nearIndex.count : tile.farCount);
    }
  };
  return { mesh, uniforms, heightTex, apply, heightUV, updateDetail };
}
