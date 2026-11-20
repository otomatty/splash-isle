// The menu illustrations are static, self-contained SVGs. Each sculpture borrows the
// same sandstone, cut-stone highlights and grain so that the three files read as a set.
function materials(id: string): string {
  return `<defs>
    <linearGradient id="${id}-stone" x2=".85" y2="1" gradientUnits="objectBoundingBox">
      <stop stop-color="#fff0b2"/><stop offset=".3" stop-color="#f8cf87"/><stop offset=".68" stop-color="#e6a95e"/><stop offset="1" stop-color="#bd7840"/>
    </linearGradient>
    <linearGradient id="${id}-rim" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="#ecc186"/><stop offset=".34" stop-color="#dfa15e"/><stop offset="1" stop-color="#b87542"/>
    </linearGradient>
    <linearGradient id="${id}-sand" x1=".12" y1="0" x2=".87" y2="1">
      <stop stop-color="#fff2be"/><stop offset=".48" stop-color="#f7d695"/><stop offset="1" stop-color="#dfa25b"/>
    </linearGradient>
    <linearGradient id="${id}-canvas" x1=".04" y1=".12" x2=".94" y2=".86">
      <stop stop-color="#fff2c2"/><stop offset=".42" stop-color="#ffdda0"/><stop offset=".8" stop-color="#eeba70"/><stop offset="1" stop-color="#d79a50"/>
    </linearGradient>
    <radialGradient id="${id}-shadow">
      <stop stop-color="#975c37" stop-opacity=".47"/><stop offset=".59" stop-color="#b17843" stop-opacity=".30"/><stop offset="1" stop-color="#b67b40" stop-opacity="0"/>
    </radialGradient>
    <pattern id="${id}-grain" width="23" height="19" patternUnits="userSpaceOnUse">
      <path fill="#83562f" opacity=".25" d="M1 3h.9v.8H1z M6 11h1.4v.65H6z M14 15h.7v1h-.7z M18.7 3.9h1.1v.9h-1.1z M10.3 6.1h.7v.7h-.7z M22 14h.7v.6H22z M4 18h.7v.6H4z"/>
      <path fill="#fff8d5" opacity=".7" d="M2 3h1v.6H2z M12.5 13h1v.8h-1z M18 7h1.4v.9H18z M4 8h.7v.7H4z M8 17h.8v.6H8z"/>
    </pattern>
  </defs>`;
}

const moundTop = 'M37 166 Q40 161 53 159 Q65 157 70 152 Q79 149 97 149 Q115 142 132 145 Q152 138 176 143 Q196 139 213 147 Q226 147 237 151 Q254 152 258 158 Q273 160 279 167 Q271 174 249 176 Q235 182 208 182 Q183 188 160 184 Q139 189 120 184 Q94 185 84 180 Q58 181 51 174 Q38 173 37 166Z';
function plinth(id: string): string {
  return `<ellipse cx="170" cy="177" rx="138" ry="22" fill="url(#${id}-shadow)"/>
    <path d="${moundTop}" transform="translate(0 4)" fill="#ce914f"/>
    <path d="${moundTop}" fill="url(#${id}-sand)"/><path d="${moundTop}" fill="url(#${id}-grain)"/>
    <path d="M47 165q7-4 15-4m4-3 8-2m154 17q9 1 18-2m-15 6 7-1m-159-3 7 2m-1-18 5-2" fill="none" stroke="#fff2c3" stroke-width="1.9" stroke-linecap="round"/>
    <path d="m59 171 6 2 3-1m177-7 7-1m-67 16 7-.5m-4-3 4 .4m-107-3 2 1" fill="none" stroke="#ce9554" stroke-width="1.3" stroke-linecap="round"/>`;
}

function pebble(x: number, y: number, scale: number): string {
  return `<g transform="translate(${x} ${y}) scale(${scale})">
    <ellipse cx="2" cy="1" rx="8" ry="2.4" fill="#ad753d" opacity=".33"/>
    <path d="M-7 0 -4-4 1-6 7-2 8 0 3 2-3 2Z" fill="#d49e60"/>
    <path d="m-7 0 3-4 5-2 2 2-2 3Z" fill="#ffe4a3"/>
  </g>`;
}

