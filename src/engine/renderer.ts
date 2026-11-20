import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Water } from '../world/water';

export type Tier = 'low' | 'medium' | 'high';
export type QualityMode = 'auto' | Tier;

interface TierConfig {
  maxPixelRatio: number;
  msaa: number;
  bloom: boolean;
  shadowSize: number;
  shadowRadius: number;
  reflection: number; // 反射バッファの解像度倍率（0 で無効）
  anisotropy: number;
}

const TIERS: Record<Tier, TierConfig> = {
  low: { maxPixelRatio: 1, msaa: 2, bloom: false, shadowSize: 1024, shadowRadius: 1.5, reflection: 0, anisotropy: 2 },
  medium: { maxPixelRatio: 1.5, msaa: 4, bloom: true, shadowSize: 2048, shadowRadius: 2.5, reflection: 0, anisotropy: 4 },
  high: { maxPixelRatio: 2, msaa: 4, bloom: true, shadowSize: 4096, shadowRadius: 3.5, reflection: 0.5, anisotropy: 8 },
};

/**
 * 内部解像度の下限。ゲームキューブ（640×480 = 約30万画素）の3倍にあたる
 * 1280×720 相当（約92万画素）を、どんなに重い場面でも下回らない。
 */
export const MIN_PIXELS = 1280 * 720;

export interface GfxStats {
  fps: number;
  width: number;
  height: number;
  tier: Tier;
  mode: QualityMode;
}

