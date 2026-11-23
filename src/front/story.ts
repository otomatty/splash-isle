import './story.css';

type Ink = CanvasRenderingContext2D;

const navy = '#213e50', cream = '#fff2ce', saffron = '#efbc59', coral = '#d65f4c';
const W = 1024, H = 448;

function path(c: Ink, d: string, fill: string, stroke?: string, width = 2): void {
  const p = new Path2D(d);
  c.fillStyle = fill;
  c.fill(p);
  if (stroke) {
    c.strokeStyle = stroke;
    c.lineWidth = width;
    c.stroke(p);
  }
}

function line(c: Ink, d: string, ink: string, width = 2): void {
  c.strokeStyle = ink;
  c.lineWidth = width;
  c.stroke(new Path2D(d));
}

function oval(c: Ink, x: number, y: number, rx: number, ry: number, ink: string, tilt = 0): void {
  c.beginPath();
  c.ellipse(x, y, rx, ry, tilt, 0, Math.PI * 2);
  c.fillStyle = ink;
  c.fill();
}

// 遠くの海鳥と雲、版木の彫り跡のような波を3枚の景色で使う。
function gull(c: Ink, x: number, y: number, size: number, color: string): void {
  c.save(); c.translate(x, y); c.scale(size, size);
  path(c, 'M-22 -5Q-8 -8 0 2Q10 -10 23 -8Q11 -5 1 6L-2 6Q-10 -3 -22 -5Z', color);
  c.restore();
}

function clouds(c: Ink, x: number, y: number, s: number, color: string): void {
  c.save(); c.translate(x, y); c.scale(s, s);
  path(c, 'M0 0Q12 -7 30 -6Q40 -27 64 -21Q77 -45 106 -40Q132 -38 140 -20Q159 -26 175 -13Q211 -12 226 0Z', color);
  c.restore();
}

function sky(c: Ink, upper: string, lower: string, horizon: number): void {
  const g = c.createLinearGradient(0, 0, 0, horizon);
  g.addColorStop(0, upper); g.addColorStop(1, lower);
  c.fillStyle = g; c.fillRect(0, 0, W, H);
}

function ocean(c: Ink, y: number, far: string, near: string, glint: string): void {
  const gradient = c.createLinearGradient(0, y, 0, H);
  gradient.addColorStop(0, far); gradient.addColorStop(1, near);
  c.fillStyle = gradient; c.fillRect(0, y, W, H - y);
  for (let row = 0; row < 9; row++) {
    const yy = y + 3 + (H - y) * (row / 9) ** 1.30;
    for (let i = 0; i < 7; i++) {
      const xx = (i * 163 + row * 83 + (i % 3) * 39) % 1092 - 50;
      const len = 15 + (i * 17 + row * 11) % 65 + row * 2;
      line(c, `M${xx} ${yy}q${len * 0.30} ${2 + row * 0.6} ${len * 0.56} 0t${len * 0.44} 0`, glint, row > 6 ? 2 : 1.2);
    }
  }
}

