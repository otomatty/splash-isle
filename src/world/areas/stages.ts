import * as THREE from 'three';
import { M, box, cone, cyl, sph } from '../props';
import { Area, BLUE, STONE, TEAL, TERRACOTTA, WALLS, WOOD, WOOD_DARK, type AreaKey, type Look, type MissionDef } from '../area';
import { DEEP, DEFAULT_PALETTE, heightAt, type Palette, type TerrainDef } from '../terrain';
import { Goop, scatterGoop } from '../goop';
import type { Box } from '../colliders';
import { fbm, sstep } from '../../engine/noise';

const COLORS = [0xe8483f, 0xf6c443, 0x22a6a0, 0x3a78c8, 0xf08a2e];

/** 町以外のエリアの共通部分。入るときに選んだステージ（episode）に合わせて中身が変わる */
abstract class Stage extends Area {
  constructor(readonly episode: number, missions: MissionDef[]) {
    super();
    this.missions.push(missions[episode]);
  }

  protected get mission(): MissionDef {
    return this.missions[0];
  }

  /** このステージのヒカリ石を置く。reach 以外は条件を満たすまで隠れている */
  protected placeGem(pos: THREE.Vector3): void {
    this.gems.push({ id: this.mission.gem, pos, hidden: this.mission.kind !== 'reach' });
  }

  protected guide(x: number, z: number, faceX: number, faceZ: number, name: string, lines: string[], body: number, hat: number): void {
    this.npcs.push({ x, z, yaw: Math.atan2(faceX - x, faceZ - z), name, lines, body, belly: 0xfff4d8, hat });
  }

  /** 石で縁取った湯だまり（入ると水を補給できる） */
  protected pond(x: number, z: number, r: number, color = 0x6fd8e0): void {
    const y = heightAt(x, z);
    const b = this.matte.setBase(M(x, y, z));
    const n = Math.round(r * 5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const s = 0.34 + ((i * 7) % 5) * 0.05;
      b.add(sph(s, 6, 5), 0x7d7468, M(Math.cos(a) * (r + 0.15), 0.12, Math.sin(a) * (r + 0.15), a, 1, 0.7, 1), { top: 0xa59a8a, jitter: 0.3 });
    }
    this.waterDisc(x, y + 0.22, z, r, color);
  }
}

// ═════════════════════════ ゆけむり山（温泉火山） ═════════════════════════
const V_C = [56, 40, 26]; // 段々の崖の位置（中心からの距離）
const vWob = (th: number) => 3 * Math.sin(3 * th + 0.5) + 2 * Math.sin(7 * th + 1.7);
const V_RAMP = (52 * Math.PI) / 180;

function volcanoHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const w = vWob(Math.atan2(z, x));
  const inland = 96 + w * 1.5 - r;
  if (inland < 0) return DEEP * (1 - Math.exp(inland / 22));
  let h = 4.6 * (1 - Math.exp(-inland / 8));
  // 東がわ（52度あたり）だけ崖がゆるい坂になっていて、歩いて2段目へ上がれる
  const da = Math.atan2(z, x) - V_RAMP;
  const rw = 1.5 + 8.5 * Math.exp(-(da * da) / 0.012);
  h += 11 * sstep(V_C[0] + w * 0.8 + rw, V_C[0] + w * 0.8 - rw, r);
  h += 12 * sstep(V_C[1] + w * 0.6 + 1.5, V_C[1] + w * 0.6 - 1.5, r);
  h += 12 * sstep(V_C[2] + w * 0.4 + 1.5, V_C[2] + w * 0.4 - 1.5, r);
  h -= 7.1 * sstep(17.5, 13, r); // 火口
  h += (fbm(x * 0.09, z * 0.09, 3, 11) - 0.5) * 0.7 * sstep(2, 8, inland);
  return h;
}

const VOLCANO_PALETTE: Palette = {
  ...DEFAULT_PALETTE,
  sandA: [0.20, 0.17, 0.16], sandB: [0.36, 0.30, 0.26],
  grassA: [0.30, 0.24, 0.10], grassB: [0.52, 0.42, 0.16], grassC: [0.60, 0.36, 0.14],
  rockA: [0.13, 0.11, 0.11], rockB: [0.42, 0.24, 0.17],
  dirtA: [0.36, 0.26, 0.18], dirtB: [0.56, 0.42, 0.28],
  grassFrom: 2.2, grassTo: 3.8, rockSlope: 0.2,
};

export const VOLCANO_TERRAIN: TerrainDef = {
  world: 256,
  raw: volcanoHeight,
  paths: [
    { pts: [[0, 92], [0, 62]], width: 2.6 },
    { pts: [[-24, 70], [24, 70]], width: 2.2 },
    { pts: [[24, 70], [42, 55], [28.5, 36.5]], width: 2.4 }, // 2段目への坂道
  ],
  streets: [],
  plazas: [],
  palette: VOLCANO_PALETTE,
};

export const VOLCANO_MISSIONS: MissionDef[] = [
  { gem: 5, kind: 'reach', title: '火口のまんなかへ', hint: '間欠泉で段をのぼり <b>火口の岩</b>をめざそう' },
  { gem: 6, kind: 'clean', title: '温泉街のスミを洗い流そう', hint: '温泉街の<b>スミ</b>を洗い流そう' },
  { gem: 7, kind: 'collect', title: '山にちらばるヒトデを8つ', hint: '山じゅうの<b>ヒトデ</b>をさがそう' },
];