const radians = Math.PI / 180;
function shellPoint(degrees: number, scale = 1): [number, number] {
  const a = degrees * radians;
  return [155 + scale * (83 * Math.sin(a) + 8 * Math.cos(a)), 151 - scale * (108 * Math.cos(a) + 19)];
}
function pt(point: [number, number]): string {
  return point.map(coordinate => coordinate.toFixed(1)).join(' ');
}
function shell(id: string): string {
  // Each scallop has a sunlit ridge and a reverse face. The hinge pulls these
  // ridges into a tight fan, while the lip is carved into a separate back layer.
  const hinge = '155 151';
  const scallops = 9;
  const angles = Array.from({ length: scallops + 1 }, (_, i) => -87 + i * 174 / scallops);
  const tips = angles.slice(0, -1).map((a, i) => {
    const mid = (a + angles[i + 1]) / 2;
    return { left: shellPoint(a, .94), right: shellPoint(angles[i + 1], .94), peak: shellPoint(mid, 1.025), mid };
  });
  const outer = tips.map(({ left, peak, right }, i) => {
    // Passing through the two midpoints produces a rounded, scalloped rim.
    const control = [2 * peak[0] - (left[0] + right[0]) / 2, 2 * peak[1] - (left[1] + right[1]) / 2] as [number, number];
    return `${i === 0 ? 'M' + pt(left) : ''}Q${pt(control)} ${pt(right)}`;
  }).join('') + `L${hinge}Z`;
  const ribs = tips.map(({ left, right, peak, mid }, i) => {
    const control = [2 * peak[0] - (left[0] + right[0]) / 2, 2 * peak[1] - (left[1] + right[1]) / 2] as [number, number];
    const spine = shellPoint(mid - 2, .57), inner = shellPoint(angles[i] - 2.5, .53);
    return `<path d="M${hinge} Q${pt(inner)} ${pt(left)} Q${pt(control)} ${pt(right)}Z" fill="url(#${id}-stone)"/>
      <path d="M${hinge} Q${pt(spine)} ${pt(peak)} Q${pt(right)} ${pt(right)} Q${pt(shellPoint(angles[i + 1] - 1, .64))} ${hinge}Z" fill="#bc8049" opacity="${.25 + i * .028}"/>
      <path d="M${pt(shellPoint(mid - 2, .15))} Q${pt(spine)} ${pt(shellPoint(mid, 1.005))}" fill="none" stroke="#fff3c3" stroke-opacity=".85" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M${pt(shellPoint(angles[i], .28))} Q${pt(inner)} ${pt(left)}" fill="none" stroke="#ab6939" stroke-opacity=".58" stroke-width="1.4"/>
    `;
  }).join('');
  return plinth(id) + `<ellipse cx="162" cy="161" rx="63" ry="10" fill="url(#${id}-shadow)"/>
    <g transform="translate(0 7) rotate(-9 155 151)">
      <path d="${outer}" transform="translate(5.5 5)" fill="#bb7b42" stroke="#c18a50" stroke-width="2" stroke-linejoin="round"/>
      <path d="${outer}" fill="url(#${id}-stone)" stroke="#dca75d" stroke-width="1.2"/>${ribs}
      <path d="${outer}" fill="url(#${id}-grain)"/>
      <path d="M140 142q-11-8-18-3l6 13 19 3 8-5 7 5 19-2-1-13q-10-2-18 4l-9 4Z" fill="url(#${id}-stone)" stroke="#ce995a" stroke-width="1.2"/>
      <path d="m132 145 13 6m24-4 8-3" fill="none" stroke="#fff1ba" stroke-width="1.7" stroke-linecap="round"/>
    </g>${pebble(218, 162, .78)}${pebble(228, 166, .41)}${pebble(85, 166, .54)}`;
}

