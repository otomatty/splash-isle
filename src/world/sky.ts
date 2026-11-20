import * as THREE from 'three';

export const SUN_DIR = new THREE.Vector3(0.48, 0.74, 0.47).normalize();
export const SUN_COLOR = new THREE.Color(1.0, 0.95, 0.84);
export const SKY_ZENITH = new THREE.Color(0.075, 0.27, 0.78);
export const SKY_HORIZON = new THREE.Color(0.55, 0.78, 0.96);

/** エリアごとの空と太陽の設定を反映する（共有している色オブジェクトを書き換える） */
export function applySkyLook(look: { sun: [number, number, number]; sunColor: number; zenith: number; horizon: number }): void {
  SUN_DIR.set(look.sun[0], look.sun[1], look.sun[2]).normalize();
  SUN_COLOR.set(look.sunColor);
  SKY_ZENITH.set(look.zenith);
  SKY_HORIZON.set(look.horizon);
}

export interface Sky {
  mesh: THREE.Mesh;
  uniforms: { uTime: { value: number } };
}

/** グラデーションの空＋太陽＋流れる雲（すべてシェーダーで生成） */
export function createSky(noiseTex: THREE.Texture): Sky {
  const uniforms = {
    uTime: { value: 0 },
    tNoise: { value: noiseTex },
    uSun: { value: SUN_DIR },
    uSunColor: { value: SUN_COLOR },
    uZenith: { value: SKY_ZENITH },
    uHorizon: { value: SKY_HORIZON },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * viewMatrix * vec4(position * 1000.0 + cameraPosition, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tNoise;
      uniform float uTime;
      uniform vec3 uSun, uSunColor, uZenith, uHorizon;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.52));
        // 水平線付近のかすみ
        col = mix(col, uHorizon * 1.06, pow(1.0 - h, 14.0) * 0.6);
        float sd = max(dot(d, uSun), 0.0);
        col += uSunColor * (pow(sd, 6.0) * 0.10 + pow(sd, 48.0) * 0.25 + pow(sd, 400.0) * 0.8);
        col += uSunColor * smoothstep(0.99925, 0.99965, sd) * 40.0;
        if (d.y > 0.0) {
          // 2層の雲。真上ほど大きく、水平線へ向かって流れる
          vec2 cp = d.xz / (d.y + 0.16);
          float t = uTime * 0.0035;
          float n = texture2D(tNoise, cp * 0.085 + vec2(t, t * 0.4)).r * 0.58
                  + texture2D(tNoise, cp * 0.23 - vec2(t * 1.6, -t)).g * 0.30
                  + texture2D(tNoise, cp * 0.71 + vec2(t * 2.3, t)).b * 0.12;
          float cov = smoothstep(0.50, 0.68, n);
          // 太陽側へ少しずらしたサンプルで雲の厚みによる陰影を作る
          vec2 lo = uSun.xz * 0.06;
          float n2 = texture2D(tNoise, (cp + lo) * 0.085 + vec2(t, t * 0.4)).r * 0.58
                   + texture2D(tNoise, (cp + lo) * 0.23 - vec2(t * 1.6, -t)).g * 0.30;
          float lit = clamp((n - n2 * 1.136) * 4.0 + 0.55, 0.0, 1.0);
          vec3 cc = mix(vec3(0.62, 0.72, 0.90), vec3(1.25, 1.22, 1.16), lit);
          cc += uSunColor * pow(sd, 10.0) * 0.5;
          col = mix(col, cc, cov * smoothstep(0.0, 0.14, d.y) * 0.96);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'sky';
  return { mesh, uniforms };
}

/** 空からライティング用の環境マップ（IBL）を作る */
export function buildEnvironment(renderer: THREE.WebGLRenderer, sky: Sky): THREE.WebGLRenderTarget {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene();
  const clone = new THREE.Mesh(sky.mesh.geometry, sky.mesh.material);
  clone.frustumCulled = false;
  s.add(clone);
  // 地面からの照り返し（砂浜の暖色）
  const ground = new THREE.Mesh(
    new THREE.SphereGeometry(900, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.42, 0.40, 0.30), side: THREE.BackSide }),
  );
  s.add(ground);
  const rt = pmrem.fromScene(s, 0, 0.1, 2000);
  pmrem.dispose();
  ground.geometry.dispose();
  (ground.material as THREE.Material).dispose();
  return rt;
}
