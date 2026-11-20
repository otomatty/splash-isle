import * as THREE from 'three';

type Point = [number, number, number];

// 店の帆布、住宅の鎧戸、工房の建具に使う外壁・差し色・屋根の組み合わせ。
const COLORS = [
  [[0xeeb798, 0x447f76, 0xac6a56], [0xf0d299, 0x537e99, 0xb98767], [0xf3d3ab, 0xb35f56, 0x9d725b]],
  [[0xf5ddb5, 0x739270, 0xc59377], [0xe7b5ad, 0x677f91, 0xba846d], [0xc2ddcc, 0xa26c4e, 0xa87c65]],
  [[0xe6bf96, 0x476f80, 0x8a9386], [0xc4d6c1, 0x496d60, 0x8c9b94], [0xedcbb1, 0x9f6457, 0x998f7b]],
];
const LIMESTONE = 0xf8e9c8, OAK = 0x966c4d, GLASS = 0x43666b, SHADE = 0x3a5050;

function coloredGeometry() {
  const position: number[] = [], colors: number[] = [], index: number[] = [];
  const pigments = new Map<number, THREE.Color>();
  let ox = 0, oz = 0, cs = 1, sn = 0;

  // 同じ平面上の頂点を共有する。枠、建具、反射は壁向きの面に焼き込み、部品ごとの描画を避ける。
  function face(points: Point[], color: number, lowerShade = 1): void {
    let rgb = pigments.get(color);
    if (!rgb) { rgb = new THREE.Color(color); pigments.set(color, rgb); }
    const first = position.length / 3;
    for (let i = 0; i < points.length; i++) {
      const [x, y, z] = points[i];
      position.push(ox + cs * x + sn * z, y, oz - sn * x + cs * z);
      const k = i < 2 ? lowerShade : 1;
      colors.push(rgb.r * k, rgb.g * k, rgb.b * k);
      if (i > 1) index.push(first, first + i - 1, first + i);
    }
  }

  function rect(cx: number, cy: number, z: number, w: number, h: number, color: number, lowerShade = 1): void {
    const x = cx - w / 2, y = cy - h / 2;
    face([[x, y, z], [x + w, y, z], [x + w, y + h, z], [x, y + h, z]], color, lowerShade);
  }

  // 外壁・出窓の庇・笠木には奥行きを付ける。底面は舗装や壁の内側に隠れる。
  function ledge(cx: number, y: number, cz: number, w: number, h: number, d: number, color: number): void {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, top = y + h;
    face([[x0,y,z1],[x1,y,z1],[x1,top,z1],[x0,top,z1]], color, 0.83);
    face([[x1,y,z0],[x0,y,z0],[x0,top,z0],[x1,top,z0]], color, 0.83);
    face([[x0,y,z0],[x0,y,z1],[x0,top,z1],[x0,top,z0]], color, 0.83);
    face([[x1,y,z1],[x1,y,z0],[x1,top,z0],[x1,top,z1]], color, 0.83);
    face([[x0,top,z1],[x1,top,z1],[x1,top,z0],[x0,top,z0]], color);
  }

  // 各壁面の正面をローカル+Zとする。街路の小物を作る時は初期の座標系のまま。
  function wallSide(dir: number): void {
    cs = [1, 0, -1, 0][dir];
    sn = [0, 1, 0, -1][dir];
    ox = sn * 4;
    oz = cs * 3;
  }

  function build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
  return { face, rect, ledge, wallSide, build };
}