function tower(id: string, painted = false): string {
  const body = 'M134 75 150 69 172 71 184 78 198 148 173 160 142 161 119 153Z';
  const top = 'M127 75 145 69 170 69 190 76 173 84 146 85Z';
  const bandLit = painted ? '#e98259' : '#f4cb88';
  const bandMid = painted ? '#c56243' : '#dba65f';
  const bandDark = painted ? '#955039' : '#bc824a';
  return `<g stroke-linejoin="round">
    <path d="M109 153 135 143 173 143 205 149 207 155 177 167 138 168 109 160Z" fill="#bd8048"/>
    <path d="M109 152 136 142 174 142 205 149 175 161 139 162Z" fill="#f5cd8a"/>
    <path d="${body}" fill="url(#${id}-canvas)"/>
    <path d="m150 69 22 2 1 89-31 1Z" fill="#f0c383"/>
    <path d="m172 71 12 7 14 70-25 12Z" fill="#cf965e"/>
    <path d="M132 86l16 7 0 3-17-7Zm17 7 24-1v3l-24 1Z" fill="#fff1c2" opacity=".7"/>
    <path d="m130 99 17 7-2 12-18-7Z" fill="${bandLit}"/><path d="m147 106 26-2v12l-28 2Z" fill="${bandMid}"/><path d="m173 104 15-6 3 12-18 6Z" fill="${bandDark}"/>
    <path d="m122 140 12 4m-8-17 9 3 3-1m39 9 12-5m-10 7 6-2m-50-43 5 2" fill="none" stroke="#bf894e" opacity=".64" stroke-width="1.1"/>
    <path d="${body}" fill="url(#${id}-grain)"/>
    <path d="m153 159 .4-16q1.2-9.9 7.6-9.9 7.1 0 7 8.6v17Z" fill="#fff0b3"/>
    <path d="m156 159 .2-15.9q.6-7.1 5.4-7t4.6 6.5l.7 16.4Z" fill="#895f43"/>
    <path d="m157.5 144 .3-2q.7-3.2 3.3-3.6m4 9v9" fill="none" stroke="#b77e49" stroke-width="1.3"/>
    <path d="M154 87q.4-4 3.8-4 3.2 0 3.2 3.5v5.7l-7 .2Z" fill="#9d754e"/><path d="M155.2 88v-1.7q.3-1.4 1.4-1.7" fill="none" stroke="#fce3a6" stroke-width="1.3"/>
    <path d="M127 74v5l19 8 27-1 17-8v-4Z" fill="#b87d46"/>
    <path d="${top}" fill="#ffe1a0"/><path d="M127 74v2l19 8 27-.5 17-8v-2l-17 7.5-27 .6Z" fill="#edbe7d"/>
    <path d="m138 55 11-5 18-.3 13 4.8v16.6l-13 5-18 .2-11-4.5Z" fill="${painted ? '#649c9c' : '#b38b61'}"/>
    <path d="m140 56 9 3v13l-9-3ZM151.5 59.5l13.3-.2v14.1l-13.3.2Z" fill="${painted ? '#b4dacc' : '#ffe2a4'}"/>
    <path d="m167.6 59 9.5-3.3v13.1l-9.5 4.1Z" fill="${painted ? '#6aaca9' : '#e6bd80'}"/>
    <path d="m151.7 67.6 9.5-8.2h2.4l-11.9 10.5Z" fill="#fff0c8" opacity=".8"/>
    <path d="M135 55q2-9 8-13l14-8.5 14.5 6.4q8 5 12.5 14l-16.5 6.3-18.1.1Z" fill="${painted ? '#dc7c53' : '#e2ac65'}"/>
    <path d="m135 55 7.7-13 14.3-8.5-7.9 26.3Z" fill="${painted ? '#f79e6b' : '#ffe2a1'}"/><path d="m157 33.5 14.5 6.4L184 54l-16.5 6.3Z" fill="${painted ? '#b96447' : '#c89354'}"/>
    <path d="m134.3 54.6 15 5.3 18.4-.2 17.2-6.3" fill="none" stroke="#f9d699" stroke-width="2.6" stroke-linecap="round"/>
    <path d="m157.3 34.8.6-9.5m-.2 2.3 11.7-1.8-5.6 4.9-6.2-.5" fill="${painted ? '#d67a56' : '#dfae68'}" stroke="#bb854d" stroke-width="1.7"/>
    <path d="M135 68v8m8-6v9m11-8v9m12-9v9m11-12v9m7-12v8m-49-6 12 4 19-.2 18-6.8" fill="none" stroke="#a87a4a" stroke-width="1.2" stroke-linecap="round"/>
    <path d="m148 158 20-.9 6 2.1-20 1.5-7-1.4Z" fill="#ffdda0"/>
    <path d="m148 161 23-1.1 5 2.1-23 1.4-6-1.1Z" fill="#efbf7d"/>
    <path d="m147 164 26-1.1 5.7 2.2-25.1 1.7-8.7-1.8Z" fill="#ffdca0"/>
  </g>`;
}

