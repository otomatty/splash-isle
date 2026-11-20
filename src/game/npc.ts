import * as THREE from 'three';
import { angleDelta } from '../engine/noise';
import { heightAt } from '../world/terrain';
import type { Area, NpcSpec } from '../world/area';
import { animateBird, buildBird, type Bird } from './bird';

interface Npc {
  spec: NpcSpec;
  bird: Bird;
  y: number;
  yaw: number;
  line: number;
  lineT: number;
  near: boolean;
  wet: number; // 水をかけられてびっくりしている残り時間
  vy: number;
  hopY: number;
}

export interface Speech {
  name: string;
  text: string;
  /** 吹き出しを出す位置（頭の上） */
  pos: THREE.Vector3;
}

/** 島の住人。近づくとこちらを向いて、ヒントを順番に話してくれる */
export class Npcs {
  readonly root = new THREE.Group();
  private readonly list: Npc[] = [];
  private readonly speech: Speech = { name: '', text: '', pos: new THREE.Vector3() };
  onTalk: (() => void) | null = null;
  onWet: (() => void) | null = null;

  constructor(level: Area) {
    for (const spec of level.npcs) {
      const bird = buildBird({ body: spec.body, belly: spec.belly, hat: spec.hat, scarf: spec.hat, pack: false });
      const y = level.colliders.surfaceBelow(spec.x, heightAt(spec.x, spec.z) + 3, spec.z);
      bird.root.position.set(spec.x, y, spec.z);
      bird.root.rotation.y = spec.yaw;
      bird.root.scale.setScalar(1.08);
      this.root.add(bird.root);
      this.list.push({ spec, bird, y, yaw: spec.yaw, line: 0, lineT: 0, near: false, wet: 0, vy: 0, hopY: 0 });
      level.colliders.addCyl(spec.x, spec.z, y, y + 1.3, 0.42);
    }
  }

  dispose(): void {
    this.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }

  /** 噴射した水が住人に当たったか */
  hitTest(x: number, y: number, z: number): boolean {
    for (const n of this.list) {
      const dx = x - n.spec.x, dz = z - n.spec.z;
      if (y > n.y && y < n.y + 1.5 && dx * dx + dz * dz < 0.3) {
        if (n.wet <= 0) {
          n.vy = 5.5;
          n.bird.squashV = 6;
          this.onWet?.();
        }
        n.wet = 2.2;
        return true;
      }
    }
    return false;
  }

  /** @returns 今しゃべっている住人のセリフ（いなければ null） */
  update(dt: number, t: number, px: number, py: number, pz: number): Speech | null {
    let talking: Npc | null = null;
    let best = 4.2;
    for (const n of this.list) {
      const dx = px - n.spec.x, dz = pz - n.spec.z;
      const d = Math.hypot(dx, dz);
      const near = d < 4.2 && Math.abs(py - n.y) < 2.5;
      if (near && d < best) { best = d; talking = n; }
      if (near && !n.near) { n.lineT = 0; this.onTalk?.(); }
      n.near = near;
      // 近くにいればプレイヤーのほうを向く
      const want = near || n.wet > 0 ? Math.atan2(dx, dz) : n.spec.yaw;
      n.yaw += angleDelta(n.yaw, want) * Math.min(1, 6 * dt);
      n.bird.root.rotation.y = n.yaw;
      // びっくりジャンプ
      if (n.hopY > 0 || n.vy > 0) {
        n.vy -= 22 * dt;
        n.hopY = Math.max(0, n.hopY + n.vy * dt);
        if (n.hopY === 0 && n.vy < 0) { n.vy = 0; n.bird.squashV = -5; }
      }
      n.wet = Math.max(0, n.wet - dt);
      n.bird.root.position.y = n.y + n.hopY;
      animateBird(n.bird, { speed: 0, grounded: n.hopY === 0, hover: false, swim: false, spray: false, vy: n.vy, talk: near }, dt, t + n.spec.x);
    }
    if (!talking) return null;
    const n = talking;
    n.lineT += dt;
    if (n.lineT > 4.2) {
      n.lineT = 0;
      n.line = (n.line + 1) % n.spec.lines.length;
      this.onTalk?.();
    }
    this.speech.name = n.spec.name;
    this.speech.text = n.wet > 0 ? 'ひゃっ！ つめたーい！' : n.spec.lines[n.line];
    this.speech.pos.set(n.spec.x, n.y + n.hopY + 1.75, n.spec.z);
    return this.speech;
  }
}
