import * as THREE from 'three';
import { SKY_HORIZON, SKY_ZENITH, SUN_COLOR, SUN_DIR } from './sky';

/**
 * 海。地形の高さテクスチャから水深を求め、浅瀬の透明感・波打ち際の泡・
 * フレネル反射・太陽のきらめきを1パスで描く。高品質設定では平面反射も加える。
 */
export class Water {
  readonly mesh: THREE.Mesh;
  readonly uniforms: Record<string, THREE.IUniform>;
  private reflRT: THREE.WebGLRenderTarget | null = null;
  private readonly mirrorCam = new THREE.PerspectiveCamera();
  private readonly texMatrix = new THREE.Matrix4();
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly rot = new THREE.Matrix4();
  private readonly plane = new THREE.Plane();
  private readonly clip = new THREE.Vector4();
  private readonly q = new THREE.Vector4();
  /** 反射に映したくないオブジェクト（水しぶきなど） */
  readonly hideInReflection: THREE.Object3D[] = [];
  private readonly wasVisible: boolean[] = [];

  constructor(noiseTex: THREE.Texture, heightTex: THREE.Texture, heightUV: THREE.Vector3) {
    this.uniforms = {
      uTime: { value: 0 },
      tNoise: { value: noiseTex },
      tHeight: { value: heightTex },
      tRefl: { value: null },
      uReflOn: { value: 0 },
      uReflMatrix: { value: this.texMatrix },
      uSun: { value: SUN_DIR },
      uSunColor: { value: SUN_COLOR },
      uZenith: { value: SKY_ZENITH },
      uHorizon: { value: SKY_HORIZON },
      uHMap: { value: heightUV },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tNoise, tHeight, tRefl;
        uniform float uTime, uReflOn;
        uniform mat4 uReflMatrix;
        uniform vec3 uSun, uSunColor, uZenith, uHorizon, uHMap;
        varying vec3 vW;

        void main() {
          vec2 p = vW.xz;
          vec3 toCam = cameraPosition - vW;
          float dist = length(toCam);
          vec3 V = toCam / dist;

          // 水深（地形の高さから）
          vec2 huv = (p + uHMap.x) * uHMap.y + uHMap.z;
          float th = texture2D(tHeight, clamp(huv, 0.0, 1.0)).r;
          float depth = max(-th, 0.0);

          // さざ波の法線（3層のスクロールノイズ）
          vec2 a = texture2D(tNoise, p * 0.031 + uTime * vec2(0.011, 0.006)).rg;
          vec2 b = texture2D(tNoise, p * 0.083 - uTime * vec2(0.014, -0.010)).ba;
          vec2 c = texture2D(tNoise, p * 0.29 + uTime * vec2(-0.021, 0.026)).gb;
          vec2 dn = (a + b - 1.0) * 0.6 + (c - 0.5) * 0.35;
          float calm = smoothstep(30.0, 500.0, dist);
          float nstr = mix(0.42, 0.10, calm);
          vec3 N = normalize(vec3(dn.x * nstr, 1.0, dn.y * nstr));

          float ndv = max(dot(N, V), 0.0);
          float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
          vec3 R = reflect(-V, N);
          R.y = abs(R.y);

          // 反射: 空の色、または平面反射テクスチャ
          vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.5));
          vec3 refl = sky;
          if (uReflOn > 0.5) {
            vec4 rc = uReflMatrix * vec4(vW, 1.0);
            vec2 ruv = rc.xy / rc.w + N.xz * 0.045 * clamp(60.0 / dist, 0.15, 1.0);
            refl = texture2D(tRefl, clamp(ruv, 0.002, 0.998)).rgb;
          }
          float sdot = max(dot(R, uSun), 0.0);
          float spec = pow(sdot, 900.0) * 22.0 + pow(sdot, 220.0) * 0.3;
          // 遠くの海面のきらめき
          float glint = pow(texture2D(tNoise, p * 0.9 + uTime * 0.05).r, 10.0) * pow(sdot, 26.0) * 16.0;

          // 水の色（浅瀬のエメラルド → 沖の群青）
          vec3 shallow = vec3(0.10, 0.82, 0.72);
          vec3 mid = vec3(0.02, 0.50, 0.70);
          vec3 deep = vec3(0.01, 0.17, 0.46);
          float d1 = 1.0 - exp(-depth * 0.42);
          float d2 = 1.0 - exp(-depth * 0.13);
          vec3 body = mix(mix(shallow, mid, d1), deep, d2);
          body *= 0.80 + 0.30 * (dn.x + dn.y + 0.5);

          vec3 col = mix(body, refl, fres) + uSunColor * (spec + glint);

          // 波打ち際の泡（寄せては返す）
          float sw = sin(uTime * 0.9 + (a.x + b.y) * 5.0) * 0.5 + 0.5;
          float shore = depth - sw * 0.16;
          float fn = texture2D(tNoise, p * 0.45 + vec2(uTime * 0.03, 0.0)).r;
          float fn2 = texture2D(tNoise, p * 1.3 - vec2(0.0, uTime * 0.04)).g;
          float foam = smoothstep(0.42, 0.02, shore) * smoothstep(0.30, 0.62, fn * 0.6 + fn2 * 0.4 + (0.4 - shore) * 0.5);
          float band = smoothstep(0.10, 0.0, abs(shore - 0.85 - sw * 0.35)) * smoothstep(0.45, 0.7, fn) * 0.55;
          float fo = clamp(foam + band, 0.0, 1.0);
          col = mix(col, vec3(1.0, 1.0, 0.98), fo * 0.92);

          float alpha = mix(0.30, 0.97, 1.0 - exp(-depth * 0.85));
          alpha = max(max(alpha, fres), fo);

          // 遠景は水平線の色へ溶かす
          float fog = 1.0 - exp(-dist * dist * 0.00000045);
          col = mix(col, uHorizon * 1.02, fog);
          alpha = mix(alpha, 1.0, fog);

          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const geo = new THREE.PlaneGeometry(8000, 8000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 5;
    this.mesh.name = 'water';
    this.mesh.frustumCulled = false;
  }

  /** 平面反射の有効／無効と解像度を切り替える */
  setReflection(enabled: boolean, width = 0, height = 0): void {
    if (!enabled) {
      this.reflRT?.dispose();
      this.reflRT = null;
      this.uniforms.tRefl.value = null;
      this.uniforms.uReflOn.value = 0;
      return;
    }
    const w = Math.max(64, Math.floor(width)), h = Math.max(64, Math.floor(height));
    if (this.reflRT) {
      if (this.reflRT.width !== w || this.reflRT.height !== h) this.reflRT.setSize(w, h);
    } else {
      this.reflRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true });
      this.reflRT.texture.minFilter = this.reflRT.texture.magFilter = THREE.LinearFilter;
    }
    this.uniforms.tRefl.value = this.reflRT.texture;
    this.uniforms.uReflOn.value = 1;
  }

  /** 海面で鏡映したカメラからシーンを描く（three.js の Reflector と同じ斜めクリップ方式） */
  renderReflection(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    if (!this.reflRT) return;
    const cam = this.mirrorCam;
    const camPos = this.tmpA.setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y < 0.05) return;
    this.rot.extractRotation(camera.matrixWorld);
    const look = this.tmpB.set(0, 0, -1).applyMatrix4(this.rot).add(camPos);
    look.y = -look.y;
    cam.position.set(camPos.x, -camPos.y, camPos.z);
    cam.up.set(0, 1, 0).applyMatrix4(this.rot);
    cam.up.y = -cam.up.y;
    cam.lookAt(look);
    cam.near = camera.near;
    cam.far = camera.far;
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    cam.projectionMatrix.copy(camera.projectionMatrix);
    cam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);

    this.texMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.texMatrix.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);

    // 海面より下を切り落とす斜めニアクリップ
    this.plane.set(this.tmpB.set(0, 1, 0), 0).applyMatrix4(cam.matrixWorldInverse);
    const clip = this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const pe = cam.projectionMatrix.elements;
    const q = this.q;
    q.x = (Math.sign(clip.x) + pe[8]) / pe[0];
    q.y = (Math.sign(clip.y) + pe[9]) / pe[5];
    q.z = -1;
    q.w = (1 + pe[10]) / pe[14];
    clip.multiplyScalar(2 / clip.dot(q));
    pe[2] = clip.x;
    pe[6] = clip.y;
    pe[10] = clip.z + 1 - 0.003;
    pe[14] = clip.w;

    this.mesh.visible = false;
    const hidden = this.hideInReflection;
    for (let i = 0; i < hidden.length; i++) {
      this.wasVisible[i] = hidden[i].visible;
      hidden[i].visible = false;
    }
    const prevRT = renderer.getRenderTarget();
    const prevAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.reflRT);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prevRT);
    renderer.shadowMap.autoUpdate = prevAuto;
    this.mesh.visible = true;
    for (let i = 0; i < hidden.length; i++) hidden[i].visible = this.wasVisible[i];
  }
}