function beacon(id: string): string {
  return plinth(id) + `<ellipse cx="165" cy="162" rx="63" ry="11" fill="url(#${id}-shadow)"/>
    <g transform="translate(-8 -13) scale(1.09)">${tower(id)}</g>
    ${pebble(83, 162, .9)}${pebble(73, 165, .48)}${pebble(224, 167, .6)}`;
}

function sailboat(id: string, painted = false): string {
  const main = 'M155 35Q143 77 102 121Q121 118 148 124L170 129Q159 94 155 35Z';
  const jib = 'M163 51Q182 84 221 117Q194 114 173 124Q166 93 163 51Z';
  const hull = 'M80 125Q113 137 155 139Q198 139 239 118Q225 148 199 155Q160 169 119 158Q98 154 80 125Z';
  return `<g stroke-linejoin="round" stroke-linecap="round">
    <path d="M163 46q27 41 72 75M153 46q-18 36-65 83" fill="none" stroke="#b88147" stroke-width="1.7"/>
    <path d="m151 30 5-.7 14.4 111-5.7.8Z" fill="#ba8149"/><path d="m152 30.3 1.7-.5 13.2 109.2-2 .3Z" fill="#f9d28c"/>
    <path d="m153 29 .6 10-23-2.6 5.3-3.3-6.2-3.2Z" fill="${painted ? '#e58155' : '#e7b36e'}"/><path d="m130 30.2 23-.9" fill="none" stroke="#ffe3a4" stroke-width="1.4"/>
    <path d="${jib}" fill="${painted ? '#e99a66' : '#e6af68'}" stroke="#c38b51" stroke-width="1.2"/>
    <path d="M166 60Q182 89 211 114Q188 110 176 119Q170 96 166 60Z" fill="${painted ? '#ffb17a' : '#f5ce8e'}"/>
    <path d="M165.5 58q13 34 27 55m-21-41q12 24 29 40" fill="none" stroke="${painted ? '#f9ca99' : '#ffe0a2'}" stroke-width="1.4"/>
    <path d="${jib}" fill="url(#${id}-grain)"/>
    <path d="${main}" transform="translate(3 3)" fill="#b98047"/>
    <path d="${main}" fill="url(#${id}-canvas)"/>
    <path d="M155 35Q148 81 110 119L102 121Q140 78 155 35Z" fill="#fff0b9"/>
    <path d="M156 53Q151 91 140 110Q153 116 170 129Q159 89 156 53Z" fill="#dca763" opacity=".56"/>
    <path d="M154 51q-6 38-26 64m27-54q-1 33-7 53M154 114l11 10" fill="none" stroke="#d8a467" stroke-width="1.4"/>
    <path d="M153 53q-6 38-26 61m31-45q.3 27 4.5 49" fill="none" stroke="#fff1c0" stroke-width="1.5"/>
    <path d="${main}" fill="url(#${id}-grain)"/>
    <path d="M96 122q37-6 74 8" fill="none" stroke="#ad7b46" stroke-width="3.2"/>
    <path d="M85 126q34 8 72 6 50 1 80-14l-4 8q-71 37-148 4Z" fill="#b98453"/>
    <path d="${hull}" fill="url(#${id}-rim)"/>
    <path d="M80 125q35 14 77 13.5 43-.4 82-20l-4 7q-33 21-76 22-43 1-72-13Z" fill="${painted ? '#639e99' : '#ffda90'}"/>
    <path d="M89 135q67 30 140-1m-131 11q57 26 119-.6m-105 9q42 13 83 .7" fill="none" stroke="#a77040" stroke-width="1.5" opacity=".82"/>
    <path d="M102 145.5q21 8 45 9.5m34-2 20-4.2" fill="none" stroke="#f4cb89" stroke-width="1.3"/>
    <path d="${hull}" fill="url(#${id}-grain)"/>
    <path d="m226 126 13-12 3 .7-4.7 10Z" fill="#edc187"/>
  </g>`;
}