export class Volcano extends Stage {
  readonly key: AreaKey = 'volcano';
  readonly name = 'ゆけむり山';
  readonly terrain = VOLCANO_TERRAIN;
  readonly look: Look = { sun: [-0.62, 0.44, 0.5], sunColor: 0xffc890, zenith: 0x3b63c0, horizon: 0xf6c8a2, sunIntensity: 3.1, hemi: 0.5, fog: 0.0011 };

  constructor(episode: number) {
    super(episode, VOLCANO_MISSIONS);
    this.shellBase = 64;
    this.spawn.set(0, heightAt(0, 90), 90);
    this.goop = new Goop(0, 72);
    this.enemyLeash = { x: 0, z: 0, r: 60 };
    const P = (deg: number, r: number): [number, number] => [Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r];

    // 温泉街（1段目・南側）
    const houses: [number, number, number, number, number][] = [[-15, 80, 0, 6, 4.4], [15, 80, 1, 6, 4.4], [-22, 63, 2, 7, 5.2], [22, 63, 4, 7, 5.2]];
    for (const [x, z, wall, w, h] of houses) {
      const roof = this.buildHouse(x, z, Math.atan2(-x, 71 - z), w, 6, h, [0xe7d6b8, 0xd8c3a0, 0xf0e2c8, 0, 0xcdb894][wall], 0x7a3b2a, false, wall === 2, true, wall !== 2, wall);
      this.roofs.push(roof);
      this.shells.push(roof.clone().add(new THREE.Vector3(0, 0.9, 0)));
    }
    this.pond(-8, 72, 3.2);
    this.pond(9, 74, 2.6);
    this.pond(34, 62, 3.4);
    this.pond(-40, 58, 3.0);
    for (const [x, z] of [[-3, 82], [4, 66], [-13, 66]]) this.lampPost(x, z);
    this.bench(2.5, 76, 0.4);
    this.barrel(-17, heightAt(-17, 73), 73);
    this.crate(18, heightAt(18, 72), 72, 1.2, 0.5);

    // 段をのぼる間欠泉（周期的に噴き上がる）
    const g1 = P(118, 60.5), g2 = P(205, 44.5), g3 = P(318, 30.2);
    this.geyser(g1[0], g1[1], 27.6, 4.2, 0);
    this.geyser(g2[0], g2[1], 28.4, 4.2, 1.3);
    this.geyser(g3[0], g3[1], 28.4, 4.2, 2.6);
    // 火口に落ちても、湖の間欠泉でふちへ戻れる
    this.geyser(-9.5, 3, 23.8, 3.4, 0.8);
    for (const [deg, r] of [[150, 47], [260, 47], [20, 47], [100, 33], [240, 33]] as const) {
      const p = P(deg, r);
      this.pond(p[0], p[1], 2.4, 0x86e0d8);
    }

    // 火口湖と、まんなかの岩へ渡る足場
    const lakeY = heightAt(0, 0) + 0.62;
    this.waterDisc(0, lakeY, 0, 13.2, 0x4fd6c8);
    const top = this.rockPillar(0, 0, 2.7, lakeY + 7.4, false);
    const rim = heightAt(21, 0);
    this.floatBlock(15.2, rim + 0.3, 0.6, 2.8, COLORS[0], { az: 2.2, sp: 0.9 }, 0);
    this.floatBlock(10.4, rim - 0.2, -1.2, 2.6, COLORS[1], { ay: 1.0, sp: 1.2 }, 1);
    this.floatBlock(6.0, top - 0.9, 0.8, 2.4, COLORS[2], {}, 2);
    this.shells.push(new THREE.Vector3(15.2, rim + 1.4, 0.6), new THREE.Vector3(6.0, top + 0.2, 0.8));
    this.refills.push(new THREE.Vector3(21, rim + 1.0, -5));

    // 道中の貝がら
    for (const [deg, r] of [[90, 78], [70, 70], [140, 48], [185, 48], [230, 34], [290, 34], [0, 21], [180, 21]] as const) {
      const p = P(deg, r);
      this.shells.push(new THREE.Vector3(p[0], heightAt(p[0], p[1]) + 0.9, p[1]));
    }

    this.guide(3.5, 86, 0, 90, 'ユノ', [
      ['火口のまんなかの岩に ヒカリ石があるよ', '石で囲まれた間欠泉は 噴き上がるときに乗ると 上の段まで飛べるんだ', '2段目へは 東がわの坂道からも 上がれるよ'],
      ['温泉街が スミで べとべとなんだ…', '湯だまりに入ると 水を補給できるよ', 'ぜんぶ洗い流すと ヒカリ石が出てくるはず'],
      ['山じゅうに ヒトデが 8つ ちらばってるよ', 'いちばん上の火口にも あるらしい', '間欠泉で どんどん上へ！'],
    ][episode], 0xc9703f, 0x7a3b2a);

    this.finishStatic();
    this.scatter({
      radius: 100, palms: 16, bushes: 60, grass: 7000, flowers: 300, shoreRocks: 30, seed: 31,
      avoid: (x, z) => Math.hypot(x, z) < 16 || Math.hypot(x, z - 72) < 9,
      palmH: [1.6, 6], grassFrom: 2.4,
      hills: [{ x: 0, z: 0, r0: 28, r1: 52, count: 22 }],
    });

    if (this.mission.kind === 'clean') {
      scatterGoop(this.goop, 0, 73, 12);
      this.goop.paintBlob(26, 66, 5, 3);
      this.goop.paintBlob(-27, 67, 5, 4);
    }
    this.finalizeGoop();
    if (this.mission.kind === 'clean') this.pickEnemySpots(4, 0, 73, 5, 18, 8);
    else {
      for (const deg of [160, 250, 30]) {
        const p = P(deg, 48);
        this.enemySpawns.push({ pos: new THREE.Vector3(p[0], heightAt(p[0], p[1]), p[1]) });
      }
    }
    if (this.mission.kind === 'collect') {
      const at = (x: number, z: number, dy = 0.6) => this.starfish.push(new THREE.Vector3(x, heightAt(x, z) + dy, z));
      this.starfish.push(this.roofs[2].clone().add(new THREE.Vector3(1, 0.6, 1))); // 温泉宿の屋上
      at(...P(70, 84)); // 浜
      at(...P(300, 80));
      at(...P(170, 49));
      at(...P(330, 48));
      at(...P(90, 33));
      at(...P(215, 21));
      this.starfish.push(new THREE.Vector3(0, top + 0.6, 0)); // 火口の岩の上
    }
    const gemAt: THREE.Vector3[] = [new THREE.Vector3(0, top + 1.7, 0), new THREE.Vector3(0, heightAt(0, 71) + 1.7, 71), new THREE.Vector3(0, heightAt(0, 86) + 1.7, 86)];
    this.placeGem(gemAt[episode]);
  }
}