// 横から見たプカ。作中と同じ麦わら帽子、黄のスカーフ、竹の口が付いた陶器のポンプ。
function puka(c: Ink, x: number, y: number, s: number): void {
  c.save(); c.translate(x, y); c.scale(s, s);
  path(c, 'M-33 49Q-53 72 -42 110L46 110Q57 87 41 62L35 43Z', '#253e53', navy, 2.8);
  path(c, 'M6 62Q30 54 38 72Q52 87 45 111L6 115Q-3 89 6 62Z', '#f6e8c7');
  path(c, 'M-39 16Q-47 -16 -15 -32Q17 -49 41 -22Q59 -3 48 24Q42 47 21 51L-17 54Q-32 53 -39 36Z', '#26394d', navy, 3);
  path(c, 'M2 -8Q13 -19 23 -9Q38 -19 46 -7Q51 3 46 17Q44 38 23 43Q0 43 -9 30Q-18 12 2 -8Z', cream);
  oval(c, 32, 0, 4.3, 6.4, navy, -0.12); oval(c, 33, -2, 1.15, 1.4, '#fff');
  path(c, 'M40 10Q54 6 66 16Q55 22 39 18Z', '#e68a3d', navy, 1.7);
  path(c, 'M-30 45Q9 54 39 38L43 50Q16 67 -31 61Z', saffron, '#ad823f', 1.6);
  path(c, 'M-27 51Q-49 44 -62 53Q-49 55 -62 70Q-43 69 -25 57Z', '#edb84e', '#ad823f', 1.6);
  path(c, 'M-41 -24Q-42 -60 -18 -66Q7 -73 24 -58L37 -26Z', '#e9bf71', '#6b5141', 2.2);
  path(c, 'M-41 -36Q-1 -42 31 -37L36 -24L-41 -19Z', coral);
  path(c, 'M-63 -19Q-51 -29 -29 -28Q20 -37 61 -26Q67 -20 57 -18Q24 -17 6 -14Q-28 -8 -56 -11Q-68 -13 -63 -19Z', '#f4cf82', '#705a40', 2.3);
  line(c, 'M-28 -53Q-11 -61 6 -57M-32 -47Q-13 -54 12 -51M-48 -17Q-32 -20 -21 -20', '#c59757', 1.8);
  path(c, 'M-23 49Q-9 60 9 70L6 77Q-12 68 -29 55Z', '#b88651', '#674c3a', 1.6);
  path(c, 'M-38 59Q-58 59 -54 77Q-70 85 -62 103Q-54 116 -35 109Q-18 100 -27 86Q-20 72 -36 67Z', '#39a99b', '#284f54', 2.5);
  path(c, 'M-54 86Q-50 76 -43 78M-55 92Q-60 102 -50 104', 'transparent', '#90d4b8', 3.8);
  path(c, 'M-43 64L-52 45L-46 40L-33 65Z', '#a9ad61', '#47604c', 2);
  line(c, 'M-52 47L-45 44M-49 53L-43 50M-57 81Q-46 88 -32 80', '#bc5547', 2.1);
  path(c, 'M-12 64Q-22 69 -21 86Q-17 99 -7 99Q5 87 12 76Q5 69 -12 64Z', '#345268', navy, 2);
  c.restore();
}

function sailing(c: Ink): void {
  sky(c, '#a3cfce', '#ffdfac', 260);
  oval(c, 764, 113, 53, 53, '#fce5a7');
  clouds(c, 66, 125, 0.94, '#fff0cd'); clouds(c, 637, 153, 0.84, '#f7dbb1'); clouds(c, 872, 119, 0.70, '#f5deb9');
  path(c, 'M0 252Q65 235 122 247Q155 228 175 231Q209 216 252 243Q284 247 313 251L382 258H0Z', '#90aaa1');
  path(c, 'M784 251Q825 244 846 235Q862 218 881 227Q894 219 920 240L1024 245V263H773Z', '#95aba1');
  ocean(c, 251, '#6ebbb5', '#346d80', '#b3d3bc');
  line(c, 'M815 250H952M63 255H180M737 259h44M887 267h51', '#d8dcc0', 2);
  gull(c, 580, 69, 0.76, '#42687a'); gull(c, 620, 80, 0.49, '#557b85'); gull(c, 902, 177, 0.52, '#627f88');
  // 左へ風をはらむ一枚帆。継ぎ目と裾の色帯は帆のふくらみに沿わせる。
  path(c, 'M392 21Q316 77 221 158Q199 178 169 207Q282 178 384 237Q406 166 392 21Z', '#f9e9c5', '#826c54', 2.5);
  path(c, 'M171 206Q276 165 389 216L384 237Q281 180 169 209Z', '#cf735d');
  path(c, 'M374 42Q335 128 329 197Q306 192 286 191Q302 132 374 42Z', '#f0d9a8');
  line(c, 'M392 22Q329 106 299 190M392 22Q363 118 357 205M191 192Q285 155 388 195', '#c5ae82', 1.8);
  line(c, 'M405 0L387 315', '#674b3c', 8); line(c, 'M403 0L385 314', '#bc9160', 3);
  path(c, 'M402 14Q438 22 465 11L451 24L469 30Q438 36 400 30Z', coral);
  line(c, 'M400 0L558 331M390 48L167 319M169 211L155 316', '#7e7461', 1.7);
  // 解けかけた帆綱と海を切る朱色の小舟。
  puka(c, 511, 219, 1.03);
  path(c, 'M128 299Q237 323 366 318Q516 326 659 276Q646 316 597 351Q546 374 459 381Q281 389 162 344Z', '#b55340', '#354a50', 3);
  path(c, 'M128 299Q342 354 659 276L650 292Q394 370 143 319Z', '#edbd73', '#825641', 2);
  path(c, 'M162 341Q332 391 598 346Q560 381 473 389Q303 405 192 360Z', '#244c5a');
  line(c, 'M178 328Q371 379 589 327M221 348Q396 384 548 352', '#dd8560', 2.6);
  line(c, 'M578 308Q590 328 604 319Q620 307 616 292', '#e5be80', 3);
  // 海面の手前に砕けた白波としぶき。
  path(c, 'M0 363Q81 345 139 362Q177 381 236 374Q282 370 324 380Q380 394 426 382Q477 377 528 382Q591 381 637 346Q652 338 660 342Q642 359 634 362Q667 355 683 347Q668 362 636 380Q568 406 477 407Q392 402 327 421Q212 442 126 414Q63 390 0 403Z', '#8ecbbd');
  path(c, 'M0 402Q80 383 152 411Q246 440 355 410Q414 392 492 399Q588 404 638 378Q603 409 550 416Q465 420 406 435L350 448H0Z', '#326f7e');
  line(c, 'M35 360Q95 351 151 368M149 374Q186 383 217 378M242 387Q279 382 300 387M557 387Q620 381 655 354M658 340l15 -13M677 338l10 -5', '#e6edce', 3.5);
}

