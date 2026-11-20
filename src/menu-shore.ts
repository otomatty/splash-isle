// メニューの背景はゲーム世界から独立した版画風の海景。静的な曲線だけで潮目や葉脈を描く。
const svgNamespace = 'http://www.w3.org/2000/svg';

function palmFrond(tipX: number, tipY: number, bend: number, length: number, color: string): string {
  const startX = -18, startY = -10;
  const bx = tipX * 0.60, by = tipY * 0.25 - bend;
  let leaflets = '';
  for (let i = 1; i <= 13; i++) {
    const t = i / 15, q = 1 - t;
    const x = q * q * startX + 2 * q * t * bx + t * t * tipX;
    const y = q * q * startY + 2 * q * t * by + t * t * tipY;
    const dx = 2 * (q * (bx - startX) + t * (tipX - bx));
    const dy = 2 * (q * (by - startY) + t * (tipY - by));
    const d = Math.hypot(dx, dy), fx = dx / d, fy = dy / d;
    for (const side of [-1, 1]) {
      const l = length * (0.4 + 0.6 * Math.sin(Math.PI * t)) * (1 - t * 0.68) * (side > 0 ? 1 : 0.83);
      const wx = -fy * side, wy = fx * side;
      const ex = x + l * (0.64 * fx + wx), ey = y + l * (0.64 * fy + wy) + l * 0.25;
      const cx = x + l * (0.12 * fx + wx * 0.78), cy = y + l * (0.12 * fy + wy * 0.78);
      const n = (v: number) => v.toFixed(1);
      leaflets += `<path d="M${n(x)},${n(y)} Q${n(cx)},${n(cy)} ${n(ex)},${n(ey)} Q${n(cx + 9 * fx)},${n(cy + 9 * fy)} ${n(x)},${n(y)}Z"/>`;
    }
  }
  return `<g fill="${color}">${leaflets}<path fill="none" stroke="${color}" stroke-width="2.7" d="M${startX} ${startY}Q${bx} ${by} ${tipX} ${tipY}"/></g>`;
}

function cornerPalm(flipped: boolean): string {
  const x = flipped ? 0.83 : 1;
  return `<svg aria-hidden="true" class="corner-palm ${flipped ? 'palm-right' : 'palm-left'}" viewBox="0 0 300 205"><g transform="scale(${x})">${palmFrond(126, 180, 8, 52, '#328f83')}${palmFrond(226, 114, 14, 56, '#247f77')}${palmFrond(284, 50, 7, 48, '#176d68')}${palmFrond(39, 187, 6, 40, '#378c7d')}${palmFrond(215, 5, 1, 36, '#1b716b')}</g></svg>`;
}

function panorama(): string {
  let glints = '', grains = '';
  // 手前ほど長く離れる水の反射。画面の幅が変わっても規則的な格子が見えないようずらす。
  for (let row = 0; row < 10; row++) {
    for (let i = 0; i < 6; i++) {
      const x = (42 + i * 277 + row * 167 + i * i * 17) % 1440;
      const y = 372 + row * 17 + 5 * Math.sin(i * 2 + row);
      const w = 8 + row * 3.6 + ((i + row) % 3) * 6;
      glints += `<path d="M${x} ${y.toFixed(1)}q${(w * 0.38).toFixed(1)} 1.3 ${w.toFixed(1)} -0.5"/>`;
    }
  }
  for (let i = 0; i < 96; i++) {
    const x = (i * 127 + i * i * 19) % 1437, y = 610 + (i * 43 + i * i * 7) % 287;
    grains += `<path d="M${x} ${y}l${i % 3 + 1} -0.35"/>`;
  }
  // 波打ち際は砂の湿った帯、薄い泡、その奥のエメラルド色の浅瀬と分ける。
  return `<svg class="shore-panorama" viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true">
    <path fill="#76c3bd" d="M0 355q87-4 123-12t82 1q44 6 115 11l62 3-382 8zm922 4q75-6 119-16t79-1q64-6 111-19t95-4q54 3 114 12v33z"/>
    <path fill="#4daba9" d="M1005 357q32-7 57-7 83 1 146-16 60-23 103-20 40 0 79 9l50-2v45zM0 350q61-7 101 0t105 7l71 4H0z"/>
    <path fill="#228f91" d="M1104 359c54-5 89-12 121-20 60-16 65-24 95-21 57 3 77 14 120 8v39z"/>
    <path opacity=".62" fill="#d0efe0" d="M0 360q310-6 575-2 423-4 865 2v5q-410-5-699-2-413-1-741 4z"/>
    <path fill="#45aba8" opacity=".52" d="M0 376q128-6 250-3 124 3 190-4-106 9-196 7-134-1-244 8zm835 12q91-10 184-7 174 2 318-7-123 12-270 11-141-1-232 3z"/>
    <g fill="none" stroke="#e1f6df" stroke-width="2.2" stroke-linecap="round" opacity=".72">${glints}</g>
    <path fill="#85d5bf" d="M0 512q180-18 371 9 204 26 421 2 207-20 391-4 123 10 257-5v30H0z"/>
    <path fill="#a5e1c7" d="M0 529q189-18 361 6 197 28 441 2 201-26 372-7 161 19 266 2v36H0z"/>
    <path fill="#ccdfb8" d="M0 549c191-24 300 11 481 18 175 6 271-23 458-24 205-3 294 24 501-4v81H0z"/>
    <path fill="#f1d9a2" d="M0 559c183-23 298 13 483 18 172 5 272-24 458-24 200-3 295 22 499-3v350H0z"/>
    <path fill="#ddbe83" opacity=".52" d="M0 562c183-23 298 13 483 18 172 5 272-24 458-24 200-3 295 22 499-3v13c-140 24-307-5-475-2-197-1-312 31-474 24-237-11-320-35-491-14z"/>
    <path fill="#f8f5d5" d="M0 549c87-10 132-9 194-6 111 5 195 23 301 25 175 4 267-24 451-24 193-1 284 18 494-6v9c-72 9-170 16-249 13-130-8-172-13-249-12-187 1-280 32-453 26-124-4-229-27-326-28-59-2-115 4-163 11z"/>
    <g fill="none" stroke="#fffde2" opacity=".84" stroke-linecap="round"><path stroke-width="2.7" d="M15 533q83-10 151-6m61 6q41 2 72 10m93 5q84 13 159 7m105-4q56-3 87-11m133-8q99-12 202-3m144 7q92 4 164-10"/><path stroke-width="1.6" d="M97 560q50-6 83-2m44 0 70 6m34 5q66 12 101 12m162 2q64-4 101-13m157-10q77-9 139-8m174 5q54 8 106 3m63-2 43-4"/></g>
    <g fill="none" stroke="#ad8d58" stroke-width="1.7" stroke-linecap="round" opacity=".38">${grains}</g>
    <g fill="none" stroke="#d0ad74" stroke-width="1.6" opacity=".54" stroke-linecap="round"><path d="M-14 714q64-10 115-3m-81 7q29-4 55-3m18 42q57-12 108-3m1010-18q69 5 140-10m-51 15q26-2 40-6M1141 848q49 8 138-6m-76 11q50 2 74-3M0 828q70 5 138-8"/></g>
    </svg>`;
}

