// La VFC d'un ECG de 30 secondes (fait avec la montre). On retrouve chaque
// battement (le pic R du tracé), on mesure l'intervalle entre deux battements
// (« RR », en millisecondes), puis le RMSSD : la racine de la moyenne des carrés
// des différences entre deux intervalles successifs. C'est le même indice que
// celui de la VFC de nuit, et celui des applis de VFC du matin.
//
// 30 secondes, c'est court : la valeur d'un matin est bruitée, et c'est la
// moyenne sur 7 matins qui compte (Esco et Flatt 2014 ; Nakamura et coll. 2015).
// D'où une mesure toujours faite dans les mêmes conditions.

/** Il faut au moins 10 couples d'intervalles propres pour un RMSSD. */
export const MIN_PAIRS = 10;
/** Au-delà de 20 % d'intervalles écartés, la mesure est à refaire. */
export const MAX_REJECT = 0.2;
/** Un intervalle à plus de 25 % de la médiane : battement prématuré, oublié ou parasite. */
export const RR_TOLERANCE = 0.25;

const odd = (n) => Math.max(1, Math.round(n) | 1);

/** Moyenne glissante centrée sur `w` points (w impair) : ne décale pas le signal. */
function smooth(x, w) {
  const n = x.length;
  const c = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) c[i + 1] = c[i] + x[i];
  const h = (w - 1) / 2;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - h);
    const hi = Math.min(n, i + h + 1);
    out[i] = (c[hi] - c[lo]) / (hi - lo);
  }
  return out;
}

const median = (values) => {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

function quantile(values, q) {
  const v = Float64Array.from(values).sort();
  return v[Math.min(v.length - 1, Math.max(0, Math.round(q * (v.length - 1))))];
}

/**
 * Instants des battements (en secondes) dans un ECG à une dérivation.
 * Méthode de Pan et Tompkins simplifiée : on garde les fréquences du QRS,
 * on prend la pente au carré, on l'intègre sur la durée d'un QRS, puis on
 * cherche les bosses qui dépassent un seuil. Le pic R est ensuite placé
 * au point le plus haut du tracé (au dixième d'échantillon près).
 *
 * @param {ArrayLike<number>} signal  le tracé, à pas de temps régulier
 * @param {number} fs  échantillons par seconde
 */
export function detectBeats(signal, fs) {
  const x = Float64Array.from(signal);
  const n = x.length;
  if (n < fs * 5) return [];
  // Ligne de base retirée (respiration, contact du doigt qui bouge).
  const base = smooth(smooth(x, odd(0.6 * fs)), odd(0.6 * fs));
  const z = x.map((v, i) => v - base[i]);
  // Bande du QRS (≈ 5–20 Hz) : différence de deux moyennes glissantes.
  const lo = smooth(z, odd(0.025 * fs));
  const band = smooth(z, odd(0.15 * fs)).map((v, i) => lo[i] - v);
  // Énergie de la pente, intégrée sur ≈ 120 ms.
  const slope = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) slope[i] = (band[i + 1] - band[i - 1]) ** 2;
  const energy = smooth(slope, odd(0.12 * fs));

  // Bosses de l'énergie, la plus haute d'abord, à 300 ms au moins l'une de l'autre.
  const refractory = Math.round(0.3 * fs);
  const bumps = [];
  for (let i = 1; i < n - 1; i++) if (energy[i] > energy[i - 1] && energy[i] >= energy[i + 1]) bumps.push(i);
  const pick = (candidates, threshold) => {
    const kept = [];
    for (const i of [...candidates].sort((a, b) => energy[b] - energy[a])) {
      if (energy[i] < threshold) break;
      if (kept.every((k) => Math.abs(k - i) >= refractory)) kept.push(i);
    }
    return kept.sort((a, b) => a - b);
  };
  // Seuil : 30 % de la hauteur typique d'un QRS (les ondes T, plus lentes, restent dessous).
  const ref = quantile(pick(bumps, 0).map((i) => energy[i]), 0.8);
  let qrs = pick(bumps, 0.3 * ref);

  // Un trou deux fois plus long qu'un battement normal : un QRS plus petit a été raté.
  if (qrs.length > 3) {
    const rr = median(qrs.slice(1).map((v, i) => v - qrs[i]));
    for (let k = qrs.length - 1; k > 0; k--) {
      if (qrs[k] - qrs[k - 1] > 1.6 * rr) {
        const inside = bumps.filter((i) => i > qrs[k - 1] + refractory && i < qrs[k] - refractory);
        const found = pick(inside, 0.12 * ref);
        if (found.length) qrs.splice(k, 0, ...found);
      }
    }
  }

  // Sens du tracé : selon le poignet, les pics R peuvent pointer vers le bas.
  const win = Math.round(0.08 * fs);
  const extremes = qrs.map((c) => {
    let hi = -Infinity;
    let low = Infinity;
    for (let i = Math.max(0, c - win); i <= Math.min(n - 1, c + win); i++) { hi = Math.max(hi, z[i]); low = Math.min(low, z[i]); }
    return hi + low;
  });
  const sign = median(extremes) >= 0 ? 1 : -1;

  const times = [];
  for (const c of qrs) {
    let best = c;
    for (let i = Math.max(1, c - win); i <= Math.min(n - 2, c + win); i++) if (sign * z[i] > sign * z[best]) best = i;
    // Battement coupé au début ou à la fin de l'enregistrement : on l'ignore.
    if (best <= 1 || best >= n - 2) continue;
    // Sommet affiné par une parabole passant par les trois points du pic.
    const [a, b, d] = [sign * z[best - 1], sign * z[best], sign * z[best + 1]];
    const den = a - 2 * b + d;
    const shift = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - d)) / den)) : 0;
    times.push((best + shift) / fs);
  }
  return times;
}

