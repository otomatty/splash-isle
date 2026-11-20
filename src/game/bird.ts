import * as THREE from 'three';
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
  const belly = new THREE.Color(look.belly);
  // おなかの白い模様は別パーツを重ねず、胴体の頂点色で塗り分ける（重なりのギザギザを出さない）
  tb.add(sph(0.36, 40, 28), look.body, M(0, 0, 0, 0, 1, 1.1, 0.94), {
    ao: 0.8,
    paint: (x, y, z, out) => {
      const e = (x / 0.25) ** 2 + ((y + 0.06) / 0.3) ** 2;
      if (z > 0 && e < 1) out.copy(belly);
    },
  });
  tb.add(cone(0.14, 0.3, 8), look.body, M(0, -0.16, -0.36, 0, 1, 1, 1, -1.9)); // 尾羽
  // スカーフ
  tb.add(new THREE.TorusGeometry(0.2, 0.065, 8, 18).rotateX(Math.PI / 2), look.scarf, M(0, 0.3, 0.01, 0, 1.05, 1, 1));
  tb.add(sph(0.075, 8, 6), look.scarf, M(-0.17, 0.27, 0.15));
  if (look.pack) {
    // ひょうたんポンプ: 釉薬をかけた陶器のひょうたん＋竹の噴射口
    const GOURD = 0x1fa594, GOURD_HI = 0x7fe0cc, BAMBOO = 0xb9c26a, ROPE = 0xd8322e;
    tb.add(sph(0.215, 16, 12), GOURD, M(0, -0.04, -0.4, 0, 1, 0.95, 1), { top: GOURD_HI });
    tb.add(sph(0.15, 14, 10), GOURD, M(0, 0.25, -0.38), { top: GOURD_HI });
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
  torso.add(mesh(tb));

  // 頭
  const head = new THREE.Group();
  head.position.set(0, 0.5, 0.03);
  torso.add(head);
  const hb = new GeoBatch();
  const faceCol = new THREE.Color(0xfdfaf2);
  hb.add(sph(0.275, 40, 28), look.body, undefined, {
    paint: (x, y, z, out) => {
      // 顔の白い部分（左右のほおがつながったハート形）
      const e = ((Math.abs(x) - 0.07) / 0.15) ** 2 + ((y + 0.01) / 0.17) ** 2;
      if (z > 0.02 && e < 1) out.copy(faceCol);
    },
  });
  hb.add(sph(0.05, 8, 6), 0xf7a7a0, M(0.16, -0.07, 0.2, 0, 1, 0.7, 0.5)); // ほっぺ
  hb.add(sph(0.05, 8, 6), 0xf7a7a0, M(-0.16, -0.07, 0.2, 0, 1, 0.7, 0.5));
  // くちばし
  hb.add(cone(0.105, 0.25, 12).rotateX(Math.PI / 2), ORANGE, M(0, -0.055, 0.33, 0, 1, 0.8, 1), { top: 0xf6a23a });
  hb.add(cyl(0.11, 0.11, 0.035, 12).rotateX(Math.PI / 2), 0xf6c443, M(0, -0.055, 0.215, 0, 1, 0.8, 1));
  // 麦わら帽子
  const hatM = M(0, 0.2, -0.02, 0, 1, 1, 1, -0.16);
  hb.add(cyl(0.36, 0.38, 0.03, 20), 0xe9cf86, hatM, { jitter: 0.08 });
  hb.add(cyl(0.17, 0.2, 0.17, 16), 0xe9cf86, hatM.clone().multiply(M(0, 0.09, 0)), { top: 0xf3dfa2 });
  hb.add(cyl(0.205, 0.207, 0.06, 16), look.hat, hatM.clone().multiply(M(0, 0.045, 0)));
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
  eyes.add(new THREE.Mesh(hl.build(), new THREE.MeshBasicMaterial({ color: 0xffffff })));

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

  return { root, torso, head, eyes, wingL, wingR, legL, legR, tail, squash: 1, squashV: 0, phase: 0, blink: 2 + Math.random() * 3 };
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
