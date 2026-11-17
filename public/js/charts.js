// Graphiques dessinés en SVG, dans le même trait que le reste.

import { flatten } from '../engine/workouts.js';
import { ZONE_BY_ID } from '../engine/zones.js';
import { FORM_ZONES } from '../engine/load.js';
import { PHASES } from '../engine/plan.js';
import { PPR_DURATIONS, PPR_LABELS } from '../engine/power.js';
import { fmtShort } from '../engine/dates.js';

const INK = '#2A2630';
const HAND = "'Chalkboard SE','Marker Felt','Comic Sans MS',cursive";
const r1 = (v) => Math.round(v * 10) / 10;

/** Profil d'une séance : un bloc par étape, hauteur = intensité, couleur = zone. */
export function workoutChart(session, { height = 96 } = {}) {
  const segs = flatten(session.steps ?? []);
  const total = segs.reduce((t, s) => t + s.sec, 0);
  if (!total) return '';
  const width = 600;
  const top = session.sport === 'run' ? 1.1 : 1.15;
  const base = height - 3;
  const y = (pct) => base - Math.min(1, Math.max(0.14, pct / top)) * (height - 10);
  // Largeur minimale pour que les sprints restent visibles.
  const raw = segs.map((s) => Math.max(3.5, (s.sec / total) * width));
  const scale = width / raw.reduce((a, b) => a + b, 0);
  let x = 0;
  const parts = segs.map((s, i) => {
    const w = raw[i] * scale;
    const zone = ZONE_BY_ID[s.zone] ?? ZONE_BY_ID.i1;
    const d = `M${r1(x)} ${base} L${r1(x)} ${r1(y(s.pct))} L${r1(x + w)} ${r1(y(s.pctEnd ?? s.pct))} L${r1(x + w)} ${base} Z`;
    const hatch = s.kind === 'free' ? ` fill="url(#hatch-${zone.id})"` : ` fill="${zone.color}"`;
    x += w;
    return `<path d="${d}"${hatch} stroke="${INK}" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
  });
  const hatches = ['i4', 'i5'].map((id) => `<pattern id="hatch-${id}" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="8" height="8" fill="${ZONE_BY_ID[id].color}"/><rect width="3" height="8" fill="#fff" opacity=".55"/></pattern>`).join('');
  return `<svg class="wchart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" width="100%" height="${height}" aria-hidden="true">
  <defs>${hatches}</defs>
  <path d="M0 ${base} H${width}" stroke="${INK}" stroke-width="2" vector-effect="non-scaling-stroke"/>${parts.join('')}</svg>`;
}

/**
 * Le profil du plan, façon profil d'étape : une bosse par semaine (hauteur =
 * charge prévue), couleur = phase, descente = semaine de récup.
 */
export function planProfile(weeks, currentStart) {
  if (!weeks.length) return '';
  const W = 720;
  const H = 190;
  const base = 140;
  const loads = weeks.map((w) => w.sessions.reduce((s, x) => s + (x.load || 0), 0));
  const max = Math.max(...loads, 1);
  const hgt = (l) => base - 14 - (l / max) * 92;
  const step = W / weeks.length;
  const mid = (i) => (i < 0 ? hgt(loads[0]) + 18 : i >= weeks.length - 1 ? hgt(loads[weeks.length - 1]) + 10 : (hgt(loads[i]) + hgt(loads[i + 1])) / 2 + 9);
  const hills = weeks.map((w, i) => {
    const x0 = i * step;
    const xc = x0 + step / 2;
    const x1 = x0 + step;
    const color = PHASES[w.info.phase]?.color ?? '#B9C6D2';
    return `<path d="M${r1(x0)} ${base} L${r1(x0)} ${r1(mid(i - 1))} L${r1(xc)} ${r1(hgt(loads[i]))} L${r1(x1)} ${r1(mid(i))} L${r1(x1)} ${base} Z" fill="${color}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>`;
  });
  // Étiquettes de phase : une par bloc de semaines consécutives.
  const labels = [];
  let start = 0;
  for (let i = 1; i <= weeks.length; i++) {
    if (i === weeks.length || weeks[i].info.phase !== weeks[start].info.phase) {
      const cx = ((start + i) / 2) * step;
      const span = (i - start) * step;
      const ph = PHASES[weeks[start].info.phase];
      // Le plus long libellé qui tient dans la largeur de la phase (largeur estimée ≈ 0,58 em par lettre).
      const fits = (t, size) => t.length * size * 0.58 <= span - 6;
      let text = '';
      let size = 15;
      for (const [t, sz] of [[ph.label, 15], [ph.short, 15], [ph.short, 12], [ph.tiny, 12]]) {
        if (t && fits(t, sz)) { text = t; size = sz; break; }
      }
      if (text) labels.push(`<text x="${r1(cx)}" y="${base + 22}" text-anchor="middle" font-family="${HAND}" font-size="${size}" font-weight="700" fill="${INK}">${text}</text>`);
      if (i < weeks.length) labels.push(`<path d="M${r1(i * step)} ${base + 6} v22" stroke="${INK}" stroke-width="2" stroke-dasharray="3 4"/>`);
      start = i;
    }
  }
  const cur = weeks.findIndex((w) => w.weekStart === currentStart);
  let here = '';
  if (cur >= 0) {
    const cx = cur * step + step / 2;
    const cy = hgt(loads[cur]);
    here = `<g><path d="M${r1(cx)} ${r1(cy)} v-22" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M${r1(cx)} ${r1(cy - 22)} l20 6 l-20 7 z" fill="#F2603A" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
      <text x="${r1(cx < W - 110 ? cx + 26 : cx - 8)}" y="${r1(cy - 11)}" text-anchor="${cx < W - 110 ? 'start' : 'end'}" font-family="${HAND}" font-size="15" font-weight="700" fill="${INK}" stroke="#FFFDF7" stroke-width="4" paint-order="stroke">tu es ici</text></g>`;
  }
  // Un drapeau par course : damier pour un objectif majeur, fanion pour une étape.
  let goal = '';
  let lastLabelX = -Infinity;
  weeks.forEach((w, i) => {
    for (const race of w.info.races ?? []) {
      const gx = i * step + step / 2;
      const gy = hgt(loads[i]);
      const top = Math.max(18, gy - (race.major ? 34 : 26));
      const pole = `<path d="M${r1(gx)} ${r1(gy)} V${r1(top)}" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`;
      const flag = race.major
        ? `<path d="M${r1(gx)} ${r1(top)} h-24 v15 h24 z" fill="#fff" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M${r1(gx - 24)} ${r1(top)} h8 v7.5 h-8 z M${r1(gx - 16)} ${r1(top + 7.5)} h8 v7.5 h-8 z M${r1(gx - 8)} ${r1(top)} h8 v7.5 h-8 z" fill="${INK}"/>`
        : `<path d="M${r1(gx)} ${r1(top)} l-17 6 l17 6 z" fill="#F7C948" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>`;
      // Le nom, à droite du mât tant qu'il y a la place (à gauche sinon), et seulement s'il ne recouvre pas le précédent.
      const name = String(race.name ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const width = name.length * 7.6;
      const anchorEnd = gx - 2 + width > W - 4;
      const x0 = anchorEnd ? gx + 4 - width : gx - 2;
      // Course de la semaine en cours : le nom passe au-dessus de « tu es ici ».
      const lift = i === cur ? 20 : 0;
      let label = '';
      if (name && x0 > lastLabelX + 6) {
        label = `<text x="${r1(anchorEnd ? gx + 4 : gx - 2)}" y="${r1(Math.max(12, top - 6 - lift))}" text-anchor="${anchorEnd ? 'end' : 'start'}" font-family="${HAND}" font-size="14" font-weight="700" fill="${INK}" stroke="#FFFDF7" stroke-width="4" paint-order="stroke">${name}</text>`;
        lastLabelX = x0 + width;
      }
      goal += `<g>${pole}${flag}${label}</g>`;
    }
  });
  const ticks = weeks.map((w, i) => (weeks.length <= 16 || i % 2 === 0
    ? `<text x="${r1(Math.min(W - 18, i * step + step / 2))}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#6A6272">${fmtShort(w.weekStart).replace('.', '')}</text>` : '')).join('');
  return `<svg class="pchart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Profil du plan semaine par semaine">
  ${hills.join('')}<path d="M0 ${base} H${W}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>${labels.join('')}${ticks}${goal}${here}</svg>`;
}

const polar = (cx, cy, r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
};

/** Cadran de fraîcheur : de « dans le rouge » (gauche) à « très frais » (droite). */
export function formGauge(ratio) {
  const lo = -0.5;
  const hi = 0.35;
  const ang = (v) => 180 - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 180;
  const cx = 130;
  const cy = 128;
  const r = 100;
  let from = lo;
  const arcs = FORM_ZONES.map((z) => {
    const to = Math.min(hi, z.max);
    const [x0, y0] = polar(cx, cy, r, ang(from));
    const [x1, y1] = polar(cx, cy, r, ang(to));
    from = to;
    return `<path d="M${r1(x0)} ${r1(y0)} A${r} ${r} 0 0 1 ${r1(x1)} ${r1(y1)}" fill="none" stroke="${z.color}" stroke-width="26"/>`;
  });
  const [ox0, oy0] = polar(cx, cy, r + 13, 180);
  const [ox1, oy1] = polar(cx, cy, r + 13, 0);
  const [ix0, iy0] = polar(cx, cy, r - 13, 180);
  const [ix1, iy1] = polar(cx, cy, r - 13, 0);
  const [nx, ny] = polar(cx, cy, r - 6, ang(ratio));
  return `<svg class="gauge" viewBox="0 0 260 146" width="100%" role="img" aria-label="Cadran de fraîcheur">
  ${arcs.join('')}
  <path d="M${r1(ox0)} ${r1(oy0)} A${r + 13} ${r + 13} 0 0 1 ${r1(ox1)} ${r1(oy1)} L${r1(ix1)} ${r1(iy1)} A${r - 13} ${r - 13} 0 0 0 ${r1(ix0)} ${r1(iy0)} Z" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M${cx} ${cy} L${r1(nx)} ${r1(ny)}" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
  <circle cx="${cx}" cy="${cy}" r="11" fill="#fff" stroke="${INK}" stroke-width="4"/></svg>`;
}

/** Volume par semaine : barres empilées vélo / course / autre, tiret = volume prévu. */
export function weekBars(history, plannedByWeek = {}) {
  const W = 560;
  const H = 190;
  const base = 150;
  const n = history.length;
  const max = Math.max(60, ...history.map((w) => Math.max(w.min, plannedByWeek[w.monday] ?? 0)));
  const step = W / n;
  const bw = Math.min(46, step * 0.62);
  const sc = (m) => (m / max) * 120;
  const colors = { bike: '#5DB7EA', run: '#F68D3F', other: '#B9C6D2' };
  const bars = history.map((w, i) => {
    const x = i * step + (step - bw) / 2;
    let y = base;
    const rects = ['bike', 'run', 'other'].map((k) => {
      const h = sc(w[k]);
      if (h < 0.5) return '';
      y -= h;
      return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(bw)}" height="${r1(h)}" fill="${colors[k]}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/>`;
    }).join('');
    const planned = plannedByWeek[w.monday];
    const tick = planned ? `<path d="M${r1(x - 5)} ${r1(base - sc(planned))} h${r1(bw + 10)}" stroke="${INK}" stroke-width="2.4" stroke-dasharray="5 4" stroke-linecap="round"/>` : '';
    const hours = w.min >= 30 ? `<text x="${r1(x + bw / 2)}" y="${r1(base - sc(w.min) - 7)}" text-anchor="middle" font-family="${HAND}" font-size="14" font-weight="700" fill="${INK}">${Math.floor(w.min / 60)}h${String(Math.round(w.min % 60)).padStart(2, '0')}</text>` : '';
    const label = `<text x="${r1(x + bw / 2)}" y="${base + 18}" text-anchor="middle" font-size="11.5" fill="#6A6272">${fmtShort(w.monday).replace('.', '')}</text>`;
    return rects + tick + hours + label;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Volume d’entraînement par semaine">
  <path d="M0 ${base} H${W}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>${bars}</svg>`;
}

/** Condition (trait épais) et fatigue (trait fin) sur les dernières semaines. */
export function fitnessLines(rows) {
  if (rows.length < 2) return '';
  const W = 560;
  const H = 170;
  const padL = 8;
  const base = 140;
  const max = Math.max(20, ...rows.map((r) => Math.max(r.ctl, r.atl))) * 1.1;
  const x = (i) => padL + (i / (rows.length - 1)) * (W - padL * 2);
  const y = (v) => base - (v / max) * 120;
  const line = (key) => rows.map((r, i) => `${i ? 'L' : 'M'}${r1(x(i))} ${r1(y(r[key]))}`).join(' ');
  const last = rows[rows.length - 1];
  // Une étiquette par semaine ; la première est calée à gauche pour ne pas être rognée.
  const ticks = rows.map((r, i) => (i % 7 === 0 ? `<text x="${r1(x(i))}" y="${base + 18}" text-anchor="${i === 0 ? 'start' : 'middle'}" font-size="11.5" fill="#6A6272">${fmtShort(r.date).replace('.', '')}</text>` : '')).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Évolution de la condition et de la fatigue">
  <path d="${line('ctl')} L${r1(x(rows.length - 1))} ${base} L${padL} ${base} Z" fill="#5DB7EA" opacity=".25"/>
  <path d="${line('atl')}" fill="none" stroke="#F2603A" stroke-width="2.6" stroke-linejoin="round" stroke-dasharray="2 5" stroke-linecap="round"/>
  <path d="${line('ctl')}" fill="none" stroke="#1F6FA3" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${r1(x(rows.length - 1))}" cy="${r1(y(last.ctl))}" r="6" fill="#fff" stroke="#1F6FA3" stroke-width="4"/>
  <path d="M0 ${base} H${W}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>${ticks}</svg>`;
}

/** VFC de nuit : un point par nuit, la moyenne sur 7 nuits, et la bande de ta normale. */
export function hrvChart(rows, base = null) {
  const vals = rows.flatMap((r) => [r.value, r.trend]).filter((v) => v != null);
  if (vals.length < 3 || rows.length < 2) return '';
  const W = 560;
  const H = 170;
  const padL = 8;
  const bottom = 140;
  const lo = Math.min(...vals, base?.low ?? Infinity) * 0.85;
  const hi = Math.max(...vals, base?.high ?? 0) * 1.08;
  const x = (i) => padL + (i / (rows.length - 1)) * (W - padL * 2);
  const y = (v) => bottom - ((v - lo) / (hi - lo)) * 125;
  const band = base
    ? `<rect x="${padL}" y="${r1(y(base.high))}" width="${W - padL * 2}" height="${r1(Math.max(2, y(base.low) - y(base.high)))}" rx="6" fill="#5CC98A" opacity=".22"/>`
    : '';
  let trend = '';
  rows.forEach((r, i) => {
    if (r.trend == null) return;
    trend += `${i && rows[i - 1].trend != null ? 'L' : 'M'}${r1(x(i))} ${r1(y(r.trend))} `;
  });
  const dots = rows.map((r, i) => (r.value == null ? '' : `<circle cx="${r1(x(i))}" cy="${r1(y(r.value))}" r="3.6" fill="#5DB7EA" stroke="${INK}" stroke-width="1.2"/>`)).join('');
  const ticks = rows.map((r, i) => (i % 7 === 0 ? `<text x="${r1(x(i))}" y="${bottom + 18}" text-anchor="${i === 0 ? 'start' : 'middle'}" font-size="11.5" fill="#6A6272">${fmtShort(r.date).replace('.', '')}</text>` : '')).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Variabilité de la fréquence cardiaque, nuit par nuit">
  ${band}${dots}
  <path d="${trend.trim()}" fill="none" stroke="#1F6FA3" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
  <path d="M0 ${bottom} H${W}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>${ticks}</svg>`;
}

/** Profil de Puissance Record : meilleure puissance par durée. */
export function pprChart(ppr, weightKg = null) {
  const items = PPR_DURATIONS.filter((d) => ppr[d]).map((d) => ({ d, ...ppr[d] }));
  if (!items.length) return '';
  const zoneOf = { 5: 'i7', 30: 'i6', 60: 'i6', 300: 'i5', 1200: 'i4', 3600: 'i3' };
  const W = 560;
  const H = 200;
  const base = 160;
  const max = Math.max(...items.map((i) => i.watts));
  const step = W / items.length;
  const bw = Math.min(64, step * 0.6);
  const bars = items.map((it, i) => {
    const x = i * step + (step - bw) / 2;
    const h = Math.max(8, (it.watts / max) * 112);
    const wkg = weightKg ? `<text x="${r1(x + bw / 2)}" y="${r1(base - h + 17)}" text-anchor="middle" font-size="11" fill="${INK}">${(it.watts / weightKg).toFixed(1)} W/kg</text>` : '';
    return `<rect x="${r1(x)}" y="${r1(base - h)}" width="${r1(bw)}" height="${r1(h)}" rx="5" fill="${ZONE_BY_ID[zoneOf[it.d]].color}" stroke="${INK}" stroke-width="2.4"/>
      <text x="${r1(x + bw / 2)}" y="${r1(base - h - 8)}" text-anchor="middle" font-family="${HAND}" font-size="17" font-weight="700" fill="${INK}">${it.watts} W</text>${h > 30 ? wkg : ''}
      <text x="${r1(x + bw / 2)}" y="${base + 19}" text-anchor="middle" font-family="${HAND}" font-size="14" font-weight="700" fill="${INK}">${PPR_LABELS[it.d]}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Profil de puissance record">
  <path d="M0 ${base} H${W}" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>${bars}</svg>`;
}
