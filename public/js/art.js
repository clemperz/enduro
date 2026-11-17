// Dessins : Momo la marmotte (la mascotte-coach), les visages du ressenti et
// les pictogrammes. Tout est en SVG dessiné à la main, dans le même trait.

const INK = '#2A2630';
const FUR = '#C8925E';
const FUR_DARK = '#9F6C3F';
const CREAM = '#F5DDB8';
const PINK = '#F4978E';

const eyeOpen = (cx, px) => `
  <ellipse cx="${cx}" cy="98" rx="11" ry="13" fill="#fff" stroke="${INK}" stroke-width="4"/>
  <circle cx="${px}" cy="100" r="6" fill="${INK}"/><circle cx="${px + 2}" cy="97" r="2.2" fill="#fff"/>`;
const eyeWide = (cx) => `
  <ellipse cx="${cx}" cy="96" rx="13" ry="15" fill="#fff" stroke="${INK}" stroke-width="4"/>
  <circle cx="${cx}" cy="97" r="7.5" fill="${INK}"/><circle cx="${cx + 3}" cy="93" r="3" fill="#fff"/>`;
const eyeHalf = (cx) => `
  <ellipse cx="${cx}" cy="98" rx="11" ry="13" fill="#fff" stroke="${INK}" stroke-width="4"/>
  <circle cx="${cx}" cy="104" r="5.5" fill="${INK}"/>
  <path d="M${cx - 12} 98 A12 14 0 0 1 ${cx + 12} 98 Z" fill="${FUR}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`;
const eyeArc = (cx, up) => `<path d="M${cx - 11} ${up ? 102 : 95} Q${cx} ${up ? 88 : 108} ${cx + 11} ${up ? 102 : 95}" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;
const eyeCross = (cx) => `<path d="M${cx - 9} 89 l18 18 M${cx + 9} 89 l-18 18" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;

const EYES = {
  happy: eyeOpen(74, 77) + eyeOpen(126, 123),
  pumped: eyeWide(74) + eyeWide(126),
  tired: eyeHalf(74) + eyeHalf(126),
  ko: eyeCross(74) + eyeCross(126),
  sleep: eyeArc(74, false) + eyeArc(126, false),
  proud: eyeArc(74, true) + eyeArc(126, true),
};