// ═════════════════════════ サンゴ入り江（難破船の環礁） ═════════════════════════
const ringAt = (th: number) => 73 + 4 * Math.sin(3 * th + 1) + 3 * Math.sin(5 * th);
const MESA = { x: 0, z: -74, r: 15, h: 22 };

function lagoonHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const rc = ringAt(Math.atan2(z, x));
  const d = Math.abs(r - rc);
  let h = 3.7 - (d / 13) * (d / 13) * 5.3;
  if (r < rc) h = Math.max(h, -3.3 + (fbm(x * 0.07, z * 0.07, 3, 4) - 0.5) * 1.2);
  else h = Math.max(h, DEEP * (1 - Math.exp(-(r - rc) / 26)));
  h = Math.max(h, 1.3 - (r / 12) * (r / 12) * 2.6); // まんなかの砂州
  const dm = Math.hypot(x - MESA.x, z - MESA.z);
  const mh = MESA.h * sstep(MESA.r + 1.4, MESA.r - 1.4, dm); // 北の岬
  if (mh > 0) h = Math.max(h, mh);
  return h;
}

const LAGOON_PALETTE: Palette = {
  ...DEFAULT_PALETTE,
  sandA: [0.66, 0.58, 0.44], sandB: [0.84, 0.78, 0.62],
  grassA: [0.08, 0.32, 0.10], grassB: [0.24, 0.56, 0.16], grassC: [0.36, 0.60, 0.20],
  rockA: [0.44, 0.38, 0.33], rockB: [0.72, 0.62, 0.50],
  grassFrom: 2.7, grassTo: 3.6,
};

export const LAGOON_TERRAIN: TerrainDef = {
  world: 256,
  raw: lagoonHeight,
  paths: [],
  streets: [],
  plazas: [],
  palette: LAGOON_PALETTE,
};

export const LAGOON_MISSIONS: MissionDef[] = [
  { gem: 8, kind: 'reach', title: '難破船のマストのてっぺんへ', hint: '難破船の <b>マストのてっぺん</b>をめざそう' },
  { gem: 9, kind: 'defeat', title: '入り江のスミボウたいじ', hint: '入り江の<b>スミボウ</b>をぜんぶやっつけよう' },
  { gem: 10, kind: 'collect', title: 'サンゴの上のヒトデを8つ', hint: '入り江の<b>ヒトデ</b>をさがそう' },
];

export class Lagoon extends Stage {
  readonly key: AreaKey = 'lagoon';
  readonly name = 'サンゴ入り江';
  readonly terrain = LAGOON_TERRAIN;
  readonly look: Look = { sun: [0.22, 0.9, 0.36], sunColor: 0xfff8e6, zenith: 0x2a78de, horizon: 0xbfeaf4, sunIntensity: 3.0, hemi: 0.6, fog: 0.0007 };