function letter(c: Ink): void {
  sky(c, '#82aeb4', '#b5c8b9', 212);
  ocean(c, 0, '#83b9b1', '#336b77', '#abcec2');
  // 船上を見下ろす構図。舷側の下に海、日差しの落ちる木甲板の上に一通。
  path(c, 'M0 57Q374 103 1024 21V448H0Z', '#bd8358', '#534e43', 4);
  path(c, 'M0 63Q411 109 1024 31L1024 46Q402 130 0 79Z', '#eed19a');
  for (let i = 0; i < 7; i++) {
    const y = 115 + i * 54;
    line(c, `M-10 ${y}Q358 ${y + 40} 1034 ${y - 57}`, '#a3714f', 2.5);
    line(c, `M${(i * 137) % 405} ${y + 12}q81 6 124 0m324 -18q81 -2 142 -12`, '#d9a773', 1.7);
  }
  // 左下に折り返した封筒。波消印、糊の色、便箋中央の折り線。
  c.save(); c.translate(330, 306); c.rotate(-0.24);
  path(c, 'M-181 -83L141 -86L146 96L-181 100Z', '#9b744d');
  path(c, 'M-186 -88L136 -91L141 91L-186 95Z', '#e9c991', '#aa8558', 2);
  path(c, 'M-186 -88L-29 21L136 -91L-17 -119Z', '#f4ddab', '#b28c60', 2);
  line(c, 'M-186 95L-83 5M141 91L48 4', '#c09b68', 2.5); c.restore();
  c.save(); c.translate(546, 219); c.rotate(-0.10);
  path(c, 'M-227 -166L-31 -156L181 -170L206 150L-10 171L-233 152Z', '#795e45');
  path(c, 'M-233 -172L-35 -162L175 -176L199 144L-15 163L-240 145Z', '#ffedc9', '#d5b988', 2);
  path(c, 'M-35 -162L175 -176L199 144L-15 163Z', '#f8e4b9');
  line(c, 'M-34 -157L-15 155', '#d5bd90', 2); line(c, 'M-31 -156L-12 156', '#fff1d1', 2);
  c.fillStyle = '#435960'; c.font = 'bold 23px serif'; c.fillText('プカへ', -198, -103);
  // 村長が余白に描いた、噴水と広場のスケッチ。スミが紙の縁までにじんでいる。
  line(c, 'M-200 -67q48 -4 78 1m13 1q21 3 40 -2M-201 -48q28 -2 45 2m12 0q21 1 48 -1M-200 -28q62 4 95 0M-200 12q29 -3 53 1m14 0h33M-198 32q64 1 99 0M-196 52q24 1 38 -1m16 1h24', '#839087', 2.8);
  c.font = 'bold 18px serif'; c.fillText('トト', -116, 99);
  path(c, 'M13 71Q69 42 142 63Q165 68 170 80Q138 103 67 108Q29 102 13 86Z', '#8aa99b');
  path(c, 'M29 69Q54 66 66 55L72 36Q62 33 56 26Q78 30 106 17Q102 32 87 36L88 52Q96 63 117 66Q87 82 50 80Z', '#698a83');
  line(c, 'M79 22Q71 -37 58 -10Q51 3 52 12M79 22Q67 -58 80 -61Q95 -57 80 22M82 21Q96 -27 113 -27Q130 -27 132 -7', '#79a9a7', 3);
  path(c, 'M47 87Q46 68 63 73Q76 63 90 69Q90 53 105 61Q117 66 129 60Q146 58 145 68Q163 71 167 90Q154 91 147 98Q126 96 115 106Q96 108 82 103Q68 115 64 99Q43 105 47 87Z', '#493b55');
  oval(c, 143, 109, 8, 5, '#493b55', -0.23); oval(c, 157, 115, 3.8, 2.8, '#493b55');
  path(c, 'M98 -138h49v58H98Z', '#d67b5c');
  path(c, 'M104 -132h37v46h-37Z', '#f4cf98'); gull(c, 123, -111, 0.67, '#587b77');
  line(c, 'M65 -104q18 -8 35 -2t29 -2M65 -97q17 -8 34 -2t30 -2M65 -90q18 -8 35 -2t29 -2', '#ad7963', 1.6);
  c.restore();
  // 便箋の端を押さえるプカの翼と、船べりに引っかけた綱の輪。
  path(c, 'M178 448Q194 388 278 334Q302 316 331 310Q351 311 342 326Q329 342 309 357Q329 345 337 349Q347 360 318 391L283 448Z', '#29495a', '#233e4d', 3);
  line(c, 'M237 422Q259 381 296 358M251 435Q275 410 301 394', '#496676', 3);
  c.save(); c.translate(868, 265); c.rotate(-0.28);
  for (const s of [1.0, 0.78, 0.56]) {
    c.beginPath(); c.ellipse(0, 0, 80 * s, 53 * s, 0, 0, Math.PI * 2); c.strokeStyle = '#947049'; c.lineWidth = 10; c.stroke();
    c.strokeStyle = '#e0b77e'; c.lineWidth = 5; c.stroke();
  }
  line(c, 'M48 28Q82 67 124 54Q153 45 176 70', '#d3ab71', 7);
  c.restore();
}