function cutter(id: string): string {
  return plinth(id) + `<ellipse cx="167" cy="163" rx="86" ry="12" fill="url(#${id}-shadow)"/>
    <g transform="translate(-14 -1) scale(1.09)">${sailboat(id)}</g>
    <path d="M76 163q20 5 37 1-10 8-2 11-23-1-35-12Zm102 8q33 0 55-12-9 11-31 15Z" fill="#e5b171"/>
    <path d="M78 163q19 3 35 .8m69 7q29-.6 49-10m-13 17 9-2" fill="none" stroke="#ffebae" stroke-width="2.3" stroke-linecap="round"/>
    ${pebble(77, 173, .48)}${pebble(251, 166, .54)}`;
}

function palm(x: number, y: number, scale: number, lean: number): string {
  const leaves = [-21, 8, 35, 58];
  // The two asymmetric fans have individually split leaf tips.
  const fan = leaves.map((rotation, i) => `<g transform="rotate(${rotation}) scale(${1 - i * .045})">
    <path d="M0 0Q17-20 49-11L42-9l-8 1 3-3-8 4-6 1 1-3-9 4-8 2Z" fill="${i % 2 ? '#538c79' : '#357e75'}"/>
    <path d="M1-.2q20-13 44-10.9" fill="none" stroke="#91ad78" stroke-width="1.2"/>
  </g>`).join('');
  return `<g transform="translate(${x} ${y}) scale(${scale}) rotate(${lean})">
    <path d="M-3.5.5Q3-19-.5-45l4.5-.4Q8-25 3.6 0Z" fill="#936e49"/>
    <path d="M-3.4 0Q2.6-19-.5-45h2Q5-26-.9.5Z" fill="#e0b078"/>
    <path d="m0-7 4-1m-4-5 4.5-1m-3.5-5 4-1m-4-5 3.5-1" fill="none" stroke="#a57b4e" stroke-width="1.3"/>
    <g transform="translate(1 -44)">${fan}<g transform="scale(-.88 .87) rotate(-8)">${fan}</g>
      <path d="M0 1q-8-9-4-19l5 5 1 12Z" fill="#67926c"/><path d="M0 1q2-14 12-17l-2 6-4 4 1-3Z" fill="#4f8c71"/>
    </g>
  </g>`;
}

function keeperHouse(): string {
  return `<g stroke-linejoin="round">
    <path d="m103 155 29-16 29 8v27l-28 9-30-7Z" fill="#f5d89d"/>
    <path d="m133 156 28-10v28l-28 9Z" fill="#d8ae78"/>
    <path d="m97 155 18-19 30-8 21 15-33 14-17-15-13 17Z" fill="#c36c4c"/>
    <path d="m116 135 29-8 21 15.7-32.8 12Z" fill="#e79666"/>
    <path d="m125 133 20.4 15m-13.7-16.8 20 13.8m-12.8-15.6 19.7 13" fill="none" stroke="#f4b57e" stroke-width="1.4"/>
    <path d="m98 156 18-18.5 17 16 32-12.3" fill="none" stroke="#f3bc86" stroke-width="2.1"/>
    <path d="m113 177 .2-11q.3-5.7 4.6-5.8 4.3-.1 4.5 5.1v14.9Z" fill="#638a80"/>
    <path d="m142 160 9-3.2v9l-9 3Z" fill="#75a29a"/><path d="m146.5 159-1 9m-3.5-3.3 8.7-3.1" fill="none" stroke="#e9c38b" stroke-width="1"/>
  </g>`;
}