// 打ち上げられた貝と小さなヒトデ。透視に合わせ砂に浅く埋めた影を添える。
const tidePoolFinds = `<svg class="tide-finds finds-west" viewBox="0 0 126 69" aria-hidden="true">
  <path fill="none" stroke="#c1a270" opacity=".58" stroke-width="1.3" d="M3 57q19 1 32-3m29 2q20 1 42-5M45 58l8-1"/>
  <g transform="translate(42 38) rotate(-13) scale(1 .65)">
    <path d="m0-3 14-23q3-3 3 2l-3 20 25 5q3 1 0 3l-23 4 7 18q1 4-3 2L4 14l-15 13q-4 2-2-2l7-18-22-6q-4-1-1-4l23-1z" fill="#bd9561" transform="translate(2 5)"/>
    <path d="m0-3 14-23q3-3 3 2l-3 20 25 5q3 1 0 3l-23 4 7 18q1 4-3 2L4 14l-15 13q-4 2-2-2l7-18-22-6q-4-1-1-4l23-1z" fill="#d98f69"/>
    <path d="m5 4 9-22M5 4l26-2M5 4l12 17M5 4l-12 16M5 4l-20-6" fill="none" stroke="#efb282" stroke-width="2.8" stroke-dasharray="1.8 3" stroke-linecap="round"/>
  </g><path d="M93 40q3-7 11-3l4 3-7 3-9-1z" fill="#adba95"/><path d="m93 40 7-2 6 1-7 2z" fill="#d1d5ae"/>
  </svg><svg class="tide-finds finds-east" viewBox="0 0 120 65" aria-hidden="true">
  <path d="M19 46q22 3 42-1m35-8 12-1" fill="none" stroke="#ba986a" opacity=".6"/>
  <g transform="translate(42 31) rotate(12)"><path d="m-20 1q5-9 19-12 14 0 26 9 5 6-2 9-8 3-19 2l-22-3q-8-1-2-5z" fill="#caaa77" transform="translate(2 2)"/>
  <path d="m-20 1q5-9 19-12 14 0 26 9 5 6-2 9-8 3-19 2l-22-3q-8-1-2-5z" fill="#edd5ae"/>
  <path d="M-17 3Q-10-7-1-9m-11 15Q-3-7 4-8M-3 7Q3-5 8-6M8 7q4-8 7-10m1 9 5-3" fill="none" stroke="#cbab85" stroke-width="1.8" stroke-linecap="round"/></g>
  </svg>`;

const scene = panorama();
for (const el of document.querySelectorAll<HTMLElement>('.menu-shore')) {
  el.innerHTML = scene + `<svg class="shore-atmosphere" viewBox="0 0 1440 360" preserveAspectRatio="xMidYMax slice" xmlns="${svgNamespace}" aria-hidden="true">
    <g fill="#fffce8" opacity=".65"><path d="M121 157q33-3 55-13 17-8 32-7 20-23 54-21 25 0 45 15 21-7 48 5 19 9 58 10-107 8-179 8-40 0-113 3z"/><path d="M923 110q25-3 43-14 26-15 51-6 12-14 35-12 26 2 48 24 21-3 51 8z"/><path opacity=".72" d="M475 192q16-1 33-9 23-11 45 0 11 7 40 7z"/></g>
    <g fill="none" stroke="#448b8b" stroke-width="2.8" stroke-linecap="round"><path d="M994 198q9-3 16 4 3-8 11-11m23-5q5-2 10 2 2-5 7-7m-79 39q5-1 8 3 2-5 7-6"/></g></svg>` + cornerPalm(false) + cornerPalm(true) + tidePoolFinds;
}