function littleHouse(c: Ink, x: number, base: number, width: number, height: number, wall: string, roof: string): void {
  const top = base - height, side = width * 0.25;
  c.fillStyle = wall; c.fillRect(x, top, width, height);
  c.fillStyle = '#be9d78'; c.fillRect(x + width - side, top, side, height);
  path(c, `M${x - 3} ${top + 1}l${width * 0.55} -${width * 0.29}l${width * 0.55} ${width * 0.29}Z`, roof);
  c.fillStyle = '#4c7280';
  for (const dx of [0.15, 0.48]) {
    c.fillRect(x + width * dx, top + height * 0.20, Math.max(3, width * 0.13), height * 0.28);
  }
  c.fillStyle = '#54736f'; c.fillRect(x + width * 0.40, base - height * 0.31, width * 0.18, height * 0.31);
}

function palm(c: Ink, x: number, base: number, s: number): void {
  c.save(); c.translate(x, base); c.scale(s,s);
  path(c, 'M-3 0Q4 -40 1 -64L6 -65Q11 -31 4 0Z', '#866951');
  for (const angle of [-1.36, -0.85, -0.37, 0.32, 0.82, 1.38]) {
    c.save(); c.translate(4,-64); c.rotate(angle);
    path(c,'M0 0Q-6 -22 2 -37Q1 -28 5 -28Q9 -16 0 0Z', '#417d70'); c.restore();
  }
  c.restore();
}