/** 間口8m・奥行6mの街区用住戸。+Zが表通り、屋上床は階数×2.8+0.30m。 */
export function buildBlockFacade(style: number, floors: 2 | 3, family: number): THREE.BufferGeometry {
  const [wall, paint, tile] = COLORS[style][family];
  const roof = floors * 2.8 + 0.30;
  const { face, rect, ledge, wallSide, build } = coloredGeometry();

  function arch(x: number, y: number, z: number, w: number, h: number, color: number): void {
    const r = w / 2, spring = y + h - r;
    const points: Point[] = [[x-r, y, z], [x+r, y, z]];
    for (let i = 0; i <= 6; i++) {
      const angle = i * Math.PI / 6;
      points.push([x + r * Math.cos(angle), spring + r * Math.sin(angle), z]);
    }
    face(points, color, 0.77);
  }

  function window(x: number, y: number, w: number, h: number, shutters = false): void {
    rect(x, y, 0.018, w + 0.18, h + 0.18, LIMESTONE);
    rect(x, y, 0.037, w, h, GLASS, 0.52);
    rect(x, y, 0.050, 0.07, h, LIMESTONE);
    rect(x, y + h * 0.12, 0.052, w, 0.065, LIMESTONE);
    if (shutters) {
      for (const s of [-1, 1]) {
        const sx = x + s * (w / 2 + 0.29);
        rect(sx, y, 0.032, 0.36, h + 0.07, paint, 0.82);
        for (const slat of [-0.20, 0.15]) rect(sx, y + h * slat, 0.048, 0.30, 0.05, SHADE);
      }
    }
  }

  ledge(0, -0.35, 0, 8, roof - 0.05, 6, wall);
  ledge(0, -0.20, 0, 8.02, 0.61, 6.04, style === 2 ? 0xba9d80 : 0xd0b398);
  ledge(0, roof - 0.43, 0, 8.06, 0.23, 6.12, LIMESTONE);
  ledge(0, roof - 0.20, 0, 8.12, 0.20, 6.16, tile);

  // 上からも建物を区別できるよう、縁を残して屋上の瓦・目地・採光窓を描く。
  function roofPatch(x: number, z: number, w: number, d: number, dy: number, color: number): void {
    face([[x-w/2,roof+dy,z+d/2],[x+w/2,roof+dy,z+d/2],[x+w/2,roof+dy,z-d/2],[x-w/2,roof+dy,z-d/2]], color);
  }
  roofPatch(0, 0, 7.63, 5.66, 0.009, style === 2 ? 0xb7b7a3 : 0xd2b496);
  if (style === 2) {
    for (let i = -3; i <= 3; i++) roofPatch(i, 0, 0.047, 5.62, 0.016, tile);
    roofPatch(1.25, -0.85, 2.4, 1.15, 0.022, LIMESTONE);
    for (const x of [0.55, 1.25, 1.95]) roofPatch(x, -0.85, 0.61, 0.89, 0.028, GLASS);
  } else {
    roofPatch(-1.95, -1.30, 1.88, 1.35, 0.017, tile);
    roofPatch(-1.95, -1.30, 1.58, 1.07, 0.026, style === 0 ? 0x718681 : OAK);
    if (style === 1) {
      for (const z of [-1.8, -0.9, 0, 0.9, 1.8]) roofPatch(1.35, z, 3.55, 0.045, 0.017, tile);
    }
  }

  for (let dir = 0; dir < 4; dir++) {
    wallSide(dir);
    const front = dir === 0, back = dir === 2;
    const halfWidth = front || back ? 4 : 3;
    // 雨どいは樋から路地に下ろす。角を回り込んでも階の高さを読み取れる帯を入れる。
    if (back || dir === 1) {
      rect(halfWidth - 0.27, roof / 2 - 0.27, 0.026, 0.13, roof - 0.46, paint, 0.73);
      for (let floor = 0; floor < floors; floor++) {
        rect(halfWidth - 0.27, 0.77 + floor * 2.8, 0.043, 0.19, 0.07, OAK);
      }
    }
    if (style !== 2) {
      rect(0, 2.81, 0.035, halfWidth * 2, 0.13, LIMESTONE);
    }
    if (front && style !== 1) {
      // 袖看板の両面に印を入れ、路地から平行に歩いても店の入口を見つけやすくする。
      const x = style === 0 ? 3.53 : -3.53;
      ledge(x, 2.91, 0.38, 0.09, 0.075, 0.76, SHADE);
      ledge(x, 2.37, 0.50, 0.12, 0.54, 0.46, paint);
      const emblem: [number, number][] = style === 0
        ? [[0.50,2.80],[0.63,2.68],[0.58,2.49],[0.42,2.49],[0.37,2.68]]
        : [[0.56,2.80],[0.64,2.73],[0.46,2.49],[0.38,2.55]];
      for (const side of [-1, 1]) {
        const points = emblem.map(([z, y]): Point => [x + side * 0.069, y, z]);
        face(side === 1 ? points : points.reverse(), LIMESTONE);
      }
    }
    if (front && style === 0) {
      // 商店。幅の異なる陳列窓と入口を、垂れのついた縞の帆布でつなぐ。
      window(-1.40, 1.36, 3.45, 1.36);
      rect(2.06, 1.07, 0.030, 1.46, 2.14, paint);
      rect(2.06, 1.55, 0.049, 1.13, 0.85, GLASS);
      ledge(-1.40, 0.58, 0.095, 3.83, 0.11, 0.20, OAK);
      // ガラスの内側の島産品。果実瓶、巻いた反物、素焼きの壺が通りに色を作る。
      const goods = [0xd58a43, 0xbb7374, 0x8ab4a2];
      for (let i = 0; i < 5; i++) {
        const x = -2.68 + i * 0.59, y = 0.83 + (i % 2) * 0.11;
        const color = goods[(i + family) % 3];
        if (family === 1) {
          rect(x, y, 0.058, 0.48, 0.22, color);
          rect(x + 0.10, y, 0.065, 0.08, 0.22, LIMESTONE);
        } else {
          face([[x-0.13,y-0.12,0.059],[x+0.13,y-0.12,0.059],[x+0.18,y+0.13,0.059],
            [x+0.08,y+0.22,0.059],[x-0.08,y+0.22,0.059],[x-0.18,y+0.13,0.059]], color);
          rect(x, y + 0.25, 0.059, 0.14, 0.06, OAK);
        }
      }
      rect(2.54, 1.07, 0.065, 0.08, 0.16, LIMESTONE);
      for (let i = 0; i < 9; i++) {
        const x = -3.57 + i * 0.79, x1 = x + 0.79;
        const stripe = i % 2 === 0 ? paint : LIMESTONE;
        face([[x,2.36,0.40],[x1,2.36,0.40],[x1,2.76,0.008],[x,2.76,0.008]], stripe);
        face([[x,2.16,0.40],[x+0.39,2.10,0.40],[x1,2.16,0.40],[x1,2.36,0.40],[x,2.36,0.40]], stripe);
      }
    } else if (front && style === 1) {
      // 住宅。半円の欄間、観音開きの戸、左右に鎧戸のある窓。
      arch(0, 0, 0.025, 1.92, 2.67, LIMESTONE);
      arch(0, 0, 0.048, 1.55, 2.45, paint);
      arch(0, 1.65, 0.060, 1.25, 0.65, GLASS);
      rect(0, 0.82, 0.062, 0.055, 1.64, OAK);
      for (const x of [-0.37, 0.37]) {
        rect(x, 0.66, 0.058, 0.48, 0.87, OAK, 0.72);
        rect(x, 0.68, 0.073, 0.36, 0.70, paint);
      }
      ledge(0, 0.015, 0.09, 2.12, 0.075, 0.21, LIMESTONE);
      for (const x of [-2.58, 2.58]) window(x, 1.49, 1.03, 1.24, true);
    } else if (front) {
      // 工房。荷を扱う引き違い戸の上に連窓、隣に職人用の小さな戸。
      rect(-1.25, 1.08, 0.03, 4.40, 2.16, OAK);
      for (const x of [-2.31, -0.20]) {
        rect(x, 1.05, 0.049, 1.97, 1.94, paint, 0.72);
        face([[x-0.90,0.19,0.059],[x-0.71,0.19,0.059],[x+0.90,1.44,0.059],[x+0.71,1.44,0.059]], OAK);
        rect(x, 0.24, 0.065, 1.90, 0.10, OAK);
      }
      for (const x of [-2.60, -1.25, 0.10]) rect(x, 1.76, 0.062, 1.13, 0.40, GLASS);
      ledge(-1.25, 2.20, 0.14, 4.76, 0.15, 0.40, OAK);
      rect(2.56, 1.10, 0.028, 1.31, 2.20, paint);
      rect(2.56, 1.57, 0.048, 0.84, 0.76, GLASS);
      rect(2.99, 0.99, 0.065, 0.07, 0.16, LIMESTONE);
      // 日の当たる工房の破風に煉瓦の通気孔を並べる。
      for (let i = -3; i <= 3; i++) rect(i * 0.82, roof - 0.63, 0.028, 0.49, 0.16, OAK);
    } else if (back) {
      rect(-2.36, 1.00, 0.025, 1.15, 2.0, paint, 0.76);
      rect(-2.36, 1.47, 0.043, 0.73, 0.58, GLASS);
      window(1.35, 1.45, 1.78, 1.04);
    } else {
      window(-0.75, 1.50, style === 2 ? 2.40 : 1.39, style === 2 ? 0.89 : 1.20);
    }

    for (let floor = 1; floor < floors; floor++) {
      const y = 2.8 * floor + 1.4;
      if (!front) {
        for (const side of [-1, 1]) window(side * (back ? 2.0 : 1.42), y, 0.99, 1.19);
      } else if (style === 0) {
        for (const x of [-2.68, 0, 2.68]) {
          window(x, y, 1.16, 1.31, family !== 1);
          if (family === 1) ledge(x, y + 0.76, 0.085, 1.60, 0.12, 0.22, paint);
        }
      } else if (style === 1) {
        for (const x of [-2.18, 0, 2.18]) window(x, y, 1.30, x === 0 ? 1.61 : 1.34);
        // 張り出しを小さくした手すり付きの出窓。街路側から見上げた時にも縁を残す。
        ledge(0, y - 0.90, 0.13, 5.94, 0.14, 0.51, tile);
        ledge(0, y - 0.24, 0.33, 5.80, 0.09, 0.10, paint);
        for (const x of [-2.80, -1.88, -0.94, 0, 0.94, 1.88, 2.80]) rect(x, y - 0.54, 0.33, 0.075, 0.64, paint);
        const x = (floor + family) % 2 ? -1.95 : 1.95;
        rect(x, y - 0.36, 0.37, 1.24, 0.29, tile, 0.72);
        face([[x-0.49,y-0.23,0.374],[x+0.45,y-0.23,0.374],[x+0.61,y-0.04,0.374],
          [x+0.15,y+0.07,0.374],[x-0.62,y-0.07,0.374]], 0x5e845d);

      } else {
        for (const x of [-2.55, -0.85, 0.85, 2.55]) window(x, y, 1.27, 1.03);
        face([[-3.58,y+0.68,0.31],[3.58,y+0.68,0.31],[3.58,y+0.84,0.008],[-3.58,y+0.84,0.008]], paint);
        rect(0, y + 0.63, 0.31, 7.16, 0.10, paint);
      }
    }
  }

  return build();
}

