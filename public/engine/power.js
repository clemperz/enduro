// Puissance : puissance normalisée et Profil de Puissance Record (PPR).
// Le PPR — la meilleure puissance tenue sur chaque durée — est l'outil
// proposé par Pinot et Grappe (2011) pour suivre le potentiel d'un cycliste.

export const PPR_DURATIONS = [5, 30, 60, 300, 1200, 3600];

export const PPR_LABELS = { 5: '5 s', 30: '30 s', 60: '1 min', 300: '5 min', 1200: '20 min', 3600: '1 h' };

/** Puissance normalisée : moyenne glissante 30 s, puissance 4, moyenne, racine 4e. */
export function normalizedPower(series) {
  const n = series.length;
  if (!n) return 0;
  if (n < 30) return series.reduce((s, x) => s + x, 0) / n;
  let sum = 0;
  let acc = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    sum += series[i];
    if (i >= 30) sum -= series[i - 30];
    if (i >= 29) {
      acc += (sum / 30) ** 4;
      count += 1;
    }
  }
  return (acc / count) ** 0.25;
}

/** Meilleure puissance moyenne sur chaque durée (série à 1 point par seconde). */
export function bestEfforts(series, durations = PPR_DURATIONS) {
  const n = series.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + series[i];
  const out = {};
  for (const d of durations) {
    if (d > n) continue;
    let best = 0;
    for (let i = d; i <= n; i++) {
      const avg = (prefix[i] - prefix[i - d]) / d;
      if (avg > best) best = avg;
    }
    out[d] = Math.round(best);
  }
  return out;
}

/** Records toutes activités confondues. */
export function powerProfile(activities) {
  const ppr = {};
  for (const a of activities) {
    if (!a.best) continue;
    for (const [d, w] of Object.entries(a.best)) {
      if (!ppr[d] || w > ppr[d].watts) ppr[d] = { watts: w, date: a.date };
    }
  }
  return ppr;
}

/**
 * Repères suggérés par le PPR : PMA ≈ record sur 5 min, FTP ≈ 95 % du record
 * sur 20 min. Valable seulement si ces efforts ont été faits à fond.
 */
export function suggestRefs(ppr) {
  const out = {};
  if (ppr[300]) out.pma = ppr[300].watts;
  if (ppr[1200]) out.ftp = Math.round(ppr[1200].watts * 0.95);
  return out;
}

/**
 * Reconnaît un test rampe (celui de Zwift : + 20 W chaque minute jusqu'à
 * l'arrêt) dans une série de puissance à 1 point par seconde. On part de la
 * meilleure minute et on remonte le temps : il faut au moins 6 minutes
 * consécutives qui baissent chacune de 10 à 35 W, par paliers réguliers, et
 * que l'effort s'arrête juste après.
 * @returns {{map: number, steps: number, stepW: number}|null}  map = meilleure minute (W)
 */
export function detectRamp(series) {
  const n = series.length;
  if (n < 8 * 60) return null;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + series[i];
  const avg = (from, to) => (prefix[to] - prefix[from]) / (to - from);
  let end = 60;
  let best = 0;
  for (let i = 60; i <= n; i++) {
    const v = avg(i - 60, i);
    if (v > best) { best = v; end = i; }
  }
  const minutes = [];
  for (let k = 0; end - 60 * (k + 1) >= 0 && k < 30; k++) minutes.push(avg(end - 60 * (k + 1), end - 60 * k));
  const drops = [];
  for (let k = 1; k < minutes.length; k++) {
    const drop = minutes[k - 1] - minutes[k];
    if (drop < 10 || drop > 35) break;
    drops.push(drop);
  }
  if (drops.length < 6) return null;
  if (Math.max(...drops) - Math.min(...drops) > 16) return null;
  // Après la meilleure minute, un test rampe s'arrête net.
  const tail = Math.min(n, end + 60) - end;
  if (tail >= 20 && avg(end, end + tail) > best * 0.8) return null;
  return { map: Math.round(best), steps: drops.length, stepW: Math.round(drops.reduce((a, b) => a + b, 0) / drops.length) };
}
