// Charge d'entraînement, condition, fatigue et fraîcheur.
//
// - Charge d'une séance en « points » : 1 h au seuil = 100 points (Coggan).
//   Sans capteur, on l'estime avec le ressenti (méthode de Foster : effort
//   perçu × durée), calé sur la table d'estimation de Joe Friel.
// - Condition / fatigue / fraîcheur : modèle de Banister, moyennes
//   exponentielles sur 42 et 7 jours.
// - Monotonie et contrainte : Foster (1998).

import { RUN_THRESHOLD, LTHR_PER_FCMAX } from './zones.js';
import { addDays, diffDays, mondayOf } from './dates.js';
import { flatEquivalentKm } from './running.js';

/** Points par heure selon le ressenti global de la séance (0 à 10). */
export const RPE_POINTS_PER_HOUR = [0, 20, 30, 40, 50, 60, 70, 80, 100, 120, 140];

export const RPE_LABELS = [
  '', 'Promenade', 'Très facile', 'Facile', 'Tranquille, mais ça travaille', 'Soutenu',
  'Costaud', 'Dur', 'Très dur', 'Extrême', 'À fond de fond',
];

/** Points par heure pris par défaut quand on ne sait rien de la séance. */
const DEFAULT_POINTS_PER_HOUR = { bike: 50, run: 55, other: 35 };

/** Points par heure supposés pour convertir « heures par semaine » en charge. */
export const SEED_POINTS_PER_HOUR = 55;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function rpePointsPerHour(rpe) {
  const r = clamp(Number(rpe) || 0, 0, 10);
  const lo = Math.floor(r);
  const hi = Math.ceil(r);
  const a = RPE_POINTS_PER_HOUR[lo];
  const b = RPE_POINTS_PER_HOUR[hi];
  return a + (b - a) * (r - lo);
}

/** Charge = heures × intensité² × 100 (intensité 1 = seuil). */
export function loadFromIntensity(sec, intensity) {
  return (sec / 3600) * intensity * intensity * 100;
}

/**
 * Charge d'une activité avec la meilleure mesure disponible :
 * puissance > fréquence cardiaque > ressenti > allure > valeur par défaut.
 */
export function computeLoad(activity, refs) {
  const sec = Number(activity.durationSec) || 0;
  if (sec <= 0) return { load: 0, method: 'none' };
  // `est: true` quand le repère utilisé (FTP, FC max, VMA) est une estimation et non une valeur saisie.
  const done = (load, method, est = false) => ({ load: Math.round(load), method, ...(est ? { est: true } : {}) });

  const power = Number(activity.np) || Number(activity.avgPower) || 0;
  if (activity.sport === 'bike' && power > 0 && refs.ftp) {
    return done(loadFromIntensity(sec, clamp(power / refs.ftp, 0.2, 1.6)), 'power', !!refs.est?.ftp);
  }
  const hr = Number(activity.avgHr) || 0;
  if (hr > 0 && refs.fcmax) {
    const rest = refs.fcrest ?? 60;
    const threshold = refs.fcmax * LTHR_PER_FCMAX;
    return done(loadFromIntensity(sec, clamp((hr - rest) / (threshold - rest), 0.25, 1.2)), 'hr', !!refs.est?.fcmax);
  }
  if (Number(activity.rpe) > 0) {
    return done((sec / 3600) * rpePointsPerHour(activity.rpe), 'rpe');
  }
  const km = Number(activity.distanceKm) || 0;
  if (activity.sport === 'run' && km > 0 && refs.vma) {
    const speed = flatEquivalentKm(km, activity.elevationM) / (sec / 3600);
    return done(loadFromIntensity(sec, clamp(speed / (refs.vma * RUN_THRESHOLD), 0.4, 1.2)), 'pace', !!refs.est?.vma);
  }
  const perHour = DEFAULT_POINTS_PER_HOUR[activity.sport] ?? DEFAULT_POINTS_PER_HOUR.other;
  return done((sec / 3600) * perHour, 'default');
}

export const LOAD_METHOD_LABELS = {
  power: 'puissance',
  hr: 'cardio',
  rpe: 'ressenti',
  pace: 'allure',
  default: 'estimation',
  none: '',
};

/** { 'AAAA-MM-JJ': charge du jour }. */
export function dailyLoads(activities) {
  const out = {};
  for (const a of activities) {
    if (!a.date) continue;
    out[a.date] = (out[a.date] ?? 0) + (Number(a.load) || 0);
  }
  return out;
}

/**
 * Courbes condition / fatigue / fraîcheur, jour par jour.
 * `form` est la fraîcheur du matin : condition − fatigue de la veille.
 */
export function buildPmc(loadByDate, from, to, seed = 0) {
  const rows = [];
  let ctl = seed;
  let atl = seed;
  const n = diffDays(from, to);
  for (let i = 0; i <= n; i++) {
    const date = addDays(from, i);
    const load = loadByDate[date] ?? 0;
    const form = ctl - atl;
    ctl += (load - ctl) / 42;
    atl += (load - atl) / 7;
    rows.push({ date, load, ctl, atl, form });
  }
  return rows;
}

/** Fraîcheur rapportée à la condition : −0,2 = fatigue 20 % au-dessus. */
export function formRatio(ctl, atl) {
  return (ctl - atl) / Math.max(ctl, 15);
}

