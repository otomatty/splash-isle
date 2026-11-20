import * as THREE from 'three';
import { angleDelta, clamp, damp } from '../engine/noise';
import { heightAt, normalAt } from '../world/terrain';
import { resolveBody, type Body, type Box } from '../world/colliders';
import type { Area } from '../world/area';
import { P_DUST, P_INK, P_JET, P_MIST, P_SPLASH, P_SPRAY, type Particles } from './particles';
import { animateBird, buildBird, type Bird } from './bird';

export interface StepInput {
  mx: number;
  my: number;
  jump: boolean;
  jumpPressed: boolean;
  spray: boolean;
  hover: boolean;
}

/** 手触りを決める数値。ここを変えるだけで操作感を調整できる */
const TUNE = {
  runSpeed: 7.4,
  sprayWalkSpeed: 4.8,
  hoverSpeed: 4.0,
  swimSpeed: 4.4,
  groundAccel: 62,
  airAccel: 26,
  swimAccel: 20,
  groundFriction: 55,
  airFriction: 5,
  swimFriction: 10,
  jumpSpeed: 10.9,
  gravityUp: 30,
  gravityCut: 66, // ジャンプボタンを離したときの上昇打ち切り
  gravityDown: 39,
  maxFall: 32,
  coyote: 0.11,
  jumpBuffer: 0.13,
  hoverTime: 1.9,
  hoverRise: 0.75,
  tankMax: 100,
  sprayCost: 5.2,
  hoverCost: 9,
  refill: 48,
  swimY: -0.62,
};

export type PlayerEvent = 'jump' | 'land' | 'splash' | 'hurt' | 'hoverStart' | 'empty' | 'step';