/**
 * RMSSD et pouls à partir des instants des battements (en secondes).
 * `times` : une liste d'instants, ou plusieurs (une par bande du tracé) ; les
 * intervalles ne sont alors comptés qu'à l'intérieur de chaque bande.
 * Les intervalles trop loin de la médiane (battement prématuré, oublié, parasite)
 * sont écartés, et avec eux les différences qui les touchent.
 */
export function hrvFromBeats(times) {
  const parts = Array.isArray(times[0]) ? times : [times];
  const runs = parts.map((t) => t.slice(1).map((v, i) => (v - t[i]) * 1000));
  const rr = runs.flat();
  const beats = parts.reduce((s, t) => s + t.length, 0);
  if (rr.length < 3) return { ok: false, reason: 'trop-court', beats, intervals: rr.length };
  const med = median(rr);
  const isGood = (v) => v >= 300 && v <= 2000 && Math.abs(v - med) <= RR_TOLERANCE * med;
  const diffs = [];
  for (const run of runs) for (let i = 1; i < run.length; i++) if (isGood(run[i]) && isGood(run[i - 1])) diffs.push(run[i] - run[i - 1]);
  const kept = rr.filter(isGood);
  const rejected = rr.length - kept.length;
  const out = {
    beats,
    intervals: rr.length,
    rejected,
    pairs: diffs.length,
    rr: rr.map((v) => Math.round(v * 10) / 10),
    hr: kept.length ? Math.round((600000 / (kept.reduce((s, v) => s + v, 0) / kept.length))) / 10 : null,
    rmssd: diffs.length ? Math.sqrt(diffs.reduce((s, v) => s + v * v, 0) / diffs.length) : null,
  };
  if (rejected / rr.length > MAX_REJECT) return { ...out, ok: false, reason: 'irregulier' };
  if (diffs.length < MIN_PAIRS) return { ...out, ok: false, reason: 'trop-court' };
  return { ...out, ok: true, reason: null, rmssd: Math.round(out.rmssd * 10) / 10 };
}

/**
 * Du tracé à la VFC : { ok, reason, rmssd (ms), hr, beats, intervals, rejected, pairs, rr, seconds }.
 * `signal` : le tracé entier, ou une liste de bandes (le PDF découpe l'ECG en lignes).
 */
export function analyzeEcg(signal, fs) {
  const segments = signal.length && typeof signal[0] !== 'number' ? signal : [signal];
  const seconds = segments.reduce((s, x) => s + x.length, 0) / fs;
  if (seconds < 15) return { ok: false, reason: 'trop-court', seconds, beats: 0 };
  return { ...hrvFromBeats(segments.map((x) => detectBeats(x, fs))), seconds: Math.round(seconds * 10) / 10 };
}

export const ECG_REASONS = {
  'trop-court': 'Trop peu de battements lisibles : refais l’ECG, les 30 secondes en entier.',
  irregulier: 'Trop de battements irréguliers ou de parasites pour mesurer ta VFC. Refais l’ECG assis, bras posé sur la table, sans bouger ni parler.',
};