function harbor(c: Ink): void {
  sky(c, '#8bc3c8', '#fae1b8', 264); clouds(c, 66, 89, 0.88, '#f8eacc'); clouds(c, 680, 101, 1.12, '#f6e6c7');
  path(c, 'M0 209Q96 163 161 182Q229 138 309 155Q345 157 375 163L425 134L454 141L476 125L497 124L545 164Q618 130 681 167Q711 148 757 149Q832 141 883 177Q965 153 1024 179V276H0Z', '#8ea69a');
  path(c, 'M0 230Q71 197 148 217Q209 176 287 164Q363 156 423 193Q479 169 543 185Q623 158 691 177Q751 187 816 195Q913 162 1024 199V286H0Z', '#649489');
  path(c, 'M0 250Q70 211 131 230Q244 184 295 197Q336 210 390 215Q486 204 554 199Q624 187 691 212Q756 203 818 219Q903 195 1024 205V289H0Z', '#477e74');
  // 丘の灯台。入口から港の時計塔まで続く白い家並み。
  path(c, 'M269 167L275 108L291 108L302 167Z', cream);
  path(c, 'M273 135H295L297 145H272Z', '#438d83');
  path(c, 'M272 110H296V115H272Z M276 96H291V108H276Z', '#4f6870');
  path(c, 'M271 96L283 87L297 96Z', coral);
  path(c, 'M280 98H288V105H280Z', '#f5ce77');
  const palette = ['#e8c99e','#f5dab0','#d4b5a7','#e7bd95'];
  const roofs = ['#b97157','#688e87','#bc805b','#6d8385'];
  for (let i = 0; i < 13; i++) {
    const x = 239 + i * 39 + (i % 3) * 8, w = 26 + (i * 11 % 17);
    littleHouse(c,x,236 - (i % 4) * 5,w,22 + (i * 17 % 24),palette[i % 4],roofs[(i + 1) % 4]);
  }
  for (let i = 0; i < 14; i++) {
    const x = 133 + i * 50, w = 41 + (i * 13 % 22);
    littleHouse(c,x,268 - (i % 3) * 4,w,31 + (i * 23 % 30),palette[(i + 1) % 4],roofs[i % 4]);
  }
  path(c, 'M604 245V141H634V245Z', '#f5d6aa');
  path(c, 'M628 143H636V245H628Z', '#bc9471');
  path(c, 'M599 142L620 122L640 142Z', '#b56a50');
  oval(c, 618, 157, 8, 8, '#526c6e'); oval(c, 618, 157, 6.6, 6.6, cream);
  line(c, 'M618 151v6l4 3', '#53666a', 1.5);
  path(c, 'M601 170H635V174H601ZM610 195V181H616V195ZM622 195V181H628V195Z', '#927b62');
  for (const [x, y, scale] of [[165,253,0.65],[190,251,0.50],[525,246,0.65],[547,250,0.48],[745,254,0.76],[783,254,0.57]]) palm(c,x,y,scale);
  path(c, 'M0 263Q128 245 223 263Q334 269 415 262L561 261L730 250Q776 247 860 254L1024 237V293H0Z', '#c6ab85');
  path(c, 'M0 278Q176 259 316 276Q494 286 706 263Q802 257 873 261L1024 250V292H0Z', '#7e806a');
  ocean(c, 285, '#75bbb1', '#367e8a', '#b8d9bf');
  // 水際に小さな市場の日よけ、岸壁の段、舫い綱を巻いた漁船。
  for (const [x,y,w] of [[351,266,39],[412,263,36],[536,257,38]]) {
    path(c, `M${x} ${y}v-11l${w} -1v12Z`, '#866753');
    for (let i=0; i<5; i++) {
      const dx=x+i*w/5;
      path(c, `M${dx} ${y-13}h${w/5}l3 8h-${w/5+1}Z`, i%2 ? '#f2d3a0' : coral);
    }
  }
  for (let i=0; i<8; i++) line(c,`M${225 + i*57} ${278-(i%3)*2}l12 -1m3 0h7`,'#aa997e',1.5);
  for (let i=0; i<3; i++) {
    c.fillStyle = ['#c0af8e','#b4a180','#a38d75'][i];
    c.fillRect(622-3*i,276+3*i,32+6*i,3);
  }
  path(c, 'M181 294Q213 300 246 288Q237 305 205 306Q190 305 181 294Z', '#b9694e', '#526a65', 1.4);
  line(c,'M182 294Q211 300 245 288','#f7d59c',2.7);
  line(c,'M211 294l-2 -35l24 31','#717566',1.5);
  path(c,'M209 262q-10 15 -18 24q10 -3 19 -1Z','#edc48c');
  for (let i=0; i<4; i++) line(c,`M${194+i*15} ${309+i*2}q11 1 19 -1`,'#628c82',1.4);
  // 港の前景に桟橋と旗。画面を横切るロープに風を感じさせる。
  path(c, 'M711 282L779 279L527 448H371Z', '#be895b', '#6f6251', 2.6);
  path(c, 'M779 279L779 286L549 448H527Z', '#866950');
  for (const t of [0.10,0.22,0.37,0.55,0.76,0.94]) {
    line(c,`M${711 - 340 * t} ${282 + 166 * t}L${779 - 252 * t} ${279 + 169 * t}`,'#876c50',2);
  }
  for (const [x,y,h] of [[605,347,46],[696,293,25],[505,405,55],[801,286,24]]) {
    c.fillStyle = '#7f6852'; c.fillRect(x-4,y-h,8,h+17); oval(c,x,y-h,4,2.3,'#d6b17f');
  }
  line(c, 'M-18 7Q182 125 405 38T731 26Q873 66 1048 3', '#596a62', 2.4);
  const flags = [[43,38,0.42],[98,58,0.30],[158,71,0.16],[222,73,-0.02],[285,65,-0.11],[349,52,-0.25],[747,28,0.18],[807,34,0.06],[876,35,-0.08],[924,28,-0.21]];
  for (const [i,[x,y,a]] of flags.entries()) {
    c.save(); c.translate(x,y); c.rotate(a);
    path(c,'M-12 0L14 0L1 28Z',[coral,saffron,'#5f998d',cream][i%4]); c.restore();
  }
  // 船首のポンプと帽子が桟橋に並ぶ、到着の場面。
  c.save(); c.translate(-10,22); puka(c, 294, 362, 0.78);
  path(c, 'M22 408Q172 455 340 422Q389 412 437 386Q398 439 345 456H22Z', '#b76048', navy, 2.5);
  line(c, 'M22 408Q252 472 437 386', '#efc481', 7); c.restore();
  gull(c, 473, 97, 0.55, '#5a7982'); gull(c, 502, 86, 0.41, '#64818a');
}