export class Player {
  readonly body: Body = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, radius: 0.36, height: 1.25, prevY: 0 };
  readonly bird: Bird;
  readonly group: THREE.Group;
  yaw = Math.PI;
  private visYaw = Math.PI;
  grounded = true;
  swimming = false;
  hovering = false;
  spraying = false;
  inGoop = false;
  steep = false;
  tank = TUNE.tankMax;
  readonly tankMax = TUNE.tankMax;
  hp = 6;
  readonly maxHp = 6;
  invuln = 0;
  /** 操作を受け付けない時間（演出中など） */
  frozen = false;
  private platform: Box | null = null;
  private coyote = 0;
  private jumpBuf = 0;
  private jumpReleased = true;
  private jumpLaunched = false;
  private hoverT = 0;
  private sprayAcc = 0;
  private jetAcc = 0;
  private stepAcc = 0;
  private wasInWater = false;
  private emptyNotified = false;
  private fallSpeed = 0;
  private readonly n = new THREE.Vector3();
  /** 噴射口の向き（カメラの上下に連動） */
  aimPitch = 0.1;
  onEvent: ((e: PlayerEvent, strength: number) => void) | null = null;

  /** いまいるエリア（エリアを移動するときに差し替える） */
  level: Area;

  constructor(level: Area, private readonly particles: Particles) {
    this.level = level;
    this.bird = buildBird({ body: 0x27344f, belly: 0xfdf8ec, hat: 0xd8322e, scarf: 0xf6c443, pack: true });
    this.group = this.bird.root;
    this.teleport(level.spawn.x, level.spawn.y, level.spawn.z, level.spawnYaw);
  }

  setDetail(enabled: boolean): void {
    const pump = this.bird.pumpDetail;
    if (pump) pump.geometry.setDrawRange(0, enabled ? Infinity : pump.plainCount);
  }

  teleport(x: number, y: number, z: number, yaw: number): void {
    const b = this.body;
    b.x = x; b.y = y; b.z = z; b.prevY = y;
    b.vx = b.vy = b.vz = 0;
    this.yaw = this.visYaw = yaw;
    this.platform = null;
    this.grounded = true;
    this.hoverT = 0;
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
  }

  get hoverLeft(): number {
    return 1 - this.hoverT / TUNE.hoverTime;
  }

  get speed(): number {
    return Math.hypot(this.body.vx, this.body.vz);
  }

  /** 物理の1ステップ（固定の短い時間刻みで呼ばれる） */
  step(dt: number, inp: StepInput, camYaw: number): void {
    const b = this.body;
    const P = this.particles;
    const wasGrounded = this.grounded;
    if (this.invuln > 0) this.invuln -= dt;

    // 動く足場に乗っていれば一緒に運ばれる
    if (this.platform && wasGrounded) {
      b.x += this.platform.dx;
      b.z += this.platform.dz;
      b.y += this.platform.dy;
    }

    // カメラ基準の入力方向
    const sinY = Math.sin(camYaw), cosY = Math.cos(camYaw);
    let wx = 0, wz = 0;
    if (!this.frozen) {
      wx = cosY * inp.mx + sinY * inp.my;
      wz = -sinY * inp.mx + cosY * inp.my;
    }
    const wl = Math.hypot(wx, wz);

    const th = heightAt(b.x, b.z);
    const deepWater = th < TUNE.swimY - 0.13;
    // 離水ジャンプが水面を抜けるまでは、浮力で上向きの速度を打ち消さない。
    const jumpingOut = this.jumpLaunched && b.vy > 0;
    this.swimming = deepWater && b.y <= TUNE.swimY + 0.14 && !this.platform && !jumpingOut;
    const onLand = wasGrounded && !this.swimming;
    this.inGoop = onLand && !this.platform && b.y - th < 0.1 && this.level.goop.at(b.x, b.z);

    // ── 水平移動 ──
    const wantSpray = inp.spray && !this.frozen;
    let maxSpeed = this.swimming ? TUNE.swimSpeed : this.hovering ? TUNE.hoverSpeed : wantSpray && onLand ? TUNE.sprayWalkSpeed : TUNE.runSpeed;
    if (this.inGoop) maxSpeed *= 0.5;
    const accel = this.swimming ? TUNE.swimAccel : onLand ? (this.inGoop ? 16 : TUNE.groundAccel) : TUNE.airAccel;
    if (wl > 0.01) {
      const tx = wx * maxSpeed, tz = wz * maxSpeed;
      const dx = tx - b.vx, dz = tz - b.vz;
      const dl = Math.hypot(dx, dz);
      const stepV = accel * dt;
      if (dl <= stepV) { b.vx = tx; b.vz = tz; }
      else { b.vx += (dx / dl) * stepV; b.vz += (dz / dl) * stepV; }
    } else {
      const fr = (this.swimming ? TUNE.swimFriction : onLand ? (this.inGoop ? 6 : TUNE.groundFriction) : TUNE.airFriction) * dt;
      const sp = Math.hypot(b.vx, b.vz);
      if (sp <= fr) { b.vx = 0; b.vz = 0; }
      else { b.vx -= (b.vx / sp) * fr; b.vz -= (b.vz / sp) * fr; }
    }

    // ── 向き ──
    if (wantSpray) this.yaw += angleDelta(this.yaw, Math.atan2(-sinY, -cosY)) * Math.min(1, 16 * dt);
    else if (wl > 0.05) this.yaw += angleDelta(this.yaw, Math.atan2(wx, wz)) * Math.min(1, (onLand ? 14 : 8) * dt);

    // ── ジャンプ ──
    this.jumpBuf = inp.jumpPressed && !this.frozen ? TUNE.jumpBuffer : this.jumpBuf - dt;
    this.coyote = onLand || this.swimming ? TUNE.coyote : this.coyote - dt;
    if (!inp.jump) this.jumpReleased = true;
    if (this.jumpBuf > 0 && this.coyote > 0 && !this.steep) {
      b.vy = this.swimming ? 8.4 : this.inGoop ? 7.4 : TUNE.jumpSpeed;
      if (this.platform && this.platform.dy > 0) b.vy += this.platform.dy / dt;
      this.jumpBuf = 0;
      this.coyote = 0;
      this.grounded = false;
      this.platform = null;
      this.jumpReleased = false;
      this.jumpLaunched = true;
      this.bird.squashV = 5.5;
      this.onEvent?.('jump', this.swimming ? 0.6 : 1);
      if (this.swimming) P.burst(P_SPLASH, b.x, 0.05, b.z, 12, 2.5, 4, 0.5, 0.12);
      else P.burst(this.inGoop ? P_INK : P_DUST, b.x, b.y + 0.05, b.z, 5, 1.6, 0.6, 0.45, 0.16);
      this.swimming = false;
    }
    const airborne = !this.grounded && !this.swimming;

    // ── ホバー（空中でジャンプ長押し、または専用ボタン）──
    const wantHover = !this.frozen && (inp.hover || (inp.jump && this.jumpReleased)) && airborne;
    const wasHover = this.hovering;
    this.hovering = wantHover && this.tank > 0 && this.hoverT < TUNE.hoverTime;
    if (this.hovering) {
      if (!wasHover) this.onEvent?.('hoverStart', 1);
      this.hoverT += dt;
      this.tank = Math.max(0, this.tank - TUNE.hoverCost * dt);
      // 残り時間が少なくなると推力が落ちる
      const fade = clamp((TUNE.hoverTime - this.hoverT) / 0.35, 0, 1);
      b.vy = damp(b.vy, TUNE.hoverRise * fade - (1 - fade) * 3, 11, dt);
      this.jetAcc += dt * 95;
      const bx = -Math.sin(this.yaw) * 0.4, bz = -Math.cos(this.yaw) * 0.4;
      const rx = Math.cos(this.yaw) * 0.2, rz = -Math.sin(this.yaw) * 0.2;
      while (this.jetAcc >= 1) {
        this.jetAcc -= 1;
        const s = Math.random() < 0.5 ? -1 : 1;
        P.spawn(P_JET, b.x + bx + rx * s, b.y + 0.3, b.z + bz + rz * s, b.vx * 0.3 + (Math.random() - 0.5) * 1.6, -9 - Math.random() * 3, b.vz * 0.3 + (Math.random() - 0.5) * 1.6, 0.6, 0.15 + Math.random() * 0.07);
      }
    } else if (!this.swimming) {
      const g = b.vy > 0 ? (inp.jump || !this.jumpLaunched ? TUNE.gravityUp : TUNE.gravityCut) : TUNE.gravityDown;
      b.vy = Math.max(b.vy - g * dt, -TUNE.maxFall);
    }
    if (wantHover && !this.hovering && this.tank <= 0 && !this.emptyNotified) {
      this.emptyNotified = true;
      this.onEvent?.('empty', 1);
    }

    // ── 泳ぎ（水面に浮く）──
    if (this.swimming) {
      b.vy += ((TUNE.swimY - b.y) * 34 - b.vy * 7) * dt;
    } else if (deepWater && b.y < -0.2 && b.vy < 0) {
      b.vy *= Math.max(0, 1 - 6 * dt); // 水に落ちたときの減速
      if (b.y < TUNE.swimY - 0.9) b.vy += 30 * dt;
    }

    // ── 積分と当たり判定 ──
    if (!this.grounded) this.fallSpeed = -b.vy;
    b.prevY = b.y;
    // 切り立った崖は壁として扱う（地形の高さへ吸い上げられて登れてしまうのを防ぐ）
    const nx = b.x + b.vx * dt, nz = b.z + b.vz * dt;
    if (heightAt(nx, nz) > b.y + 0.35 && normalAt(nx, nz, this.n).y < 0.56) {
      const hl = Math.hypot(this.n.x, this.n.z) || 1;
      const wx2 = this.n.x / hl, wz2 = this.n.z / hl;
      const into = b.vx * wx2 + b.vz * wz2;
      if (into < 0) { b.vx -= into * wx2; b.vz -= into * wz2; }
      if (heightAt(b.x + b.vx * dt, b.z + b.vz * dt) > b.y + 0.35) { b.vx = 0; b.vz = 0; }
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.z += b.vz * dt;
    const c = resolveBody(this.level.colliders, b, wasGrounded);
    this.level.confinePlayer(b);
    this.grounded = c.grounded;
    this.platform = c.platform;

    // 急斜面はすべり落ちる
    this.steep = false;
    if (c.grounded && c.onTerrain) {
      normalAt(b.x, b.z, this.n);
      if (this.n.y < 0.62) {
        this.steep = true;
        b.vx += this.n.x * 34 * dt;
        b.vz += this.n.z * 34 * dt;
      }
    }

    if (this.grounded || this.swimming) {
      this.hoverT = 0;
      this.jumpLaunched = false;
    }
    if (this.grounded && !wasGrounded) {
      const impact = clamp(this.fallSpeed / 20, 0.15, 1);
      this.bird.squashV = -4 - impact * 6;
      this.onEvent?.('land', impact);
      if (b.y > 0.05) P.burst(this.level.goop.at(b.x, b.z) && c.onTerrain ? P_INK : P_DUST, b.x, b.y + 0.05, b.z, 4 + Math.floor(impact * 8), 2.4, 0.5, 0.5, 0.2);
      this.fallSpeed = 0;
    }

    // ── 水しぶき・足音・補給 ──
    const inWater = b.y < -0.25 && heightAt(b.x, b.z) < -0.25;
    if (inWater && !this.wasInWater) {
      const k = clamp(Math.abs(b.vy) / 12, 0.3, 1);
      P.burst(P_SPLASH, b.x, 0.08, b.z, Math.floor(10 + 26 * k), 3.5 * k + 1, 5.5 * k + 1.5, 0.7, 0.14);
      this.onEvent?.('splash', k);
    }
    this.wasInWater = inWater;
    let poolY = -1000;
    for (const p of this.level.pools) {
      if (b.y < p.y + 0.15 && b.y > p.y - 1.6 && Math.hypot(b.x - p.x, b.z - p.z) < p.r) { poolY = p.y; break; }
    }
    const inFountain = poolY > -999;
    if (inWater || inFountain) {
      this.tank = Math.min(TUNE.tankMax, this.tank + TUNE.refill * dt);
      this.emptyNotified = false;
    }
    const sp = Math.hypot(b.vx, b.vz);
    if ((this.grounded || this.swimming) && sp > 1) {
      this.stepAcc += sp * dt;
      if (this.stepAcc > (this.swimming ? 2.4 : 1.7)) {
        this.stepAcc = 0;
        this.onEvent?.('step', this.swimming || b.y < 0.05 || inFountain ? 2 : this.inGoop ? 3 : 1);
        if (this.swimming) P.burst(P_SPLASH, b.x, 0.06, b.z, 5, 1.6, 1.8, 0.4, 0.1);
        else if (b.y < 0.05 || inFountain) P.burst(P_SPLASH, b.x, inFountain ? poolY + 0.05 : 0.05, b.z, 4, 1.5, 2.2, 0.35, 0.09);
        else if (this.inGoop) P.burst(P_INK, b.x, b.y + 0.05, b.z, 3, 1.5, 1.6, 0.4, 0.13);
        else if (sp > 5.5 && c.onTerrain) P.burst(P_DUST, b.x, b.y + 0.05, b.z, 1, 0.5, 0.4, 0.5, 0.15);
      }
    }

    // ── 水の噴射 ──
    this.spraying = wantSpray && this.tank > 0;
    if (this.spraying) {
      this.tank = Math.max(0, this.tank - TUNE.sprayCost * dt);
      this.sprayAcc += dt * 150;
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const ox = b.x + fx * 0.5 + fz * 0.3, oz = b.z + fz * 0.5 - fx * 0.3, oy = b.y + 1.0;
      const ce = Math.cos(this.aimPitch), se = Math.sin(this.aimPitch);
      while (this.sprayAcc >= 1) {
        this.sprayAcc -= 1;
        const v = 14 + Math.random() * 1.6;
        const j = 0.085;
        const jx = (Math.random() - 0.5) * j, jy = (Math.random() - 0.5) * j, jz = (Math.random() - 0.5) * j;
        const lead = Math.random() * dt;
        const dx = fx * ce + jx, dy = se + jy, dz = fz * ce + jz;
        P.spawn(P_SPRAY, ox + dx * v * lead, oy + dy * v * lead, oz + dz * v * lead, dx * v + b.vx * 0.6, dy * v + Math.max(b.vy, 0) * 0.3, dz * v + b.vz * 0.6, 1.5, 0.26 + Math.random() * 0.2);
        if (Math.random() < 0.3) P.spawn(P_MIST, ox + dx * 0.4, oy + dy * 0.4, oz + dz * 0.4, dx * v * 0.8 + b.vx * 0.6, dy * v * 0.8, dz * v * 0.8 + b.vz * 0.6, 0.55, 0.7 + Math.random() * 0.5);
      }
    } else if (wantSpray && !this.emptyNotified) {
      this.emptyNotified = true;
      this.onEvent?.('empty', 1);
    }
  }

  /** 間欠泉などで真上へ打ち上げる */
  launch(vy: number): void {
    const b = this.body;
    b.vy = vy;
    this.grounded = false;
    this.platform = null;
    this.jumpLaunched = false;
    this.hoverT = 0;
    this.coyote = 0;
    this.bird.squashV = 7;
    this.onEvent?.('jump', 1.5);
  }

  /** 敵などからダメージを受ける。受けたら true */
  hurt(fromX: number, fromZ: number): boolean {
    if (this.invuln > 0 || this.frozen) return false;
    const b = this.body;
    this.hp = Math.max(0, this.hp - 1);
    this.invuln = 1.8;
    let dx = b.x - fromX, dz = b.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    b.vx = dx * 7.5;
    b.vz = dz * 7.5;
    b.vy = 7;
    this.grounded = false;
    this.platform = null;
    this.bird.squashV = -6;
    this.particles.burst(P_INK, b.x, b.y + 0.7, b.z, 10, 3, 3, 0.5, 0.16);
    this.onEvent?.('hurt', 1);
    return true;
  }

  /** 見た目の更新（1フレームに1回） */
  animate(dt: number, t: number, talkPose = false): void {
    const b = this.body;
    this.visYaw += angleDelta(this.visYaw, this.yaw) * Math.min(1, 22 * dt);
    this.group.position.set(b.x, b.y, b.z);
    this.group.rotation.y = this.visYaw;
    animateBird(this.bird, {
      speed: clamp(this.speed / TUNE.runSpeed, 0, 1),
      grounded: this.grounded,
      hover: this.hovering,
      swim: this.swimming,
      spray: this.spraying,
      vy: b.vy,
      talk: talkPose,
    }, dt, t);
    // ダメージ後の無敵時間は点滅
    this.group.visible = this.invuln <= 0 || Math.floor(t * 14) % 2 === 0;
  }
}