  constructor(episode: number) {
    super(episode, LAGOON_MISSIONS);
    this.shellBase = 128;
    this.spawn.set(0, heightAt(0, 73), 73);
    this.enemyLeash = { x: 0, z: 0, r: 100 };

    // ── 難破船（砂州に乗り上げている） ──
    const DECK = 3.6;
    const b = this.matte.setBase(M(0, 0, 0));
    const hullCol = 0x7a5232, plank = 0xa87e50;
    b.add(box(22, 3.4, 6), hullCol, M(0, DECK - 1.7, 0), { ao: 0.6, jitter: 0.18 });
    b.add(box(22.4, 0.14, 6.4), plank, M(0, DECK - 0.07, 0), { jitter: 0.12 });
    b.add(box(22.6, 0.3, 0.3), WOOD_DARK, M(0, DECK + 0.5, 3.05));
    b.add(box(22.6, 0.3, 0.3), WOOD_DARK, M(0, DECK + 0.5, -3.05));
    for (let i = 0; i < 12; i++) for (const s of [-1, 1]) b.add(box(0.16, 0.6, 0.16), WOOD_DARK, M(-10.4 + i * 1.9, DECK + 0.25, s * 3.05));
    this.colliders.addBox(0, DECK - 1.7, 0, 22, 3.4, 6);
    // 船尾楼と船首楼
    b.add(box(5.4, 2.0, 6), hullCol, M(8.3, DECK + 1.0, 0), { ao: 0.75, jitter: 0.15 });
    b.add(box(5.6, 0.14, 6.2), plank, M(8.3, DECK + 2.0, 0), { jitter: 0.12 });
    this.gloss.setBase(M(0, 0, 0)).add(box(0.1, 0.9, 1.1), 0x9fd8e8, M(5.58, DECK + 1.0, -1.4)).add(box(0.1, 0.9, 1.1), 0x9fd8e8, M(5.58, DECK + 1.0, 1.4));
    this.colliders.addBox(8.3, DECK + 1.0, 0, 5.4, 2.0, 6);
    b.add(box(4.2, 1.2, 6), hullCol, M(-8.9, DECK + 0.6, 0), { ao: 0.75, jitter: 0.15 });
    b.add(box(4.4, 0.14, 6.2), plank, M(-8.9, DECK + 1.2, 0));
    this.colliders.addBox(-8.9, DECK + 0.6, 0, 4.2, 1.2, 6);
    // 折れた船首と舵
    b.add(cone(2.9, 5, 4).rotateZ(Math.PI / 2), hullCol, M(-13.4, DECK - 1.6, 0, 0, 1, 0.62, 1), { jitter: 0.15 });
    b.add(cyl(0.12, 0.12, 5.5, 6).rotateZ(1.2), WOOD_DARK, M(-13.6, DECK + 2.0, 0));
    this.crate(4.6, DECK, 1.7, 1.1, 0.2);
    this.crate(-5.2, DECK, -1.9, 1.2, 0.5);
    this.barrel(2.6, DECK, -2.2);
    // 砂州から甲板への渡し板
    this.plankBridge(-3.5, heightAt(-3.5, 7.6) + 0.05, 7.6, -3.5, DECK, 3.4, 2.2);

    // メインマスト: らせん状の足場 → 見張り台
    const n = 9, rise = 1.52;
    const NEST = DECK + n * rise + 1.4;
    const MAST = NEST + 0.2 - DECK;
    b.add(cyl(0.34, 0.5, MAST, 10), 0x6b4a2c, M(0, DECK + MAST / 2, 0), { top: 0x9a7448 });
    this.colliders.addCyl(0, 0, DECK, DECK + MAST, 0.5);
    let a = 0.6;
    let midStep = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const top = DECK + (i + 1) * rise;
      // 上の2段は見張り台のひさしより外へ張り出す
      const rc = i === n - 1 ? 3.1 : i === n - 2 ? 2.55 : 2.05;
      const sx = Math.cos(a) * rc, sz = Math.sin(a) * rc;
      const sm = M(sx, top, sz, -a);
      b.add(box(1.9, 0.16, 1.5), plank, sm.clone().multiply(M(0, -0.08, 0)), { jitter: 0.12 });
      b.add(box(1.7, 0.1, 0.12), WOOD_DARK, sm.clone().multiply(M(-0.4, -0.22, 0)));
      this.colliders.addBox(sx, top - 0.13, sz, 1.9, 0.26, 1.5, -a);
      if (i % 3 === 1) this.shells.push(new THREE.Vector3(sx, top + 0.9, sz));
      if (i === 4) midStep = new THREE.Vector3(sx, top, sz);
      a += 0.98;
    }
    b.add(cyl(1.7, 1.4, 0.4, 14), plank, M(0, NEST - 0.2, 0), { jitter: 0.12 });
    b.add(new THREE.TorusGeometry(1.65, 0.06, 6, 22).rotateX(Math.PI / 2), WOOD_DARK, M(0, NEST + 0.7, 0));
    for (let i = 0; i < 8; i++) b.add(cyl(0.045, 0.045, 0.7, 6), WOOD_DARK, M(Math.cos(i * 0.785) * 1.65, NEST + 0.35, Math.sin(i * 0.785) * 1.65));
    this.colliders.addCyl(0, 0, NEST - 0.4, NEST, 1.7);
    // 帆桁（途中から船首のマストへ渡れる）
    const YARD = midStep.y + 0.1;
    b.add(box(13, 0.3, 0.9), 0x6b4a2c, M(-6.9, YARD - 0.15, 0));
    this.colliders.addBox(-6.9, YARD - 0.15, 0, 13, 0.3, 0.9);
    b.add(cyl(0.3, 0.42, YARD + 2.6 - DECK - 1.2, 10), 0x6b4a2c, M(-8.9, (YARD + 2.6 + DECK + 1.2) / 2, 0));
    this.colliders.addCyl(-8.9, 0, DECK + 1.2, YARD - 0.3, 0.42);
    b.add(cyl(1.7, 1.4, 0.36, 12), plank, M(-12.2, YARD + 0.9, 0));
    this.colliders.addCyl(-12.2, 0, YARD + 0.54, YARD + 0.9, 1.7);
    // ぼろぼろの帆
    const sail = new THREE.PlaneGeometry(8, 5, 6, 4);
    const sp = sail.getAttribute('position');
    for (let i = 0; i < sp.count; i++) sp.setZ(i, Math.sin(sp.getX(i) * 0.5) * 0.5 + Math.cos(sp.getY(i) * 0.9) * 0.3);
    sail.computeVertexNormals();
    const sailMesh = new THREE.Mesh(sail, new THREE.MeshStandardMaterial({ color: 0xe9dfc8, roughness: 0.9, side: THREE.DoubleSide }));
    sailMesh.position.set(-6.9, YARD - 3.0, 0.2);
    sailMesh.castShadow = true;
    this.root.add(sailMesh);

