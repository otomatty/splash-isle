import * as THREE from 'three';
import { angleDelta, clamp, damp } from '../engine/noise';
import { heightAt } from '../world/terrain';
import type { Colliders } from '../world/colliders';

/**
 * 三人称カメラ。プレイヤーの少し上を注視点にして周回し、
 * 地形や建物にめり込まないよう距離を自動で縮める。
 */
export class FollowCamera {
  yaw = 0;
  pitch = 0.32;
  distance = 7.6;
  private curDist = 7.6;
  private readonly target = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private idle = 0;
  private shake = 0;
  private init = false;

  constructor(private readonly camera: THREE.PerspectiveCamera, public colliders: Colliders) {}

  snap(x: number, y: number, z: number, yaw: number): void {
    this.yaw = yaw;
    this.pitch = 0.32;
    this.target.set(x, y + 1.25, z);
    this.curDist = this.distance;
    this.init = false;
  }

  addShake(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  /**
   * @param autoFollow 視点入力がないとき、進行方向の後ろへゆっくり回り込むか（パッド・タッチ向け）
   */
  update(dt: number, px: number, py: number, pz: number, vx: number, vz: number, lookX: number, lookY: number, zoom: number, autoFollow: boolean): void {
    this.yaw -= lookX;
    this.pitch = clamp(this.pitch + lookY, -0.55, 1.35);
    this.distance = clamp(this.distance + zoom * 0.7, 3.8, 13);

    if (Math.abs(lookX) + Math.abs(lookY) > 0.0005) this.idle = 0;
    else this.idle += dt;
    const sp = Math.hypot(vx, vz);
    if (autoFollow && this.idle > 1.1 && sp > 2.5) {
      const behind = Math.atan2(-vx, -vz);
      const d = angleDelta(this.yaw, behind);
      // 真後ろ付近や、手前へ走ってくるときは回さない（酔い防止）
      if (Math.abs(d) < 2.4) this.yaw += d * Math.min(1, 1.1 * dt);
    }

    // 注視点: 横はきびきび、縦は少し遅らせてジャンプで画面が揺れすぎないように
    // 水中や地面より下を注視しない（着水の瞬間にカメラが寄りすぎるのを防ぐ）
    const ty = Math.max(py + 1.25, Math.max(heightAt(px, pz), 0) + 0.9);
    if (!this.init) {
      this.target.set(px, ty, pz);
      this.init = true;
    }
    this.target.x = damp(this.target.x, px, 18, dt);
    this.target.z = damp(this.target.z, pz, 18, dt);
    this.target.y = damp(this.target.y, ty, Math.abs(ty - this.target.y) > 2.5 ? 14 : 7, dt);

    const cp = Math.cos(this.pitch), sp2 = Math.sin(this.pitch);
    const dx = Math.sin(this.yaw) * cp, dy = sp2, dz = Math.cos(this.yaw) * cp;

    // 障害物チェック: 注視点からカメラ位置へ向かって刻み、最初に埋まる手前で止める
    let allowed = this.distance;
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      const d = (this.distance * i) / steps;
      const x = this.target.x + dx * d, y = this.target.y + dy * d, z = this.target.z + dz * d;
      const floor = Math.max(heightAt(x, z), 0) + 0.35;
      if (y < floor || this.colliders.pointInside(x, y, z, 0.25)) {
        allowed = Math.max(1.4, (this.distance * (i - 1)) / steps);
        break;
      }
    }
    // 近づくのは素早く、離れるのはゆっくり
    this.curDist = damp(this.curDist, allowed, allowed < this.curDist ? 30 : 4, dt);
    this.pos.set(this.target.x + dx * this.curDist, this.target.y + dy * this.curDist, this.target.z + dz * this.curDist);
    const minY = Math.max(heightAt(this.pos.x, this.pos.z), 0) + 0.3;
    if (this.pos.y < minY) this.pos.y = minY;

    this.camera.position.copy(this.pos);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-9 * dt);
    }
    this.camera.lookAt(this.target);
  }

  /** 演出用: 指定の点のまわりをゆっくり回る */
  orbit(cx: number, cy: number, cz: number, radius: number, height: number, angle: number): void {
    this.camera.position.set(cx + Math.sin(angle) * radius, cy + height, cz + Math.cos(angle) * radius);
    this.target.set(cx, cy, cz);
    this.camera.lookAt(cx, cy, cz);
    this.init = true;
  }
}