const TEETH = `<path d="M91 131 h18 v11 q0 4 -4 4 h-10 q-4 0 -4 -4 z" fill="#fff" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><path d="M100 132 v13" stroke="${INK}" stroke-width="2.5"/>`;
const MOUTHS = {
  happy: `<path d="M82 128 Q100 144 118 128" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>${TEETH}`,
  pumped: `<path d="M80 126 Q100 158 120 126 Z" fill="#8C3030" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M91 127 h18 v9 q0 3 -3 3 h-12 q-3 0 -3 -3 z" fill="#fff" stroke="${INK}" stroke-width="3"/><path d="M100 128 v10" stroke="${INK}" stroke-width="2.5"/>`,
  tired: `<path d="M86 134 Q100 128 114 134" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><path d="M98 133 q5 14 12 2" fill="${PINK}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`,
  ko: `<path d="M84 134 q5 -8 10 0 t11 0 t11 0" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
  sleep: `<ellipse cx="100" cy="134" rx="6" ry="7" fill="#8C3030" stroke="${INK}" stroke-width="3.5"/>`,
  proud: `<path d="M80 126 Q100 148 120 126" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>${TEETH}`,
};

const HEADBAND = `<path d="M35 82 C60 58 140 58 165 82 L164 68 C140 44 60 44 36 68 Z" fill="#E8504F" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M164 72 l20 -8 l-4 14 l14 4 l-22 6 z" fill="#E8504F" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`;
const NIGHTCAP = `<path d="M38 70 C52 26 112 6 150 30 C172 44 180 70 182 92 C176 80 168 70 160 66 C122 46 76 50 38 70 Z" fill="#5DB7EA" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M36 72 C70 48 130 48 164 72" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/>
  <path d="M36 72 C70 48 130 48 164 72" fill="none" stroke="${INK}" stroke-width="3" stroke-dasharray="1 9" stroke-linecap="round"/>
  <circle cx="184" cy="100" r="11" fill="#fff" stroke="${INK}" stroke-width="4"/>`;
const SWEAT = `<path d="M170 56 q10 14 0 22 q-10 -8 0 -22z" fill="#5DB7EA" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M26 64 q7 10 0 16 q-7 -6 0 -16z" fill="#5DB7EA" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`;
const ZZZ = `<g fill="${INK}" font-family="'Chalkboard SE','Marker Felt','Comic Sans MS',cursive" font-weight="700">
  <text x="168" y="46" font-size="26">z</text><text x="184" y="26" font-size="19">z</text><text x="196" y="12" font-size="13">z</text></g>`;
const SPARK = (x, y, s = 1) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -11 L3 -3 L11 0 L3 3 L0 11 L-3 3 L-11 0 L-3 -3 Z" fill="#F7C948" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`;
const STARS = SPARK(22, 40, 1.1) + SPARK(182, 34, 0.9) + SPARK(190, 120, 0.7);
const MEDAL = `<path d="M84 150 L100 186 L116 150" fill="none" stroke="#E8504F" stroke-width="7" stroke-linejoin="round"/>
  <circle cx="100" cy="190" r="13" fill="#F7C948" stroke="${INK}" stroke-width="4"/><path d="M100 183 v14 M93 190 h14" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
const STARS_KO = `<g fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"><path d="M30 38 q10 -12 20 0 q-10 12 -20 0"/><path d="M150 30 q10 -12 20 0 q-10 12 -20 0"/></g>`;

const EXTRAS = {
  happy: HEADBAND,
  pumped: HEADBAND + STARS,
  tired: HEADBAND + SWEAT,
  ko: STARS_KO,
  sleep: NIGHTCAP + ZZZ,
  proud: HEADBAND + MEDAL + SPARK(24, 44, 1),
};

/** Momo la marmotte. Humeurs : happy, pumped, tired, ko, sleep, proud. */
export function momo(mood = 'happy', size = 120) {
  const m = EYES[mood] ? mood : 'happy';
  return `<svg class="momo" viewBox="0 0 210 212" width="${size}" height="${size}" role="img" aria-label="Momo la marmotte">
  <circle cx="48" cy="54" r="17" fill="${FUR}" stroke="${INK}" stroke-width="5"/><circle cx="48" cy="54" r="8" fill="${FUR_DARK}"/>
  <circle cx="152" cy="54" r="17" fill="${FUR}" stroke="${INK}" stroke-width="5"/><circle cx="152" cy="54" r="8" fill="${FUR_DARK}"/>
  <path d="M36 216 C30 172 60 150 100 150 C140 150 170 172 164 216 Z" fill="${FUR}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
  <path d="M68 216 C64 188 82 174 100 174 C118 174 136 188 132 216 Z" fill="${CREAM}"/>
  <path d="M100 36 C142 36 168 64 168 100 C168 138 140 162 100 162 C60 162 32 138 32 100 C32 64 58 36 100 36 Z" fill="${FUR}" stroke="${INK}" stroke-width="5"/>
  <ellipse cx="100" cy="128" rx="38" ry="27" fill="${CREAM}"/>
  <circle cx="55" cy="122" r="10" fill="${PINK}" opacity=".8"/><circle cx="145" cy="122" r="10" fill="${PINK}" opacity=".8"/>
  ${EYES[m]}
  <ellipse cx="100" cy="116" rx="10" ry="7" fill="${INK}"/><ellipse cx="97" cy="114" rx="3" ry="1.6" fill="#fff" opacity=".6"/>
  ${MOUTHS[m]}
  ${EXTRAS[m]}
</svg>`;
}

/** Visages du ressenti (1 = cuit … 5 = au top). */
export function face(v, color, size = 44) {
  const eyes = {
    1: `<path d="M13 16 l6 6 M19 16 l-6 6 M29 16 l6 6 M35 16 l-6 6" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`,
    2: `<path d="M12 20 h8 M28 20 h8" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`,
    3: `<circle cx="16" cy="19" r="2.6" fill="${INK}"/><circle cx="32" cy="19" r="2.6" fill="${INK}"/>`,
    4: `<circle cx="16" cy="19" r="2.8" fill="${INK}"/><circle cx="32" cy="19" r="2.8" fill="${INK}"/>`,
    5: `<path d="M11 21 q5 -8 10 0 M27 21 q5 -8 10 0" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>`,
  }[v];
  const mouth = {
    1: `<path d="M15 35 q9 -9 18 0" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>`,
    2: `<path d="M16 33 q8 -5 16 0" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>`,
    3: `<path d="M16 32 h16" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>`,
    4: `<path d="M15 30 q9 8 18 0" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>`,
    5: `<path d="M13 28 q11 16 22 0 z" fill="#fff" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`,
  }[v];
  return `<svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true">
  <circle cx="24" cy="24" r="20" fill="${color}" stroke="${INK}" stroke-width="3"/>${eyes}${mouth}</svg>`;
}

const ICONS = {
  bike: `<circle cx="6" cy="16.5" r="4.2"/><circle cx="18" cy="16.5" r="4.2"/><path d="M6 16.5 L10 8.5 h5 M9 8.5 h-2 M10 8.5 l4.5 8 M14.5 16.5 L16.5 8.5 l1.5 8 M15.5 6 h3"/>`,
  run: `<circle cx="15.5" cy="4.5" r="2.1"/><path d="M8.5 9.5 l4 -2 l3 2.5 l3.5 1 M12.5 7.5 l-1.5 5.5 l3.5 2.5 l-1 5 M11 13 l-3 3.5 l-4 .5"/>`,
  other: `<path d="M4 12 h3 l2 -5 l4 10 l2 -5 h5"/>`,
  rest: `<path d="M19 13.5 A7.5 7.5 0 1 1 10.5 5 A6 6 0 0 0 19 13.5 Z"/><path d="M15 4 h4 l-4 4 h4" stroke-width="1.6"/>`,
  check: `<path d="M5 12.5 l4.5 4.5 L19 7.5"/>`,
  close: `<path d="M6 6 l12 12 M18 6 L6 18"/>`,
  clock: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5 V12 l3 2"/>`,
  flame: `<path d="M12 3 c1 4 5 5.5 5 10 a5 5 0 0 1 -10 0 c0 -2 1 -3 2 -4 c.5 1.5 1.5 2 2 2 c-1 -3 0 -6 1 -8 z"/>`,
  bolt: `<path d="M13 3 L5 13.5 h6 l-1 7.5 l8 -10.5 h-6 z"/>`,
  heart: `<path d="M12 20 C4 14 3 9.5 5.5 7 C8 4.5 11 6 12 8 C13 6 16 4.5 18.5 7 C21 9.5 20 14 12 20 Z"/>`,
  flag: `<path d="M6 21 V4 M6 5 c4 -2 6 2 11 0 v8 c-5 2 -7 -2 -11 0"/>`,
  mountain: `<path d="M2.5 19 L9 7.5 l4 6.5 l2.5 -3.5 L21.5 19 Z"/>`,
  eye: `<path d="M2.5 12 C5 7 8.5 5 12 5 s7 2 9.5 7 c-2.5 5 -6 7 -9.5 7 s-7 -2 -9.5 -7 z"/><circle cx="12" cy="12" r="3"/>`,
  book: `<path d="M12 6 C10 4.5 7 4 4 4.5 V19 c3 -.5 6 0 8 1.5 c2 -1.5 5 -2 8 -1.5 V4.5 c-3 -.5 -6 0 -8 1.5 z M12 6 v14.5"/>`,
  shoe: `<path d="M3 17.5 v-6 l4 1 l2 -4 l3 4 l6 2.5 c2 .8 3 1.5 3 2.5 z M3 17.5 h18"/>`,
  gear: `<circle cx="12" cy="12" r="3.2"/><path d="M12 3 v2.5 M12 18.5 V21 M3 12 h2.5 M18.5 12 H21 M5.6 5.6 l1.8 1.8 M16.6 16.6 l1.8 1.8 M5.6 18.4 l1.8 -1.8 M16.6 7.4 l1.8 -1.8"/>`,
  plus: `<path d="M12 5 v14 M5 12 h14"/>`,
  minus: `<path d="M5 12 h14"/>`,
  left: `<path d="M14.5 5 L7.5 12 l7 7"/>`,
  right: `<path d="M9.5 5 l7 7 l-7 7"/>`,
  upload: `<path d="M12 16 V5 M7.5 9 L12 4.5 L16.5 9 M5 19.5 h14"/>`,
  download: `<path d="M12 4.5 V15.5 M7.5 11 L12 15.5 L16.5 11 M5 19.5 h14"/>`,
  sync: `<path d="M19 8 A8 8 0 0 0 5 9 M5 16 a8 8 0 0 0 14 -1 M19 4 v4 h-4 M5 20 v-4 h4"/>`,
  trash: `<path d="M5 7 h14 M9.5 7 V4.5 h5 V7 M7 7 l1 13 h8 l1 -13 M10 11 v5 M14 11 v5"/>`,
  screen: `<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20 h7 M12 16.5 V20"/>`,
  swap: `<path d="M4 8 h14 l-3.5 -3.5 M20 16 H6 l3.5 3.5"/>`,
  feather: `<path d="M19.5 4.5 c-7 0 -12 4 -13 11 l-2 4 M6.5 15.5 c5 0 9 -2 11 -6 M9 12 h6"/>`,
  info: `<circle cx="12" cy="12" r="8.5"/><path d="M12 11 v5.5 M12 7.6 v.2"/>`,
  target: `<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>`,
};

export function icon(name, size = 22) {
  return `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;
}

export const sportIcon = (sport, size) => icon(sport === 'bike' ? 'bike' : sport === 'run' ? 'run' : 'other', size);
export const SPORT_LABEL = { bike: 'Vélo', run: 'Course à pied', other: 'Autre' };