    // ── サンゴの柱（入り江の飛び石） ──
    const corals: [number, number, number, number, number][] = [
      [-16, 30, 2.4, 1.6, 0xf07aa0], [-28, 44, 2.0, 2.3, 0xf6a04a], [14, 34, 2.2, 1.8, 0xf6c443], [30, 22, 2.6, 2.6, 0xf07aa0],
      [38, -8, 2.2, 1.9, 0x9a7ae0], [24, -30, 2.4, 2.4, 0xf6a04a], [-30, -18, 2.6, 2.0, 0xf07aa0], [-42, 10, 2.0, 2.8, 0x9a7ae0],
    ];
    for (const [x, z, r, top, col] of corals) {
      this.rockPillar(x, z, r, top, false);
      this.matte.setBase(M(x, top, z)).add(cyl(r * 1.02, r * 0.96, 0.22, 14), col, M(0, -0.08, 0), { top: 0xffe2d0 });
      for (let i = 0; i < 4; i++) {
        const an = i * 1.7 + x;
        this.matte.setBase(M(x, top, z)).add(cone(0.3, 0.9 + (i % 2) * 0.5, 6), col, M(Math.cos(an) * r * 1.05, -0.7, Math.sin(an) * r * 1.05, 0, 1, 1, 1, 0.5, 0), { top: 0xffe2d0 });
      }
    }

    // ── 北の岬（間欠泉で一気に上がれる） ──
    this.geyser(17.7, -70.8, 35.2, 4.4, 0.5);
    const hut = this.buildHouse(MESA.x - 2, MESA.z - 3, 0.3, 6, 6, 4.4, WALLS[3], BLUE, true, false, false, true, 3);
    this.pond(MESA.x + 6.5, MESA.z + 4, 2.4);
    this.shells.push(hut.clone().add(new THREE.Vector3(0, 3.2, 0)));

    // 浜の飾り
    for (const [deg, col] of [[70, 0], [110, 3], [200, 1], [330, 2]] as const) {
      const th = (deg * Math.PI) / 180, rr = ringAt(th) + 2;
      const x = Math.cos(th) * rr, z = Math.sin(th) * rr, y = heightAt(x, z);
      const bb = this.matte.setBase(M(x, y, z, deg));
      bb.add(cyl(0.045, 0.045, 2.5, 6), 0xf3ead6, M(0, 1.25, 0));
      bb.add(cone(1.75, 0.62, 8), COLORS[col], M(0, 2.6, 0), { top: 0xfaf6ea });
      bb.add(box(0.9, 0.03, 1.9), COLORS[(col + 2) % 5], M(1.0, 0.03, 0.3, 0.3));
      this.colliders.addCyl(x, z, y, y + 2.4, 0.08);
    }
    for (const deg of [20, 60, 100, 140, 180, 220, 260, 300, 340]) {
      const th = (deg * Math.PI) / 180, rr = ringAt(th);
      const x = Math.cos(th) * rr, z = Math.sin(th) * rr;
      this.shells.push(new THREE.Vector3(x, heightAt(x, z) + 0.9, z));
    }

    this.guide(4, 71, 0, 74, 'ナギ', [
      ['まんなかの難破船が見える？ マストのてっぺんが 光ってるんだ', '入り江は浅いから 泳いで渡れるよ', 'マストの足場を ぐるぐる のぼっていこう'],
      ['入り江に スミボウが わいて出たんだ！', 'ひときわ大きいやつは 水をたっぷり かけないと たおせないよ', '上から踏みつけるのも 効くよ'],
      ['ヒトデが サンゴの柱の上に いるよ', '北の岬の上にも 1つ。間欠泉で 飛び上がれるよ', '船のマストにも かくれてるかも'],
    ][episode], 0x3f8fb0, 0xf6c443);

    this.finishStatic();
    this.scatter({
      radius: 92, palms: 46, bushes: 30, grass: 2500, flowers: 250, shoreRocks: 26, seed: 47,
      avoid: (x, z) => Math.hypot(x, z) < 20 || Math.hypot(x, z - 73) < 5 || Math.hypot(x - 17.7, z + 70.8) < 4,
      palmH: [2.2, 5], grassFrom: 2.9,
    });
    this.finalizeGoop();

    if (this.mission.kind === 'defeat') {
      for (const deg of [128, 150, 172, 196, 218, 30, 52, 300]) {
        const th = (deg * Math.PI) / 180, rr = ringAt(th) + (deg % 3) - 1;
        const x = Math.cos(th) * rr, z = Math.sin(th) * rr;
        this.enemySpawns.push({ pos: new THREE.Vector3(x, heightAt(x, z), z) });
      }
      const th = (242 * Math.PI) / 180;
      const bx = Math.cos(th) * ringAt(th), bz = Math.sin(th) * ringAt(th);
      this.enemySpawns.push({ pos: new THREE.Vector3(bx, heightAt(bx, bz), bz), big: true });
    } else if (this.mission.kind === 'collect') {
      for (const deg of [150, 30]) {
        const th = (deg * Math.PI) / 180;
        const x = Math.cos(th) * ringAt(th), z = Math.sin(th) * ringAt(th);
        this.enemySpawns.push({ pos: new THREE.Vector3(x, heightAt(x, z), z) });
      }
      for (const i of [1, 3, 5, 7]) this.starfish.push(new THREE.Vector3(corals[i][0], corals[i][3] + 0.6, corals[i][1]));
      this.starfish.push(new THREE.Vector3(-12.2, YARD + 1.5, 0)); // 船首マストの見張り台
      this.starfish.push(new THREE.Vector3(8.3, DECK + 2.6, 0)); // 船尾楼
      this.starfish.push(new THREE.Vector3(MESA.x + 2, MESA.h + 0.6, MESA.z + 8)); // 岬の上
      const th = (250 * Math.PI) / 180;
      this.starfish.push(new THREE.Vector3(Math.cos(th) * ringAt(th), 4.2, Math.sin(th) * ringAt(th)));
    }
    const gemAt = [new THREE.Vector3(0, NEST + 1.7, 0), new THREE.Vector3(0, heightAt(0, 66) + 2.4, 66), new THREE.Vector3(0, DECK + 1.9, 0.0)];
    if (episode === 2) gemAt[2].set(-3.5, DECK + 1.9, -1.2);
    this.placeGem(gemAt[episode]);
  }
}