function harbor(id: string): string {
  const cliff = 'M37 185Q47 178 68 177L86 166 115 158 144 159 174 153 219 149 258 157 279 166 293 167 319 181 306 193 294 199 282 211 257 217 239 227 197 231 177 236 151 229 125 230 103 223 83 220 72 213 46 208Z';
  return `<g>
    <path d="M15 208q38-13 80-14 77-12 174 6 50 5 91 18l20 12-38 8-21 8-61 1-46 9-50-3-38-9-50-3-37-11-24-3Z" fill="#77bcae" opacity=".68"/>
    <path d="M33 212q75-26 189-10 55 7 107 17l-17 13-48 10-43-.3-49 6-50-10-51-4-38-12Z" fill="#4f9f9b" opacity=".61"/>
    <path d="M20 215q19-8 32-8m-8 16 30 5m13 6 25 1m96 12q28 0 47-5m21-2 14-2m64-13 17-.2m-349-3 10 1m92 20 12 2" fill="none" stroke="#c8e9ce" stroke-width="2.2" stroke-linecap="round"/>
    <path d="${cliff}" fill="#bc8054"/>
    <path d="m37 185 22 3 26 12 11 18-24-5-26-5Z" fill="#dca76f"/>
    <path d="m59 188 18-.6 31 7 20 17-3 18-22-7-20-18Z" fill="#e5b279"/>
    <path d="m108 194 26 4 3 16 14 15-26 1 3-18Z" fill="#c69160"/>
    <path d="m134 198 29-.6 15 12 5.6 18-6.6 8.6-26-7-14-15Z" fill="#e2ac71"/>
    <path d="m163 197 23 2 20-8 7 11-13 14-3 15-20 5 7-9-6-18Z" fill="#cb915d"/>
    <path d="m206 191 33-7 23-7-13 17-19 10-11 13-17 6-5 8 3-15 13-14Z" fill="#e4ac73"/>
    <path d="m262 177 29-2 28 6-13 12-12 6-12 12-25 6-18 10-20 2 11-12 18-11 15-16Z" fill="#cd9566"/>
    <path d="m82 203 13 8 3 5m39-10 13 7 10-.8m-3 13 7 1.6m20-17 9-3m61 1 14-7 5-6m9-4 8-4" fill="none" stroke="#f2c58a" stroke-width="1.5" stroke-linecap="round"/>
    <path d="${cliff}" fill="url(#${id}-grain)"/>
    <path d="M37 185Q48 177 68 177l18-11q15-8 31-9l27 2q22-7 37-6 23-7 39-4l38 8 21 9 14 1 26 14-30 1-28 5-20 1-23 8-22 1-20 7-29-3-21 .7-19-7-23-1-15-5Z" fill="url(#${id}-sand)"/>
    <path d="M44 184q9-5 25-6l17-10m4 23 16 2 18 6m153-14 17-3m-102 17 18-4" fill="none" stroke="#fff1bf" stroke-width="1.8" stroke-linecap="round"/>
    <ellipse cx="192" cy="178" rx="55" ry="10" fill="url(#${id}-shadow)"/>
    ${palm(98, 168, 1.08, -15)}${palm(121, 159, .64, 13)}${keeperHouse()}
    <g transform="translate(7 -14) scale(1.19)">${tower(id, true)}</g>
    <path d="m185 185 22-1 6 2-15 2-9 2-9-1Zm-8 6 16-1.4 5 1.6-12 3-14-.6Zm-9 5 13 .3 5 1.9-12 1.8-13-2Z" fill="#deab75"/>
    <path d="m183 185 23-1m-31 7 16-1.5m-25 6 13-.1" fill="none" stroke="#fff1be" stroke-width="1.5"/>
    ${pebble(250, 169, 1.4)}${pebble(265, 172, .72)}${pebble(79, 180, .73)}
    <path d="M261 216q28 3 50-.4 24-.5 56-11-12 14-34 20-34 6-72-8Z" fill="#448f92" opacity=".63"/>
    <g transform="translate(228 130) scale(.58)">${sailboat(id, true)}</g>
    <path d="M266 213q14 9 29 9m39 .3q19-3 28-9m-35 14 10-1.5" fill="none" stroke="#daeed5" stroke-width="2" stroke-linecap="round"/>
    <g fill="none" stroke="#457f81" stroke-width="2.2" stroke-linecap="round" opacity=".81">
      <path d="M249 59q7-2 11 3 2-8 10-11m-23 19q3.9-1 6.5 2 1-4.1 4.8-5.6M301 88q4.5-2 8 1.2 1.9-6.5 7.2-8.3"/>
    </g>
  </g>`;
}

export function mountMenuEmblems(): void {
  const sculptures = { shell, light: beacon, boat: cutter, harbor };
  const slots = document.querySelectorAll<HTMLElement>('.slot-sculpture[data-sculpture], .login-sculpture');
  slots.forEach((slot, index) => {
    const name = slot.classList.contains('login-sculpture') ? 'harbor' : slot.dataset.sculpture;
    if (slot.firstElementChild || (name !== 'shell' && name !== 'light' && name !== 'boat' && name !== 'harbor')) return;
    const id = `menu-sand-${name}-${index}`;
    const viewBox = name === 'harbor' ? '0 0 400 276' : '0 0 320 210';
    slot.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="100%" height="100%" aria-hidden="true" focusable="false">${materials(id)}${sculptures[name](id)}</svg>`;
  });
}

mountMenuEmblems();
