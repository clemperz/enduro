// Les nuits mesurées par la montre (Withings) : pouls moyen et variabilité de
// la fréquence cardiaque (VFC, en RMSSD). Une valeur ne dit rien seule : on la
// compare toujours à ton habitude, et la VFC se lit sur plusieurs jours.
//
// Méthode : VFC en logarithme (sa distribution est très asymétrique), habitude =
// moyenne et écart type des 4 dernières semaines, tendance = moyenne des 7
// dernières nuits, « normale » = habitude ± ½ écart type (Plews et coll. 2013,
// Javaloyes et coll. 2019).

import { addDays } from './dates.js';

export const HRV_BASE_DAYS = 28;
export const HRV_MIN_NIGHTS = 7;
export const TREND_DAYS = 7;
export const TREND_MIN_NIGHTS = 3;
/** Plancher de l'écart type (en log) : évite qu'une série très régulière rende la règle hypersensible. */
export const SD_FLOOR = 0.05;

const hrvOf = (n) => (n?.rmssd > 0 ? n.rmssd : null);

function window(nights, today, days, get) {
  const out = [];
  for (let i = 1; i <= days; i++) {
    const v = get(nights?.[addDays(today, -i)]);
    if (v != null) out.push(v);
  }
  return out;
}

/** Pouls de nuit habituel : la médiane des 21 nuits précédentes (au moins 4). */
export function nightHrBaseline(nights, today) {
  const values = window(nights, today, 21, (n) => (n?.hrAvg > 0 ? n.hrAvg : null)).sort((a, b) => a - b);
  if (values.length < 4) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/** VFC habituelle sur les 4 semaines précédentes (au moins 7 nuits), en log et en ms. */
export function hrvBaseline(nights, today) {
  const logs = window(nights, today, HRV_BASE_DAYS, hrvOf).map(Math.log);
  if (logs.length < HRV_MIN_NIGHTS) return null;
  const mean = logs.reduce((s, v) => s + v, 0) / logs.length;
  const sd = Math.max(SD_FLOOR, Math.sqrt(logs.reduce((s, v) => s + (v - mean) ** 2, 0) / (logs.length - 1)));
  return {
    mean, sd, nights: logs.length,
    ms: Math.round(Math.exp(mean)),
    low: Math.round(Math.exp(mean - sd / 2)),
    high: Math.round(Math.exp(mean + sd / 2)),
  };
}

/** Moyenne (en log) des nuits des 7 derniers jours, celle de `today` comprise. */
export function hrvTrend(nights, today) {
  const logs = [hrvOf(nights?.[today]), ...window(nights, today, TREND_DAYS - 1, hrvOf)].filter((v) => v != null).map(Math.log);
  return logs.length >= TREND_MIN_NIGHTS ? logs.reduce((s, v) => s + v, 0) / logs.length : null;
}

/**
 * Ce que dit la nuit qui se termine ce matin, comparée à ton habitude.
 * null si la montre n'a rien envoyé pour cette nuit.
 *  - hr  : { value, base, drift } (battements au-dessus de l'habitude)
 *  - hrv : { value, base, trend (ms), trendLow, nightLow, high } ; base null tant que l'habitude n'est pas connue
 */
export function nightStatus(nights, today) {
  const night = nights?.[today];
  if (!night) return null;
  const hrBase = nightHrBaseline(nights, today);
  const hr = night.hrAvg > 0 ? { value: night.hrAvg, base: hrBase, drift: hrBase ? night.hrAvg - hrBase : null } : null;
  let hrv = null;
  if (hrvOf(night)) {
    const base = hrvBaseline(nights, today);
    const v = Math.log(night.rmssd);
    const t = hrvTrend(nights, today);
    hrv = {
      value: night.rmssd,
      base,
      trend: t != null ? Math.round(Math.exp(t)) : null,
      // Sur la semaine, la VFC sort de sa normale par le bas.
      trendLow: !!base && t != null && t < base.mean - base.sd / 2,
      // Une seule nuit nettement plus basse (ou plus haute) que d'habitude.
      nightLow: !!base && v < base.mean - base.sd,
      high: !!base && v > base.mean + base.sd,
    };
  }
  return { date: today, sleepMin: night.sleepMin ?? null, hr, hrv };
}

/** Série pour le graphique : VFC de chaque nuit et moyenne sur 7 jours, sur `days` jours. */
export function hrvSeries(nights, today, days = 56) {
  const rows = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const t = hrvTrend(nights, date);
    rows.push({ date, value: hrvOf(nights?.[date]), trend: t != null ? Math.exp(t) : null });
  }
  return rows;
}

/**
 * L'ECG de 30 s fait ce matin avec la montre, comparé à tes ECG précédents :
 * même calcul que pour les nuits, mais avec sa propre habitude (une VFC
 * mesurée assis, le matin, n'a pas la même valeur qu'une VFC de nuit).
 * null s'il n'y a pas d'ECG pour ce jour.
 */
export function morningStatus(ecg, today) {
  if (!ecg?.[today]) return null;
  const asNights = Object.fromEntries(Object.entries(ecg).map(([d, m]) => [d, { rmssd: m?.rmssd, hrAvg: m?.hr }]));
  const s = nightStatus(asNights, today);
  return { date: today, at: ecg[today].at ?? null, hr: s.hr, hrv: s.hrv };
}
