import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GeoBatch, M, box, cone, cyl, sph } from '../world/props';
import { damp } from '../engine/noise';

export interface BirdLook {
  body: number;
  belly: number;
  hat: number;
  scarf: number;
  /** ひょうたんポンプを背負うか（主人公のみ） */
  pack: boolean;
}

export interface Bird {
  root: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  eyes: THREE.Mesh;
  wingL: THREE.Group;
  wingR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  tail: THREE.Group;
  pumpDetail?: { geometry: THREE.BufferGeometry; plainCount: number };
  /** 伸び縮み（スカッシュ＆ストレッチ）のばね */
  squash: number;
  squashV: number;
  phase: number;
  blink: number;
}

export interface BirdPose {
  speed: number; // 0〜1（歩き→走り）
  grounded: boolean;
  hover: boolean;
  swim: boolean;
  spray: boolean;
  vy: number;
  talk: boolean;
}

const matBird = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });
const matEye = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.08 });

const matGlint = new THREE.MeshBasicMaterial({ color: 0xffffff });
const straw = new THREE.Color(0xe8c477);
const strawEdge = new THREE.Color(0xc79353);
const lowerBill = new THREE.Color(0xc75f30);

function turned(profile: [number, number][], segments: number): THREE.LatheGeometry {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

/** 球の緯線を胸元と顔の模様に沿わせ、少ない頂点でも色の境目をなめらかに保つ。 */
function addPlumage(batch: GeoBatch, look: BirdLook, part: 'body' | 'face', width: number, height: number): void {
  const body = part === 'body';
  const radius = body ? 0.36 : 0.275;
  const geometry = sph(radius, width, height).rotateX(Math.PI / 2);
  const pos = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  const edgeRow = Math.round(height * 0.3);
  // 正面から白い模様の端までの角度。顔には上のくぼみを、胸には下の丸みを付ける。
  const edgeAngle = (up: number): number => body
    ? 0.88 + 0.24 * up * up - 0.2 * up
    : 1.1 - 0.28 * up * up - 0.08 * up - 0.20 * Math.max(0, up) ** 8;
  for (let i = 0; i < pos.count; i++) {
    const row = Math.floor(i / (width + 1));
    if (row === 0 || row === height) continue;
    const length = Math.hypot(pos.getX(i), pos.getY(i));
    const dx = pos.getX(i) / length, dy = pos.getY(i) / length;
    const edge = edgeAngle(dy);
    // 境界の両側に1周ずつ頂点をそろえる。
    const theta = row <= edgeRow
      ? (edge - 0.012) * row / edgeRow
      : edge + 0.012 + (Math.PI - edge - 0.012) * (row - edgeRow - 1) / (height - edgeRow - 1);
    const x = dx * Math.sin(theta), y = dy * Math.sin(theta), z = Math.cos(theta);
    pos.setXYZ(i, radius * x, radius * y, radius * z);
    normals.setXYZ(i, x, y, z);
  }
  const plumage = new THREE.Color(body ? look.belly : 0xfdfaf2);
  batch.add(geometry, look.body, body ? M(0, 0, 0, 0, 1, 1.1, 0.94) : undefined, {
    ao: body ? 0.8 : 1,
    paint: (x, y, z, color) => {
      const length = Math.hypot(x, y);
      if (z > 0 && (length < 1e-6 || z > radius * Math.cos(edgeAngle(y / length)))) color.copy(plumage);
    },
  });
}

/** ゆるく反ったつばと丸い山を一枚の麦わら帽子にする。帯も同じ頂点色で染める。 */
function addHat(batch: GeoBatch, band: number, segments: number): void {
  const geometry = turned([
    [0, -0.025], [0.22, -0.025], [0.35, -0.042], [0.385, -0.025], [0.38, -0.009],
    [0.34, -0.012], [0.217, 0.019], [0.207, 0.031], [0.204, 0.044], [0.198, 0.091],
    [0.195, 0.102], [0.183, 0.15], [0.157, 0.18], [0.105, 0.193], [0, 0.194],
  ], segments);
  const pos = geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const rim = Math.max(0, Math.hypot(x, z) - 0.217);
    pos.setY(i, pos.getY(i) + rim * (x * x - z * z) * 1.1);
  }
  geometry.computeVertexNormals();
  const ribbon = new THREE.Color(band);
  batch.add(geometry, straw, M(0, 0.2, -0.02, 0, 1, 1, 1, -0.16), {
    paint: (x, y, z, color) => {
      if (y >= 0.043 && y <= 0.092) color.copy(ribbon);
      else if (y < -0.02 && Math.hypot(x, z) > 0.29) color.copy(strawEdge);
    },
  });
}