export const FORM_ZONES = [
  { key: 'rouge', max: -0.3, label: 'Dans le rouge', color: '#E8504F', hint: 'Trop de fatigue accumulée : il faut lever le pied.' },
  { key: 'bosse', max: -0.1, label: 'Ça bosse', color: '#F68D3F', hint: 'Bonne fatigue d’entraînement : tu construis.' },
  { key: 'equilibre', max: 0.05, label: 'Équilibre', color: '#F7C948', hint: 'Ni fatigué ni vraiment frais.' },
  { key: 'frais', max: 0.2, label: 'Frais', color: '#5CC98A', hint: 'Les jambes sont là : parfait pour une grosse séance.' },
  { key: 'tresfrais', max: Infinity, label: 'Très frais', color: '#5DB7EA', hint: 'Bien reposé… mais la condition commence à s’effriter.' },
];

export function formZone(ratio) {
  return FORM_ZONES.find((z) => ratio < z.max) ?? FORM_ZONES[FORM_ZONES.length - 1];
}

/** Monotonie de Foster : moyenne / écart-type des charges des 7 derniers jours. */
export function monotony(loads7) {
  const n = loads7.length;
  if (!n) return null;
  const mean = loads7.reduce((s, x) => s + x, 0) / n;
  if (mean <= 0) return null;
  const sd = Math.sqrt(loads7.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
  if (sd < 1e-6) return 9.9;
  return Math.min(9.9, mean / sd);
}

/**
 * État de forme à la date `today`.
 *
 * Condition et fatigue « maintenant » : on part de l'état du matin (celui de
 * la veille au soir, une nuit de récupération comprise) et on y ajoute l'effet
 * des séances déjà faites aujourd'hui — la fatigue monte de charge / 7, la
 * condition de charge / 42. Avant la première séance, c'est donc l'état du
 * matin ; après, les chiffres bougent tout de suite.
 *
 * Fraîcheur (la jauge) : celle du prochain réveil, c'est-à-dire du moment où
 * l'on décide de la séance suivante. Tant que rien n'est fait aujourd'hui,
 * c'est celle de ce matin ; une fois la séance faite, c'est celle de demain
 * matin (`forecast: true`). Juste après l'effort on est toujours « dans le
 * dur » : ce n'est pas ce creux passager qui compte, mais ce qu'il en reste
 * après une nuit.
 */
export function fitnessAt(activities, today, { seed = 0, startDate = null } = {}) {
  const loads = dailyLoads(activities);
  const dates = Object.keys(loads).sort();
  let from = dates[0] ?? today;
  if (startDate && startDate < from) from = startDate;
  if (from > today) from = today;
  const rows = buildPmc(loads, from, today, seed);
  const evening = rows[rows.length - 1]; // ce soir, donc demain au réveil
  const todayLoad = evening.load;
  const morning = rows.length > 1 ? rows[rows.length - 2] : { ctl: seed, atl: seed };
  const ctl = morning.ctl + todayLoad / 42;
  const atl = morning.atl + todayLoad / 7;
  const weekAgo = rows.length > 7 ? rows[rows.length - 8] : null;
  // Monotonie : sur les 7 derniers jours complets (aujourd'hui n'est pas fini).
  const full7 = rows.slice(-8, -1).map((r) => r.load);
  const mono = full7.length === 7 ? monotony(full7) : null;
  const forecast = todayLoad > 0;
  const ratio = forecast ? formRatio(evening.ctl, evening.atl) : formRatio(morning.ctl, morning.atl);
  return {
    rows,
    ctl,
    atl,
    form: ctl - atl,
    // Fraîcheur de l'instant (sert à conseiller une éventuelle deuxième séance dans la journée).
    ratioNow: formRatio(ctl, atl),
    // Fraîcheur du prochain réveil (la jauge).
    ratio,
    zone: formZone(ratio),
    forecast,
    morning: { ctl: morning.ctl, atl: morning.atl, form: morning.ctl - morning.atl, ratio: formRatio(morning.ctl, morning.atl) },
    todayLoad,
    ramp: weekAgo ? ctl - weekAgo.ctl : 0,
    // Points des 7 derniers jours, aujourd'hui compris.
    weekLoad: rows.slice(-7).reduce((t, r) => t + r.load, 0),
    monotony: mono,
    strain: mono ? full7.reduce((t, x) => t + x, 0) * mono : null,
  };
}

/** Bilan d'une semaine (lundi → dimanche) à partir des activités. */
export function weekTotals(activities, monday) {
  const end = addDays(monday, 6);
  const t = { min: 0, load: 0, count: 0, bike: 0, run: 0, other: 0 };
  for (const a of activities) {
    if (!a.date || a.date < monday || a.date > end) continue;
    const m = (Number(a.durationSec) || 0) / 60;
    t.min += m;
    t.load += Number(a.load) || 0;
    t.count += 1;
    t[a.sport === 'bike' || a.sport === 'run' ? a.sport : 'other'] += m;
  }
  return t;
}

/** Totaux par semaine sur les `n` dernières semaines (la plus ancienne d'abord). */
export function weeklyHistory(activities, today, n = 8) {
  const thisMonday = mondayOf(today);
  return Array.from({ length: n }, (_, i) => {
    const monday = addDays(thisMonday, -7 * (n - 1 - i));
    return { monday, ...weekTotals(activities, monday) };
  });
}

/** Charge de départ (condition initiale) à partir des heures hebdomadaires déclarées. */
export function seedFromHours(hoursPerWeek) {
  return ((Number(hoursPerWeek) || 0) * SEED_POINTS_PER_HOUR) / 7;
}