/** 戸口の脇に置く品台。中央の床を原点、通りの側を+Zとする。 */
export function buildDoorstepSet(style: number, family: number): THREE.BufferGeometry {
  const { face, rect, ledge, build } = coloredGeometry();
  const [, paint, tile] = COLORS[style][family];
  const wood = 0xaa7950, darkWood = 0x715241, leaf = 0x638651;

  // 底を抜いた少面数の回転体。上面の色で鉢の土、釉薬を塗った口縁を表現する。
  function pot(x: number, z: number, profile: [number, number][], color: number, topColor: number, sides = 6): void {
    const rings = profile.map(([y, r]) => Array.from({ length: sides }, (_, i): Point => {
      const a = i / sides * Math.PI * 2;
      return [x + r * Math.sin(a), y, z + r * Math.cos(a)];
    }));
    for (let k = 1; k < rings.length; k++) {
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        face([rings[k-1][i], rings[k-1][j], rings[k][j], rings[k][i]], color, 0.78);
      }
    }
    face(rings[rings.length - 1], topColor);
  }

  function canopy(x: number, y: number, z: number, rx: number, ry: number, rz: number, color: number): void {
    const rim: Point[] = [[x,y,z+rz],[x+rx,y,z],[x,y,z-rz],[x-rx,y,z]];
    for (let i = 0; i < rim.length; i++) {
      const next = rim[(i + 1) % rim.length];
      face([rim[i], next, [x,y+ry,z]], color);
      face([next, rim[i], [x,y-ry,z]], color, 0.85);
    }
  }

  function counter(): void {
    for (const x of [-0.57, 0.57]) ledge(x, 0, 0, 0.15, 0.45, 0.50, darkWood);
    ledge(0, 0.43, 0, 1.70, 0.10, 0.64, wood);
  }

  if (style === 0 && family === 0) {
    // 平箱には色づく順に詰めた果物。木札に値を示す白いチョーク跡が残る。
    ledge(0, 0, 0, 1.58, 0.45, 0.60, wood);
    for (const x of [-0.63, 0.63]) rect(x, 0.22, 0.312, 0.14, 0.42, darkWood);
    for (const y of [0.14, 0.32]) rect(0, y, 0.311, 1.21, 0.035, darkWood);
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 3; i++) {
        canopy(-0.54 + i * 0.35 + row * 0.10, 0.53, -0.13 + row * 0.26, 0.18, 0.14, 0.15,
          [0xe2ae49, 0xd88540, 0xc96a4f][(i + row) % 3]);
      }
    }
    ledge(0.60, 0.43, 0.04, 0.08, 0.44, 0.07, darkWood);
    ledge(0.60, 0.76, 0.04, 0.48, 0.29, 0.04, SHADE);
    rect(0.57, 0.93, 0.074, 0.27, 0.035, LIMESTONE);
    rect(0.62, 0.85, 0.074, 0.16, 0.035, LIMESTONE);
  } else if (style === 0 && family === 1) {
    // 反物の木口が店先を向く。生成りの紙帯を正面の布端まで渡す。
    counter();
    for (const [x, y, dye] of [[-0.44,0.69,0x537b9f], [0,0.69,0xc78363], [0.44,0.69,0x679284], [-0.22,0.96,0xae6878]]) {
      const ring = Array.from({ length: 6 }, (_, i) => [x + 0.19 * Math.cos(i * Math.PI / 3), y + 0.18 * Math.sin(i * Math.PI / 3)]);
      for (let i = 0; i < 6; i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[(i + 1) % 6];
        face([[ax,ay,0.23],[ax,ay,-0.25],[bx,by,-0.25],[bx,by,0.23]], dye);
      }
      face(ring.map(([px, py]): Point => [px, py, 0.23]), dye);
      face([[x-0.048,y-0.033,0.24],[x+0.048,y-0.033,0.24],[x,y+0.045,0.24]], LIMESTONE);
    }
  } else if (style === 0 || (style === 2 && family === 1)) {
    ledge(0, 0, 0, 1.69, 0.29, 0.59, style === 0 ? paint : darkWood);
    const glazed = style === 0;
    pot(-0.45, 0, [[0.29,0.15],[0.62,0.28],[0.87,0.14],[0.98,0.15]], glazed ? 0x578c8b : 0xc78563, SHADE);
    pot(0.32, 0.03, [[0.29,0.13],[0.49,0.27],[0.62,0.30]], glazed ? 0xd2a45e : 0xc99575, glazed ? 0x927650 : 0xa67357);
    rect(-0.38, 0.15, 0.31, 0.51, 0.085, LIMESTONE);
  } else if (style === 1 && family === 0) {
    // 海風の通る板張りの長椅子。座面と背板の間から向こうの土間が見える。
    for (const side of [-1, 1]) {
      ledge(side * 0.63, 0, 0.01, 0.13, 0.40, 0.47, darkWood);
      ledge(side * 0.63, 0.38, -0.21, 0.10, 0.58, 0.10, darkWood);
    }
    for (const z of [-0.16, 0, 0.16]) ledge(0, 0.37, z, 1.70, 0.09, 0.135, wood);
    for (const y of [0.64, 0.83]) ledge(0, y, -0.22, 1.68, 0.12, 0.075, paint);
  } else if (style === 1 && family === 1) {
    // 玄関で育てる島みかん。枝先の小ぶりな実が葉の前からのぞく。
    pot(-0.17, 0, [[0,0.18],[0.37,0.28]], tile, darkWood);
    ledge(-0.17, 0.35, 0, 0.095, 0.45, 0.095, darkWood);
    canopy(-0.17,0.87,0,0.40,0.25,0.29,leaf);
    canopy(-0.39,0.80,0.09,0.21,0.18,0.20,0x789657);
    canopy(0.06,0.78,0.14,0.16,0.16,0.17,0x759b5d);
    for (const [x, y] of [[-0.42,0.78],[-0.09,0.90],[0.08,0.75]]) canopy(x,y,0.24,0.067,0.07,0.067,0xe8a438);
    pot(0.57, 0, [[0,0.12],[0.25,0.18]], 0xb9795d, darkWood);
    canopy(0.57,0.32,0,0.18,0.21,0.16,0x66865a);
  } else if (style === 1) {
    // 腰壁の代わりに置いた長い香草鉢。背の違う三株と挿し札を並べる。
    ledge(0, 0, 0, 1.63, 0.34, 0.52, tile);
    ledge(0, 0.32, 0, 1.72, 0.095, 0.59, 0xcd9b79);
    face([[-0.77,0.42,0.22],[0.77,0.42,0.22],[0.77,0.42,-0.22],[-0.77,0.42,-0.22]], darkWood);
    for (const [x, h, col] of [[-0.51,0.34,0x71964e],[-0.02,0.49,0x4f845a],[0.48,0.29,0x94aa62]]) {
      canopy(x,0.46+h*0.45,0,0.26,h*0.58,0.23,col);
      canopy(x+0.10,0.47+h*0.24,0.13,0.12,0.12,0.12,col);
    }
    ledge(0.69, 0.37, 0.17, 0.04, 0.33, 0.05, wood);
    rect(0.65, 0.69, 0.20, 0.22, 0.12, LIMESTONE);
  } else if (family === 0) {
    // 工具の引き出しと万力のある作業台。工具掛けは板に形を描き込む。
    counter();
    ledge(-0.37, 0.18, 0.03, 0.65, 0.23, 0.48, paint);
    rect(-0.37, 0.31, 0.285, 0.18, 0.045, LIMESTONE);
    ledge(0.43, 0.52, 0.03, 0.45, 0.16, 0.34, SHADE);
    for (const x of [0.27, 0.58]) ledge(x, 0.64, 0.03, 0.10, 0.14, 0.38, 0x8b9991);
    ledge(-0.25, 0.52, -0.23, 0.98, 0.57, 0.095, wood);
    rect(-0.40, 0.81, -0.17, 0.07, 0.36, darkWood);
    rect(-0.40, 0.98, -0.17, 0.28, 0.09, SHADE);
    face([[-0.13,0.67,-0.17],[0.01,0.67,-0.17],[0.09,0.96,-0.17],[-0.04,0.91,-0.17]], 0xc1c5b7);
  } else {
    // 建具屋の材木。短い桟木を間に挟み、角材の小口が見えるように積む。
    for (const x of [-0.57, 0.57]) ledge(x, 0, 0, 0.16, 0.13, 0.66, darkWood);
    for (const y of [0.13, 0.32, 0.51]) {
      for (const side of [-1, 1]) ledge(side * 0.034, y, side * 0.16, 1.60, 0.15, 0.25, y === 0.32 ? 0xb68150 : 0xce9e69);
    }
    for (const x of [-0.45, 0.45]) {
      rect(x, 0.39, 0.294, 0.09, 0.54, paint);
      face([[x-0.045,0.664,0.285],[x+0.045,0.664,0.285],[x+0.045,0.664,-0.285],[x-0.045,0.664,-0.285]], paint);
    }
  }
  return build();
}