const pages = [
  { title: '海風をつかまえて', text: 'プカは麦わら帽子を押さえ、小舟の帆を張った。背中には、竹の口から水が飛び出す、お気に入りのひょうたんポンプ。', art: sailing, alt: '麦わら帽子のプカが、ひょうたんポンプを背負って小舟の帆を張る。' },
  { title: 'スミのついた手紙', text: '港から来た海鳥が、船べりに手紙を落とした。「プカへ。町の広場が、ねばねばのスミだらけじゃ。どうか力を貸しておくれ！」トト村長からだ。', art: letter, alt: 'トト村長からの折りたたんだ便箋には噴水が描かれ、紫色のスミがにじんでいる。' },
  { title: '待ってて、ヒカリ島！', text: '丘の灯台が見えた。潮風に、朝市の旗がはためいている。「よし、まずは広場へ！」プカはポンプを背負い直し、桟橋に小舟を寄せた。', art: harbor, alt: '灯台と時計塔の立つヒカリ島。朝市の旗の下で、プカの小舟が木の桟橋に近づく。' },
];

const arrow = (right: boolean) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path d="${right ? 'M5 12h14m-6-6 6 6-6 6' : 'M19 12H5m6 6-6-6 6-6'}" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
let dismiss: (() => void) | null = null;