// ═════════════════════════ そよかぜ台地（吊り橋と気球） ═════════════════════════
const MESAS = [
  { x: 0, z: 62, r: 19, h: 8 },
  { x: -50, z: 22, r: 15, h: 15 },
  { x: -34, z: -40, r: 14, h: 23 },
  { x: 30, z: -48, r: 13, h: 31 },
  { x: 58, z: 6, r: 11, h: 40 },
];

function plateauHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const th = Math.atan2(z, x);
  const inland = 100 + 5 * Math.sin(3 * th + 2) + 3 * Math.sin(5 * th) - r;
  let h = inland >= 0 ? 2.7 * (1 - Math.exp(-inland / 9)) + (fbm(x * 0.06, z * 0.06, 3, 21) - 0.5) * 1.0 * sstep(4, 14, inland) : DEEP * (1 - Math.exp(inland / 22));
  for (const m of MESAS) {
    const d = Math.hypot(x - m.x, z - m.z);
    const edge = m.r + 1.2 * Math.sin(Math.atan2(z - m.z, x - m.x) * 3 + m.x);
    const mh = m.h * sstep(edge + 1.3, edge - 1.3, d);
    if (mh > 0) h = Math.max(h, mh);
  }
  return h;
}

const PLATEAU_PALETTE: Palette = {
  ...DEFAULT_PALETTE,
  grassA: [0.10, 0.34, 0.06], grassB: [0.34, 0.60, 0.12], grassC: [0.52, 0.64, 0.16],
  rockA: [0.40, 0.27, 0.18], rockB: [0.78, 0.58, 0.40],
  grassFrom: 0.9, grassTo: 1.9, rockSlope: 0.22,
};

export const PLATEAU_TERRAIN: TerrainDef = {
  world: 256,
  raw: plateauHeight,
  paths: [{ pts: [[0, 96], [0, 88]], width: 2.6 }],
  streets: [],
  plazas: [{ x: MESAS[0].x, z: MESAS[0].z, r: 9 }],
  palette: PLATEAU_PALETTE,
};

export const PLATEAU_MISSIONS: MissionDef[] = [
  { gem: 11, kind: 'reach', title: 'いちばん高い台地へ', hint: '吊り橋と気球をわたって <b>いちばん高い台地</b>へ' },
  { gem: 12, kind: 'clean', title: '台地の村のスミを洗い流そう', hint: '村の<b>スミ</b>を洗い流そう' },
  { gem: 13, kind: 'collect', title: '空にちらばるヒトデを8つ', hint: '台地じゅうの<b>ヒトデ</b>をさがそう' },
];

export class Plateau extends Stage {
  readonly key: AreaKey = 'plateau';
  readonly name = 'そよかぜ台地';
  readonly terrain = PLATEAU_TERRAIN;
  readonly look: Look = { sun: [0.72, 0.5, -0.34], sunColor: 0xfff0da, zenith: 0x5a98ea, horizon: 0xf4dbe6, sunIntensity: 2.8, hemi: 0.6, fog: 0.0009 };