export class Gfx {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.25, 4000);
  readonly sun = new THREE.DirectionalLight(0xffffff, 1);
  private composer!: EffectComposer;
  private bloom: UnrealBloomPass | null = null;
  private water: Water | null = null;
  mode: QualityMode = 'auto';
  tier: Tier = 'high';
  private pixelRatio = 0;
  private warmup = 3;
  private cssW = 1;
  private cssH = 1;
  // 動的解像度の計測用
  private accT = 0;
  private accN = 0;
  private fps = 60;
  private slowCount = 0;
  private upWait = 3;
  private upTimer = 0;
  private lastRaise = false;
  private readonly sizeV = new THREE.Vector2();
  readonly gpuName: string;
  /** 品質段階が変わったときの通知（飾りの表示切り替えなど） */
  onTierChange: (() => void) | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // AA は MSAA 付きレンダーターゲット側で行う
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false;

    const gl = r.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpuName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown';

    // 太陽光と影
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    const sc = this.sun.shadow.camera;
    sc.near = 1;
    sc.far = 260;
    this.scene.add(this.sun, this.sun.target);

    this.tier = this.guessTier();
    this.applyTier(this.tier);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  /** GPU 名から初期の品質を推定（その後は実測フレームレートで調整） */
  private guessTier(): Tier {
    const n = this.gpuName.toLowerCase();
    if (/swiftshader|llvmpipe|software|basic render/.test(n)) return 'low';
    if (/mali|adreno|powervr|videocore/.test(n)) return 'medium';
    if (/intel/.test(n) && !/arc/.test(n)) return 'medium';
    if (/apple/.test(n) && /iphone|ipad/i.test(navigator.userAgent)) return 'medium';
    return 'high';
  }

  attachWater(w: Water): void {
    this.water = w;
    this.updateReflection();
  }

  setMode(mode: QualityMode): void {
    this.mode = mode;
    const t = mode === 'auto' ? this.guessTier() : mode;
    this.slowCount = 0;
    this.upWait = 3;
    this.pixelRatio = 0;
    this.applyTier(t);
    this.resize();
  }

  private applyTier(tier: Tier): void {
    this.tier = tier;
    const cfg = TIERS[tier];
    const r = this.renderer;
    // 影
    const sh = this.sun.shadow;
    if (sh.mapSize.x !== cfg.shadowSize) {
      sh.mapSize.set(cfg.shadowSize, cfg.shadowSize);
      sh.map?.dispose();
      sh.map = null;
    }
    sh.radius = cfg.shadowRadius;
    const ext = tier === 'low' ? 46 : 62;
    const sc = sh.camera;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
    sc.updateProjectionMatrix();
    // ポストプロセス
    this.composer?.dispose();
    const size = r.getDrawingBufferSize(this.sizeV);
    const rt = new THREE.WebGLRenderTarget(Math.max(size.x, 2), Math.max(size.y, 2), {
      type: THREE.HalfFloatType,
      samples: cfg.msaa,
    });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = null;
    if (cfg.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), tier === 'high' ? 0.32 : 0.26, 0.55, 1.0);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this.updateReflection();
    this.onTierChange?.();
  }

  private updateReflection(): void {
    if (!this.water) return;
    const cfg = TIERS[this.tier];
    const size = this.renderer.getDrawingBufferSize(this.sizeV);
    this.water.setReflection(cfg.reflection > 0, size.x * cfg.reflection, size.y * cfg.reflection);
  }

  get anisotropy(): number {
    return Math.min(TIERS[this.tier].anisotropy, this.renderer.capabilities.getMaxAnisotropy());
  }

  private pixelRatioBounds(): [number, number] {
    const cfg = TIERS[this.tier];
    const dpr = window.devicePixelRatio || 1;
    const area = Math.max(this.cssW * this.cssH, 1);
    const minPR = Math.sqrt(MIN_PIXELS / area);
    const maxPR = Math.max(Math.min(dpr, cfg.maxPixelRatio), minPR);
    return [minPR, maxPR];
  }

  resize(): void {
    const parent = this.canvas.parentElement;
    this.cssW = Math.max(parent?.clientWidth ?? window.innerWidth, 16);
    this.cssH = Math.max(parent?.clientHeight ?? window.innerHeight, 16);
    const [minPR, maxPR] = this.pixelRatioBounds();
    // 自動のときは現在値を保ち、固定品質のときは常に上限で描く
    if (this.mode !== 'auto' || this.pixelRatio === 0) this.pixelRatio = maxPR;
    else this.pixelRatio = Math.min(Math.max(this.pixelRatio, minPR), maxPR);
    this.applySize();
  }

  private applySize(): void {
    const r = this.renderer;
    r.setPixelRatio(this.pixelRatio);
    r.setSize(this.cssW, this.cssH, false);
    const size = r.getDrawingBufferSize(this.sizeV);
    this.composer.setPixelRatio(1);
    this.composer.setSize(size.x, size.y);
    this.camera.aspect = this.cssW / this.cssH;
    // 縦長画面では視野を広げて見やすく
    this.camera.fov = this.camera.aspect < 1 ? 70 : 55;
    this.camera.updateProjectionMatrix();
    this.updateReflection();
  }

  /** 影のカメラを注視点に追従させる（テクセル単位に丸めてチラつきを防ぐ） */
  followShadow(target: THREE.Vector3, sunDir: THREE.Vector3): void {
    const sh = this.sun.shadow;
    const texel = (sh.camera.right * 2) / sh.mapSize.x;
    const right = _r.set(0, 1, 0).cross(sunDir).normalize();
    const up = _u.copy(sunDir).cross(right);
    const dx = Math.round(target.dot(right) / texel) * texel;
    const dy = Math.round(target.dot(up) / texel) * texel;
    const dz = target.dot(sunDir);
    const p = _v.set(0, 0, 0).addScaledVector(right, dx).addScaledVector(up, dy).addScaledVector(sunDir, dz);
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).addScaledVector(sunDir, 130);
    this.sun.target.updateMatrixWorld();
  }

  /** 1フレーム描画。rawDt は実時間の経過秒（動的解像度の計測に使う） */
  render(rawDt: number, measure: boolean): void {
    if (measure && rawDt > 0 && rawDt < 0.25) {
      this.accT += rawDt;
      this.accN++;
      if (this.accT >= 1) {
        this.fps = this.accN / this.accT;
        this.accT = 0;
        this.accN = 0;
        // 起動直後はシェーダーのコンパイルで一時的に重いので数秒は判定しない
        if (this.warmup > 0) this.warmup--;
        else if (this.mode === 'auto') this.adapt();
      }
    }
    this.renderer.info.reset();
    if (this.water) this.water.renderReflection(this.renderer, this.scene, this.camera);
    this.composer.render(rawDt);
  }

  /** 実測 FPS に合わせて内部解像度（と必要なら品質段階）を上下させる */
  private adapt(): void {
    const [minPR, maxPR] = this.pixelRatioBounds();
    const fps = this.fps;
    if (fps < 50) {
      if (this.lastRaise) this.upWait = Math.min(this.upWait * 2, 60); // 上げた直後に重くなった → 次はもっと慎重に
      this.lastRaise = false;
      this.upTimer = 0;
      if (this.pixelRatio > minPR + 0.01) {
        this.pixelRatio = Math.max(minPR, this.pixelRatio * (fps < 35 ? 0.78 : 0.9));
        this.applySize();
        this.slowCount = 0;
      } else if (fps < 42 && ++this.slowCount >= 3) {
        // 解像度の下限でも重い → 影やブルームを軽くする
        this.slowCount = 0;
        if (this.tier === 'high') { this.applyTier('medium'); this.resize(); }
        else if (this.tier === 'medium') { this.applyTier('low'); this.resize(); }
      }
    } else if (fps >= 57) {
      this.slowCount = 0;
      this.upTimer += 1;
      if (this.upTimer >= this.upWait && this.pixelRatio < maxPR - 0.01) {
        this.pixelRatio = Math.min(maxPR, this.pixelRatio * 1.1);
        this.applySize();
        this.upTimer = 0;
        this.lastRaise = true;
      } else if (this.upTimer >= this.upWait) {
        this.lastRaise = false;
      }
    } else {
      this.lastRaise = false;
    }
  }

  get stats(): GfxStats {
    const s = this.renderer.getDrawingBufferSize(this.sizeV);
    return { fps: this.fps, width: s.x, height: s.y, tier: this.tier, mode: this.mode };
  }
}

const _v = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