export function showPrologue(onLand: () => void, onBack: () => void): void {
  dismiss?.();
  const previous = document.activeElement;
  const host = document.createElement('section');
  host.id = 'prologue';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-labelledby', 'storyLabel');
  host.innerHTML = `<div class="story-wrap">
    <header class="story-top"><h1 id="storyLabel">プロローグ</h1>
    <button class="story-menu" id="storyMenu" type="button">${arrow(false)}ファイル選択へ</button></header>
    <article class="story-page"><div class="story-picture"><canvas role="img"></canvas></div>
    <div class="story-panel"><div class="story-copy" aria-live="polite" aria-atomic="true">
      <h2></h2><p></p></div>
      <nav class="story-nav" aria-label="物語のページ">
        <span class="story-count"></span><div class="story-actions">
        <button id="storyBack" type="button">${arrow(false)}前へ</button>
        <button id="storyNext" type="button"><span></span>${arrow(true)}</button>
        </div></nav></div></article></div>`;
  document.getElementById('app')!.append(host);
  const canvas = host.querySelector('canvas')!;
  const title = host.querySelector('h2')!;
  const copy = host.querySelector('p')!;
  const count = host.querySelector<HTMLSpanElement>('.story-count')!;
  const menu = host.querySelector<HTMLButtonElement>('#storyMenu')!;
  const back = host.querySelector<HTMLButtonElement>('#storyBack')!;
  const next = host.querySelector<HTMLButtonElement>('#storyNext')!;
  let page = 0;

  function draw(): void {
    const c = canvas.getContext('2d');
    if (!c) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2), rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
    const scale = Math.max(canvas.width / W, canvas.height / H);
    c.setTransform(scale, 0, 0, scale, (canvas.width - W * scale) / 2, (canvas.height - H * scale) / 2);
    c.lineJoin = 'round'; c.lineCap = 'round';
    pages[page].art(c);
    // 紙の小さな繊維は再描画しても同じ位置に残す。静止画のときは描画ループを持たない。
    let seed = 1825;
    const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 2100; i++) {
      const x = rand() * W, y = rand() * H, len = 0.35 + rand() * 1.4;
      c.fillStyle = i % 2 ? '#243f4a12' : '#fff7ce3b';
      c.fillRect(x, y, len, 0.55);
    }
  }
  function render(): void {
    const p = pages[page];
    title.textContent = p.title; copy.textContent = p.text;
    canvas.setAttribute('aria-label', p.alt);
    count.textContent = `${page + 1} / ${pages.length}`;
    count.setAttribute('aria-label', `全${pages.length}ページ中${page + 1}ページ目`);
    next.querySelector('span')!.textContent = page === pages.length - 1 ? '島へ上陸する' : '次へ';
    const returnFocusToNext = page === 0 && document.activeElement === back;
    back.hidden = page === 0;
    if (returnFocusToNext) next.focus({ preventScroll: true });
    draw();
  }
  const observer = new ResizeObserver(draw);
  observer.observe(canvas);
  function cleanup(): void {
    window.removeEventListener('keydown', onKey, true);
    observer.disconnect(); host.remove(); dismiss = null;
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus({preventScroll: true});
  }
  function leave(callback: () => void): void {
    cleanup(); callback();
  }
  function forward(): void {
    if (page === pages.length - 1) leave(onLand);
    else { page++; render(); }
  }
  function backward(): void {
    if (page === 0) leave(onBack);
    else { page--; render(); }
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Tab') {
      const order = back.hidden ? [menu, next] : [menu, back, next];
      const at = order.indexOf(document.activeElement as HTMLButtonElement);
      if (at < 0 || (e.shiftKey && at === 0) || (!e.shiftKey && at === order.length - 1)) {
        e.preventDefault(); order[e.shiftKey ? order.length - 1 : 0].focus();
      }
      e.stopImmediatePropagation();
      return;
    }
    if (['ArrowRight', 'ArrowLeft', 'Escape'].includes(e.key)) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (!e.repeat) {
        if (e.key === 'Escape') leave(onBack);
        else if (e.key === 'ArrowRight') forward();
        else backward();
      }
      return;
    }
    // Enter と Space はボタンに任せ、長押しで続けてページを進めない。
    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) e.preventDefault();
    e.stopPropagation();
  }
  menu.onclick = () => leave(onBack);
  back.onclick = backward; next.onclick = forward;
  dismiss = cleanup;
  window.addEventListener('keydown', onKey, true);
  render(); next.focus({ preventScroll: true });
}