/** 羽色に馴染む根元から先が少し下がった二色のくちばし。 */
function addBill(batch: GeoBatch, segments: number): void {
  const geometry = turned([[0, 0], [0.092, 0], [0.102, 0.035], [0.085, 0.105], [0.049, 0.172], [0.015, 0.22], [0, 0.232]], segments);
  geometry.rotateX(Math.PI / 2);
  const pos = geometry.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    pos.setY(i, pos.getY(i) * 0.66 - 0.48 * z * z);
  }
  geometry.computeVertexNormals();
  batch.add(geometry, 0xffb540, M(0, -0.052, 0.215), {
    paint: (_x, y, z, color) => {
      if (y + 0.48 * z * z < -0.014) color.copy(lowerBill);
    },
  });
}

function mesh(batch: GeoBatch, mat: THREE.Material = matBird): THREE.Mesh {
  const m = new THREE.Mesh(batch.build(), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * 島の住人（海鳥の子）を組み立てる。主人公「プカ」も住人たちも同じ骨格で、
 * 色・帽子・背中のポンプの有無だけが違う。パーツごとに1メッシュへまとめて描画負荷を抑える。
 */
export function buildBird(look: BirdLook): Bird {
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 0.56;
  root.add(torso);

  const ORANGE = 0xf2792b;
  // 胴体
  const tb = new GeoBatch();
  addPlumage(tb, look, 'body', 32, 20);
  tb.add(cone(0.14, 0.3, 8), look.body, M(0, -0.16, -0.36, 0, 1, 1, 1, -1.9)); // 尾羽
  // スカーフ
  tb.add(new THREE.TorusGeometry(0.2, 0.065, 8, 18).rotateX(Math.PI / 2), look.scarf, M(0, 0.3, 0.01, 0, 1.05, 1, 1));
  tb.add(sph(0.075, 8, 6), look.scarf, M(-0.17, 0.27, 0.15));
  if (look.pack) {
    // ひょうたんポンプ: 釉薬をかけた陶器のひょうたん＋竹の噴射口
    const GOURD = 0x1fa594, GOURD_HI = 0x7fe0cc, BAMBOO = 0xb9c26a, ROPE = 0xd8322e;
    const vessel = turned([
      [0, -0.242], [0.095, -0.234], [0.176, -0.185], [0.215, -0.09], [0.218, -0.012],
      [0.185, 0.065], [0.104, 0.117], [0.094, 0.151], [0.132, 0.194], [0.15, 0.249],
      [0.141, 0.303], [0.105, 0.352], [0.065, 0.378], [0, 0.378],
    ], 20);
    tb.add(vessel, GOURD, M(0, 0, -0.4), { top: GOURD_HI });
    tb.add(cyl(0.055, 0.08, 0.1, 10), GOURD_HI, M(0, 0.4, -0.38));
    tb.add(cyl(0.045, 0.04, 0.07, 8), 0x9a6a3a, M(0, 0.47, -0.38));
    tb.add(new THREE.TorusGeometry(0.115, 0.028, 6, 16).rotateX(Math.PI / 2), ROPE, M(0, 0.13, -0.39));
    tb.add(sph(0.045, 6, 5), ROPE, M(0.11, 0.1, -0.4));
    // 背負いひも
    tb.add(new THREE.TorusGeometry(0.33, 0.022, 5, 20, Math.PI).rotateY(Math.PI / 2), 0x7a4e2a, M(0.16, 0.03, -0.06, 0, 1, 1, 0.75, 0, 0.1));
    tb.add(new THREE.TorusGeometry(0.33, 0.022, 5, 20, Math.PI).rotateY(Math.PI / 2), 0x7a4e2a, M(-0.16, 0.03, -0.06, 0, 1, 1, 0.75, 0, -0.1));
    // ホバー用の下向き噴射口（左右）
    for (const s of [-1, 1]) {
      tb.add(cyl(0.05, 0.058, 0.2, 8), BAMBOO, M(s * 0.2, -0.2, -0.4), { top: 0xdfe48e });
      tb.add(cyl(0.06, 0.06, 0.03, 8), 0x7a8a3a, M(s * 0.2, -0.16, -0.4));
    }
    // 肩ごしに前を向く噴射口
    tb.add(cyl(0.04, 0.04, 0.3, 8), BAMBOO, M(0.2, 0.33, -0.3, 0, 1, 1, 1, 0, -0.75));
    tb.add(cyl(0.052, 0.045, 0.42, 8).rotateX(Math.PI / 2), BAMBOO, M(0.3, 0.42, -0.08), { jitter: 0.1 });
    tb.add(cyl(0.062, 0.062, 0.035, 8).rotateX(Math.PI / 2), 0x7a8a3a, M(0.3, 0.42, 0.0));
    tb.add(cyl(0.068, 0.056, 0.06, 8).rotateX(Math.PI / 2), 0xdfe48e, M(0.3, 0.42, 0.14));
  }
  const body = mesh(tb);
  let pumpDetail: Bird['pumpDetail'];
  if (look.pack) {
    // 水圧計はボディと同じ一回の描画に含める。低品質では末尾の計器だけを省く。
    const gauge = new GeoBatch();
    gauge.add(cyl(0.102, 0.106, 0.05, 16).rotateX(Math.PI / 2), 0xd69d46, M(0, -0.035, -0.605));
    gauge.add(cyl(0.084, 0.084, 0.008, 16).rotateX(Math.PI / 2), 0x24505a, M(0, -0.035, -0.632));
    for (const a of [-0.85, 0, 0.85]) {
      gauge.add(box(0.009, 0.018, 0.005), 0xffe9b2, M(Math.sin(a) * 0.062, -0.035 + Math.cos(a) * 0.062, -0.64, 0, 1, 1, 1, 0, -a));
    }
    gauge.add(box(0.013, 0.066, 0.008), 0xffbd5f, M(-0.017, -0.024, -0.645, 0, 1, 1, 1, 0, 0.74));
    gauge.add(cyl(0.011, 0.011, 0.008, 8).rotateX(Math.PI / 2), 0xffdf96, M(0, -0.044, -0.651));
    const plain = body.geometry, details = gauge.build();
    const plainCount = plain.index?.count ?? plain.getAttribute('position').count;
    body.geometry = mergeGeometries([plain, details])!;
    plain.dispose();
    details.dispose();
    pumpDetail = { geometry: body.geometry, plainCount };
  }
  torso.add(body);

  // 頭
  const head = new THREE.Group();
  head.position.set(0, 0.5, 0.03);
  torso.add(head);
  const hb = new GeoBatch();
  addPlumage(hb, look, 'face', 36, 22);
  hb.add(sph(0.05, 8, 6), 0xf7a7a0, M(0.16, -0.07, 0.2, 0, 1, 0.7, 0.5)); // ほっぺ
  hb.add(sph(0.05, 8, 6), 0xf7a7a0, M(-0.16, -0.07, 0.2, 0, 1, 0.7, 0.5));
  addBill(hb, 12);
  addHat(hb, look.hat, 20);
  head.add(mesh(hb));
  // 目（まばたきのため別メッシュ）
  const eg = new GeoBatch();
  eg.add(sph(0.047, 10, 8), 0xffffff, M(0.105, 0.045, 0.232));
  eg.add(sph(0.047, 10, 8), 0xffffff, M(-0.105, 0.045, 0.232));
  const eyes = new THREE.Mesh(eg.build(), matEye);
  head.add(eyes);
  const hl = new GeoBatch();
  hl.add(sph(0.016, 6, 5), 0xffffff, M(0.118, 0.062, 0.272));
  hl.add(sph(0.016, 6, 5), 0xffffff, M(-0.092, 0.062, 0.272));
  eyes.add(new THREE.Mesh(hl.build(), matGlint));

  // つばさ
  const wing = (s: number): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(s * 0.32, 0.16, 0);
    const wb = new GeoBatch();
    wb.add(sph(0.2, 12, 10), look.body, M(s * 0.02, -0.2, -0.02, 0, 0.32, 1.15, 0.78), { ao: 0.85 });
    wb.add(sph(0.1, 8, 6), look.body, M(s * 0.02, -0.4, -0.06, 0, 0.3, 1, 0.8));
    g.add(mesh(wb));
    torso.add(g);
    return g;
  };
  const wingL = wing(-1), wingR = wing(1);

  // 足
  const leg = (s: number): THREE.Group => {
    const g = new THREE.Group();
    g.position.set(s * 0.14, -0.3, 0);
    const lb = new GeoBatch();
    lb.add(cyl(0.036, 0.036, 0.22, 6), ORANGE, M(0, -0.11, 0));
    lb.add(sph(0.1, 10, 6), ORANGE, M(0, -0.235, 0.07, 0, 1.05, 0.36, 1.7));
    g.add(mesh(lb));
    torso.add(g);
    return g;
  };
  const legL = leg(-1), legR = leg(1);

  // スカーフの端（なびく）
  const tail = new THREE.Group();
  tail.position.set(-0.19, 0.27, 0.1);
  const sb = new GeoBatch();
  sb.add(box(0.11, 0.3, 0.035), look.scarf, M(0, -0.15, 0));
  sb.add(box(0.1, 0.22, 0.03), look.scarf, M(0.05, -0.12, 0.03, 0.3));
  tail.add(mesh(sb));
  torso.add(tail);

  return { root, torso, head, eyes, wingL, wingR, legL, legR, tail, pumpDetail, squash: 1, squashV: 0, phase: 0, blink: 2 + Math.random() * 3 };
}

/** 遠くの住人は同じ帽子・羽色・スカーフのシルエットを1メッシュで描く。 */
export function buildDistantBird(look: BirdLook): THREE.Mesh {
  const batch = new GeoBatch();
  batch.setBase(M(0, 0.56, 0));
  addPlumage(batch, look, 'body', 14, 10);
  batch.setBase(new THREE.Matrix4());
  batch.add(cyl(0.23, 0.24, 0.09, 10), look.scarf, M(0, 0.86, 0.01));
  for (const side of [-1, 1]) {
    batch.add(sph(0.2, 7, 5), look.body, M(side * 0.33, 0.53, -0.02, 0, 0.33, 1.15, 0.8));
    batch.add(cyl(0.038, 0.038, 0.22, 5), 0xf2792b, M(side * 0.14, 0.15, 0));
    batch.add(sph(0.1, 6, 4), 0xf2792b, M(side * 0.14, 0.03, 0.07, 0, 1, 0.36, 1.7));
  }

  batch.setBase(M(0, 1.06, 0.03));
  addPlumage(batch, look, 'face', 14, 10);
  for (const side of [-1, 1]) batch.add(sph(0.047, 6, 4), 0x14161c, M(side * 0.105, 0.045, 0.232));
  addBill(batch, 6);
  addHat(batch, look.hat, 12);
  return mesh(batch);
}

/** 状態に応じて手足や体を動かす（スキニングなしの手続きアニメーション） */
export function animateBird(b: Bird, p: BirdPose, dt: number, t: number): void {
  // 伸び縮みのばね（ジャンプや着地で与えた勢いが揺れながら戻る）
  b.squashV += ((1 - b.squash) * 220 - b.squashV * 13) * dt;
  b.squash += b.squashV * dt;
  const sq = Math.min(1.4, Math.max(0.6, b.squash));
  const inv = 1 / Math.sqrt(sq);
  b.torso.scale.set(inv, sq, inv);

  const sp = p.speed;
  if (p.grounded) b.phase += dt * (5 + sp * 11) * (sp > 0.03 ? 1 : 0);
  const s = Math.sin(b.phase), c = Math.cos(b.phase);
  let legA = 0, legB = 0, wingX = 0, wingZ = 0.08, lean = 0, bob = 0, headX = 0, flap = 0;

  if (p.swim) {
    const k = t * (4 + sp * 5);
    lean = 0.95;
    bob = Math.sin(t * 2.2) * 0.04 - 0.1;
    legA = Math.sin(k) * 0.7 + 0.6;
    legB = -Math.sin(k) * 0.7 + 0.6;
    wingZ = 1.0 + Math.sin(k * 0.5) * 0.5;
    wingX = Math.cos(k * 0.5) * 0.5;
    headX = -0.75;
  } else if (p.grounded) {
    legA = s * 0.95 * sp;
    legB = -s * 0.95 * sp;
    wingX = -s * 0.7 * sp;
    wingZ = 0.08 + sp * 0.12;
    lean = sp * 0.2;
    bob = Math.abs(c) * 0.06 * sp + (sp < 0.03 ? Math.sin(t * 2.4) * 0.012 : 0);
    headX = -sp * 0.08 + (sp < 0.03 ? Math.sin(t * 1.2) * 0.03 : 0);
  } else if (p.hover) {
    flap = Math.sin(t * 46) * 0.22;
    wingZ = 1.35 + flap;
    lean = -0.12 + Math.sin(t * 31) * 0.015;
    legA = 0.35 + Math.sin(t * 9) * 0.12;
    legB = 0.35 + Math.cos(t * 9) * 0.12;
    headX = 0.1;
  } else {
    const rising = p.vy > 0;
    wingZ = rising ? 1.75 : 1.05 + Math.sin(t * 22) * 0.3;
    legA = rising ? -0.5 : 0.55;
    legB = rising ? 0.25 : 0.3;
    lean = rising ? -0.08 : 0.16;
    headX = rising ? -0.15 : 0.12;
  }
  if (p.spray && !p.swim) lean -= 0.1;
  if (p.talk) headX += Math.sin(t * 9) * 0.07;

  const k = 1 - Math.exp(-18 * dt);
  b.legL.rotation.x += (legA - b.legL.rotation.x) * k;
  b.legR.rotation.x += (legB - b.legR.rotation.x) * k;
  b.wingL.rotation.x += (wingX - b.wingL.rotation.x) * k;
  b.wingR.rotation.x += (-wingX - b.wingR.rotation.x) * k;
  b.wingL.rotation.z = damp(b.wingL.rotation.z, -wingZ, 22, dt);
  b.wingR.rotation.z = damp(b.wingR.rotation.z, wingZ, 22, dt);
  b.torso.rotation.x = damp(b.torso.rotation.x, lean, 12, dt);
  b.torso.position.y = damp(b.torso.position.y, 0.56 + bob - (1 - sq) * 0.3, 20, dt);
  b.head.rotation.x = damp(b.head.rotation.x, headX, 10, dt);
  b.head.rotation.z = p.grounded ? s * 0.05 * sp : 0;
  // スカーフは速いほど後ろへなびく
  b.tail.rotation.x = damp(b.tail.rotation.x, -sp * 1.1 - (p.grounded ? 0 : 0.6) + Math.sin(t * 13) * 0.1 * (0.3 + sp), 10, dt);

  // まばたき
  b.blink -= dt;
  if (b.blink < 0) b.blink = 2.5 + Math.random() * 3.5;
  b.eyes.scale.y = b.blink < 0.11 ? 0.12 : 1;
}
