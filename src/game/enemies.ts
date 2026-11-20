import * as THREE from 'three';
import { GeoBatch, M, cone, sph } from '../world/props';
import { angleDelta, damp } from '../engine/noise';
import { heightAt } from '../world/terrain';
import type { Area } from '../world/area';
import type { Player } from './player';
import { P_INK, P_SPARK, type Particles } from './particles';

interface Enemy {
  group: THREE.Group;
  body: THREE.Mesh;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  homeX: number; homeZ: number;
  hp: number;
  /** 体の大きさの倍率と体力の倍率（大きいスミボウ用） */
  size: number;
  tough: number;
  hop: number;
  yaw: number;
  squash: number;
  squashV: number;
  flash: number;
  grounded: boolean;
  alive: boolean;
}

/**
 * スミから生まれた敵「スミボウ」。ぴょんぴょん跳ねて近づいてくる。
 * 水をかけ続けるとしぼんで消える。上から踏んでもダメージを与えられる。
 */
export class Enemies {
  readonly root = new THREE.Group();
  readonly list: Enemy[] = [];
  private readonly bodyGeo: THREE.BufferGeometry;
  private readonly eyeGeo: THREE.BufferGeometry;
  private readonly bodyMat = new THREE.MeshStandardMaterial({ color: 0x2c0f42, roughness: 0.12, metalness: 0.1, emissive: 0x3a0f5a, emissiveIntensity: 0.25 });
  private readonly eyeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3 });
  onDefeat: ((remaining: number, x: number, y: number, z: number) => void) | null = null;
  onHit: (() => void) | null = null;
  onHop: ((x: number, z: number) => void) | null = null;

  constructor(private readonly level: Area, private readonly particles: Particles) {
    // しずく型の体
    const g = new THREE.SphereGeometry(0.55, 20, 14);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const t = (y + 0.55) / 1.1;
      const bulge = 1 + 0.22 * (1 - t) * (1 - t) - 0.25 * t * t;
      const drip = y < -0.35 ? 1 + 0.12 * Math.sin(Math.atan2(p.getZ(i), p.getX(i)) * 7) : 1;
      p.setXYZ(i, p.getX(i) * bulge * drip, y * 0.86 + (t > 0.8 ? (t - 0.8) * 0.9 : 0), p.getZ(i) * bulge * drip);
    }
    g.computeVertexNormals();
    g.translate(0, 0.47, 0);
    this.bodyGeo = g;
    const eb = new GeoBatch();
    for (const s of [-1, 1]) {
      eb.add(sph(0.14, 10, 8), 0xffffff, M(s * 0.2, 0.55, 0.42, 0, 1, 1.15, 0.7));
      eb.add(sph(0.07, 8, 6), 0x1a0a26, M(s * 0.19, 0.53, 0.5, 0, 1, 1.1, 0.6));
      eb.add(cone(0.05, 0.22, 4).rotateZ(s * 1.1), 0x1a0a26, M(s * 0.2, 0.74, 0.47)); // 怒った眉
    }
    this.eyeGeo = eb.build();
  }

  /** 敵を初期位置に出す */
  spawnAll(): void {
    this.clear();
    for (const { pos: s, big } of this.level.enemySpawns) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(this.bodyGeo, this.bodyMat.clone());
      body.castShadow = true;
      const eyes = new THREE.Mesh(this.eyeGeo, this.eyeMat);
      group.add(body, eyes);
      group.position.set(s.x, s.y, s.z);
      this.root.add(group);
      this.list.push({
        group, body, x: s.x, y: s.y, z: s.z, vx: 0, vy: 0, vz: 0, homeX: s.x, homeZ: s.z,
        hp: 1, size: big ? 2.6 : 1, tough: big ? 7 : 1, hop: 0.5 + Math.random(), yaw: Math.random() * 6.28, squash: 1, squashV: 0, flash: 0, grounded: true, alive: true,
      });
    }
  }

  dispose(): void {
    this.clear();
    this.bodyGeo.dispose();
    this.eyeGeo.dispose();
    this.bodyMat.dispose();
    this.eyeMat.dispose();
  }

  clear(): void {
    for (const e of this.list) {
      this.root.remove(e.group);
      (e.body.material as THREE.Material).dispose();
    }
    this.list.length = 0;
  }

  get alive(): number {
    let n = 0;
    for (const e of this.list) if (e.alive) n++;
    return n;
  }

  /** 噴射した水の粒が敵に当たったか */
  hitTest(x: number, y: number, z: number): boolean {
    for (const e of this.list) {
      if (!e.alive) continue;
      const s = (0.55 + 0.45 * e.hp) * e.size;
      const dx = x - e.x, dy = y - (e.y + 0.5 * s), dz = z - e.z;
      const r = 0.7 * s;
      if (dx * dx + dy * dy + dz * dz < r * r) {
        this.damage(e, 0.042, dx, dz);
        return true;
      }
    }
    return false;
  }

  private damage(e: Enemy, amount: number, kx: number, kz: number): void {
    e.hp -= amount / e.tough;
    e.flash = 0.12;
    const kl = Math.hypot(kx, kz) || 1;
    e.vx -= (kx / kl) * 0.9;
    e.vz -= (kz / kl) * 0.9;
    this.onHit?.();
    if (e.hp <= 0) {
      e.alive = false;
      e.group.visible = false;
      this.particles.burst(P_INK, e.x, e.y + 0.5, e.z, 26, 4.5, 5, 0.7, 0.2);
      this.particles.burst(P_SPARK, e.x, e.y + 0.6, e.z, 18, 3.5, 4, 0.8, 0.26);
      this.onDefeat?.(this.alive, e.x, e.y, e.z);
    }
  }

  update(dt: number, t: number, player: Player, active: boolean): void {
    const pb = player.body;
    const cols = this.level.colliders;
    for (const e of this.list) {
      if (!e.alive) continue;
      const dxp = pb.x - e.x, dzp = pb.z - e.z;
      const dist = Math.hypot(dxp, dzp);
      const s = (0.55 + 0.45 * e.hp) * e.size;
      const leash = this.level.enemyLeash;

      // ── 行動: 跳ねる前にためて、プレイヤーか巣のほうへ跳ぶ ──
      e.hop -= dt;
      if (e.grounded && e.hop <= 0 && active) {
        const chase = dist < 15 + e.size * 2 && Math.hypot(e.x - leash.x, e.z - leash.z) < leash.r;
        let tx: number, tz: number, speed: number;
        if (chase) { tx = dxp / (dist || 1); tz = dzp / (dist || 1); speed = 3.6; }
        else {
          const hx = e.homeX - e.x, hz = e.homeZ - e.z;
          const hd = Math.hypot(hx, hz);
          if (hd > 3.5) { tx = hx / hd; tz = hz / hd; }
          else { const a = Math.random() * 6.28; tx = Math.cos(a); tz = Math.sin(a); }
          speed = 1.6;
        }
        e.vx = tx * speed;
        e.vz = tz * speed;
        e.vy = chase ? 6.6 : 5;
        e.grounded = false;
        e.hop = (chase ? 0.75 : 1.4) + Math.random() * 0.5;
        e.squashV = 6;
        e.yaw += angleDelta(e.yaw, Math.atan2(tx, tz));
        if (dist < 22) this.onHop?.(e.x, e.z);
      }

      // ── 物理 ──
      if (!e.grounded) {
        e.vy -= 24 * dt;
        const nx = e.x + e.vx * dt, nz = e.z + e.vz * dt;
        // 建物・崖・深い水には入らない
        const hn = heightAt(nx, nz);
        if (cols.pointInside(nx, e.y + 0.45, nz, 0.45) || hn < -0.4 || hn > e.y + 1.2) {
          e.vx *= -0.4;
          e.vz *= -0.4;
        } else {
          e.x = nx;
          e.z = nz;
        }
        e.y += e.vy * dt;
        const h = Math.max(heightAt(e.x, e.z), 0);
        if (e.y <= h && e.vy <= 0) {
          e.y = h;
          e.vy = 0;
          e.vx = e.vz = 0;
          e.grounded = true;
          e.squashV = -7;
          this.particles.burst(P_INK, e.x, e.y + 0.05, e.z, 4, 1.8, 1.4, 0.35, 0.13);
        }
      } else {
        e.y = Math.max(heightAt(e.x, e.z), 0);
        // 着地中はプレイヤーのほうを向く
        if (dist < 15) e.yaw += angleDelta(e.yaw, Math.atan2(dxp, dzp)) * Math.min(1, 5 * dt);
      }

      // ── プレイヤーとの接触 ──
      if (active) {
        const dy = pb.y - e.y;
        const reach = 0.5 * s + pb.radius;
        if (dist < reach + 0.15 && dy > 0.45 * s && dy < 1.3 * s && pb.vy < -1.5) {
          // 上から踏んだ
          pb.vy = 9.5;
          this.damage(e, 0.5, -dxp, -dzp);
          this.particles.burst(P_INK, e.x, e.y + 0.8, e.z, 10, 3, 2.5, 0.4, 0.15);
        } else if (dist < reach && dy > -1.1 && dy < 0.9 * s) {
          player.hurt(e.x, e.z);
        }
      }

      // ── 見た目 ──
      e.squashV += ((1 - e.squash) * 180 - e.squashV * 9) * dt;
      e.squash += e.squashV * dt;
      const sq = Math.min(1.5, Math.max(0.55, e.squash)) * (1 + Math.sin(t * 5 + e.homeX) * 0.04);
      const inv = 1 / Math.sqrt(sq);
      e.group.position.set(e.x, e.y, e.z);
      e.group.rotation.y = e.yaw;
      e.group.scale.set(s * inv, s * sq, s * inv);
      e.flash = Math.max(0, e.flash - dt);
      const mat = e.body.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = damp(mat.emissiveIntensity, e.flash > 0 ? 3.5 : 0.25, 30, dt);
      mat.emissive.setHex(e.flash > 0 ? 0x9fdcff : 0x3a0f5a);
    }
  }
}