  /** 足場の上に気球をつける（見た目だけ） */
  private balloon(bx: Box, color: number): void {
    const mover = this.movers.find((m) => m.box === bx);
    if (!mover) return;
    const g = new THREE.Group();
    const env = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
    env.scale.set(1, 1.18, 1);
    env.position.y = 5.2;
    env.castShadow = true;
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.08, 6, 20).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xfaf6ea }));
    band.position.y = 5.2;
    g.add(env, band);
    const rope = new THREE.MeshStandardMaterial({ color: 0x6b5a48 });
    const s = (mover.box.hx - 0.2);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 4.1, 4), rope);
      r.position.set(sx * s * 0.72, 2.0, sz * s * 0.72);
      r.rotation.set(-sz * 0.2, 0, sx * 0.2);
      g.add(r);
    }
    mover.mesh.add(g);
  }

  constructor(episode: number) {
    super(episode, PLATEAU_MISSIONS);
    this.shellBase = 192;
    this.spawn.set(0, heightAt(0, 93), 93);
    const [m0, m1, m2, m3, m4] = MESAS;
    this.goop = new Goop(m0.x, m0.z);
    this.enemyLeash = { x: m0.x, z: m0.z, r: 19 };
    const edge = (a: { x: number; z: number; r: number }, b2: { x: number; z: number }, inset: number): [number, number] => {
      const d = Math.hypot(b2.x - a.x, b2.z - a.z);
      return [a.x + ((b2.x - a.x) / d) * (a.r - inset), a.z + ((b2.z - a.z) / d) * (a.r - inset)];
    };

    // ふもとから村の台地への階段
    this.plankBridge(0, heightAt(0, 90) + 0.05, 90, 0, m0.h + 0.04, m0.z + m0.r - 3.6, 2.6);
    // 村（1つ目の台地）
    this.fountain(m0.x, m0.z);
    const homes: [number, number, number, number][] = [[35, 0, 6, 4.4], [150, 1, 6, 5.2], [262, 4, 7, 4.4], [325, 5, 6, 5.2]];
    for (const [deg, wall, w, h] of homes) {
      const th = (deg * Math.PI) / 180;
      const x = m0.x + Math.cos(th) * 12.5, z = m0.z + Math.sin(th) * 12.5;
      const roof = this.buildHouse(x, z, Math.atan2(m0.x - x, m0.z - z), w, 5.5, h, WALLS[wall], [TERRACOTTA, TEAL, BLUE, 0x8b5fbf][wall % 4], false, false, wall !== 1, true, wall);
      this.roofs.push(roof);
      this.shells.push(roof.clone().add(new THREE.Vector3(0, 0.9, 0)));
    }
    for (const deg of [90, 270]) this.lampPost(m0.x + Math.cos((deg * Math.PI) / 180) * 7.5, m0.z + Math.sin((deg * Math.PI) / 180) * 7.5);
    for (const r of this.roofs) this.pennants(new THREE.Vector3(m0.x, m0.h + 3.45, m0.z), r.clone().add(new THREE.Vector3(0, 0.5, 0)), 1.1);

    // 村 → 2つ目の台地: 長い吊り橋
    // 台地のふちは波打っているので、橋の両端は台地の内側までしっかり掛ける
    const b0 = edge(m0, m1, 3.4), b1 = edge(m1, m0, 3.4);
    this.plankBridge(b0[0], m0.h + 0.04, b0[1], b1[0], m1.h + 0.04, b1[1], 2.2);
    this.pond(m1.x - 4, m1.z + 3, 2.6);
    this.shells.push(new THREE.Vector3((b0[0] + b1[0]) / 2, (m0.h + m1.h) / 2 + 1.3, (b0[1] + b1[1]) / 2));

    // 2つ目 → 3つ目: 気球の足場を渡る
    const c0 = edge(m1, m2, 1.0), c1 = edge(m2, m1, 1.0);
    for (let i = 1; i <= 5; i++) {
      const t = i / 6;
      const x = c0[0] + (c1[0] - c0[0]) * t + (i % 2 ? 1.6 : -1.6), z = c0[1] + (c1[1] - c0[1]) * t;
      const y = m1.h + (m2.h - m1.h) * t + 0.25;
      const move = i === 2 ? { ax: 2.6, sp: 0.9 } : i === 4 ? { ay: 1.1, sp: 1.1 } : {};
      const bx = this.floatBlock(x, y, z, 3.0, COLORS[i % 5], move, i);
      this.balloon(bx, COLORS[(i + 2) % 5]);
      if (i % 2) this.shells.push(new THREE.Vector3(x, y + 1.0, z));
    }
    this.refills.push(new THREE.Vector3(m2.x + 3, m2.h + 1.0, m2.z + 4));

    // 3つ目 → 4つ目: 大きなゴンドラが行き来する
    const g0 = edge(m2, m3, 0.6), g1 = edge(m3, m2, 0.6);
    const gx = (g0[0] + g1[0]) / 2, gz = (g0[1] + g1[1]) / 2, span = Math.hypot(g1[0] - g0[0], g1[1] - g0[1]) / 2 - 3.6;
    const ux = (g1[0] - g0[0]) / (span * 2 + 7.2), uz = (g1[1] - g0[1]) / (span * 2 + 7.2);
    const gon = this.floatBlock(gx, (m2.h + m3.h) / 2 + 0.3, gz, 4.4, COLORS[3], { ax: ux * span, az: uz * span, ay: (m3.h - m2.h) / 2 - 0.2, sp: 0.42 }, -1.57);
    this.balloon(gon, COLORS[0]);
    this.pond(m3.x + 3, m3.z - 3, 2.4);

    // 4つ目 → いちばん高い台地: 上下左右に動く足場
    const d0 = edge(m3, m4, 1.0), d1 = edge(m4, m3, 1.0);
    for (let i = 1; i <= 5; i++) {
      const t = i / 6;
      // 進む向きに対して左右へ少しずつずらす
      const dl = Math.hypot(d1[0] - d0[0], d1[1] - d0[1]);
      const side = (i % 2 ? -1.5 : 1.5) / dl;
      const x = d0[0] + (d1[0] - d0[0]) * t - (d1[1] - d0[1]) * side, z = d0[1] + (d1[1] - d0[1]) * t + (d1[0] - d0[0]) * side;
      const y = m3.h + (m4.h - m3.h) * t + 0.25;
      const move = i === 1 ? { az: 2.4, sp: 1.0 } : i === 3 ? { ay: 1.2, sp: 1.2 } : i === 5 ? { ax: 2.2, sp: 0.9 } : {};
      const bx = this.floatBlock(x, y, z, i === 3 ? 2.6 : 2.9, COLORS[(i + 1) % 5], move, i * 1.7);
      if (i % 2 === 0) this.balloon(bx, COLORS[i % 5]);
      if (i === 3) this.refills.push(new THREE.Vector3(x + 0.7, y + 1.0, z - 0.7));
      if (i % 2 === 0) this.shells.push(new THREE.Vector3(x, y + 1.0, z));
    }
    // 落ちたときに上の台地へ戻れる、ふもとの間欠泉
    for (const [m, power] of [[m2, 38.6], [m3, 43.8]] as const) {
      const d = Math.hypot(m.x, m.z);
      this.geyser(m.x - (m.x / d) * (m.r + 3.4), m.z - (m.z / d) * (m.r + 3.4), power, 4.6, m.h * 0.1);
    }
    // 頂上のほこら
    const tb = this.matte.setBase(M(m4.x, m4.h, m4.z));
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) tb.add(cyl(0.22, 0.26, 3.2, 8), STONE, M(sx * 2.2, 1.6, sz * 2.2));
    this.gloss.setBase(M(m4.x, m4.h, m4.z)).add(cone(3.9, 1.8, 4), TEAL, M(0, 4.1, 0, Math.PI / 4), { top: 0x35b5b0 });
    tb.add(cyl(1.7, 1.9, 0.4, 12), STONE, M(0, 0.2, 0));
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) this.colliders.addCyl(m4.x + sx * 2.2, m4.z + sz * 2.2, m4.h, m4.h + 3.2, 0.26);
    this.colliders.addCyl(m4.x, m4.z, m4.h, m4.h + 0.4, 1.9);

    // ふもとの飾り
    for (const [x, z] of [[14, 88], [-14, 88], [40, 60], [-30, 70]]) {
      const y = heightAt(x, z);
      this.matte.setBase(M(x, y, z)).add(cyl(0.05, 0.05, 3.4, 6), WOOD, M(0, 1.7, 0)).add(cone(0.34, 1.5, 8).rotateZ(-Math.PI / 2), COLORS[(x + 50) % 5 | 0], M(0.75, 3.2, 0));
      this.colliders.addCyl(x, z, y, y + 3.4, 0.08);
    }
    for (const [x, z] of [[22, 80], [-24, 52], [-60, 50], [-60, -20], [0, -70], [60, -40], [78, 20], [50, 50]]) this.shells.push(new THREE.Vector3(x, heightAt(x, z) + 0.9, z));

    this.guide(3.6, 91, 0, 94, 'フウ', [
      ['いちばん高い台地の ほこらに ヒカリ石があるよ', 'まずは階段で村へ。そこから吊り橋と気球を わたっていくんだ', '落ちても だいじょうぶ。ふもとから またのぼれるよ'],
      ['上の村が スミだらけに なっちゃった…', '村の噴水で 水を補給できるよ', 'ぜんぶ洗い流すと ヒカリ石が出てくるはず'],
      ['ヒトデが 台地のあちこちに 8つ あるよ', '気球の上や 高い台地にも かくれてる', 'ふもとの草原も さがしてみて'],
    ][episode], 0x6fa85a, 0xe8483f);

    this.finishStatic();
    this.scatter({
      radius: 104, palms: 26, bushes: 120, grass: 13000, flowers: 1400, shoreRocks: 24, seed: 63,
      avoid: (x, z) => Math.hypot(x, z - 91) < 5,
      palmH: [1.6, 4], grassFrom: 1.2,
      hills: MESAS.map((m) => ({ x: m.x, z: m.z, r0: m.r + 3, r1: m.r + 12, count: 5 })),
    });

    if (this.mission.kind === 'clean') scatterGoop(this.goop, m0.x, m0.z, 91);
    this.finalizeGoop([[m0.x, m0.z, 4.4]]);
    if (this.mission.kind === 'clean') this.pickEnemySpots(4, m0.x, m0.z, 5, 15, 3);
    else {
      this.enemyLeash = { x: m1.x, z: m1.z, r: 14 };
      for (const [dx, dz] of [[4, -4], [-5, 5], [6, 6]]) this.enemySpawns.push({ pos: new THREE.Vector3(m1.x + dx, m1.h, m1.z + dz) });
    }
    if (this.mission.kind === 'collect') {
      const on = (m: { x: number; z: number; h: number }, dx: number, dz: number) => this.starfish.push(new THREE.Vector3(m.x + dx, m.h + 0.6, m.z + dz));
      this.starfish.push(new THREE.Vector3(60, heightAt(60, -40) + 0.6, -40), new THREE.Vector3(-64, heightAt(-64, 50) + 0.6, 50));
      this.starfish.push(this.roofs[1].clone().add(new THREE.Vector3(1, 0.6, 1)));
      on(m1, 6, -6);
      on(m2, -5, -4);
      this.starfish.push(new THREE.Vector3(gx, (m2.h + m3.h) / 2 + 1.6, gz)); // ゴンドラの通り道の空中
      on(m3, -4, 5);
      on(m4, 0, 0);
    }
    const gemAt = [new THREE.Vector3(m4.x, m4.h + 2.1, m4.z), new THREE.Vector3(m0.x, m0.h + 4.9, m0.z), new THREE.Vector3(m0.x, m0.h + 1.7, m0.z + 9)];
    this.placeGem(gemAt[episode]);
  }
}

export const STAGE_INFO: Record<Exclude<AreaKey, 'town'>, { name: string; blurb: string; missions: MissionDef[]; terrain: TerrainDef; create: (episode: number) => Area }> = {
  volcano: { name: 'ゆけむり山', blurb: '湯けむりの立つ温泉火山', missions: VOLCANO_MISSIONS, terrain: VOLCANO_TERRAIN, create: (e) => new Volcano(e) },
  lagoon: { name: 'サンゴ入り江', blurb: '難破船のねむる環礁', missions: LAGOON_MISSIONS, terrain: LAGOON_TERRAIN, create: (e) => new Lagoon(e) },
  plateau: { name: 'そよかぜ台地', blurb: '吊り橋と気球の空の村', missions: PLATEAU_MISSIONS, terrain: PLATEAU_TERRAIN, create: (e) => new Plateau(e) },
};
