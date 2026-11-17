// Estimation des repères (PMA, FTP, VMA, FC max) à partir des activités,
// pour quand ils ne sont pas renseignés.
//
// Trois niveaux de confiance :
//   'test'    — vient d'un vrai test (rampe Zwift, test 5 + 20 min, course en compétition) ;
//   'record'  — vient d'un record récent : c'est un minimum, la vraie valeur est au moins celle-là ;
//   'cardio'  — extrapolé depuis la fréquence cardiaque de sorties tranquilles ;
//   'formule' — formule générale (âge, rapport FTP / PMA) : un ordre de grandeur.

import { FTP_PER_PMA, estimateFcMax as fcMaxFromAge } from './zones.js';
import { addDays, fmtDate } from './dates.js';
import { flatEquivalentKm, enduranceFraction } from './running.js';

/** Les records datent : on ne regarde que les 4 derniers mois (1 an pour la FC max, plus stable). */
const RECENT_DAYS = 120;
const HR_DAYS = 365;

const day = (iso) => fmtDate(iso, { day: 'numeric', month: 'short' });
const top = (list) => list.slice().sort((a, b) => b.value - a.value)[0] ?? null;
const km1 = (v) => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');

/** 2380 s → '39 min 40', 3725 s → '1 h 02 min'. */
export function fmtClock(sec) {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  return r ? `${m} min ${String(r).padStart(2, '0')}` : `${m} min`;
}

const DIST_LABEL = { 1000: '1 km', 1609: 'mile', 3219: '2 miles', 5000: '5 km', 10000: '10 km', 15000: '15 km', 16090: '10 miles', 20000: '20 km', 21097: 'semi-marathon', 42195: 'marathon' };
const distLabel = (m) => DIST_LABEL[m] ?? `${km1(m / 1000)} km`;

function recent(activities, today, days, sport) {
  const since = addDays(today, -days);
  return activities.filter((a) => a.date && a.date >= since && a.date <= today && (!sport || a.sport === sport));
}

/**
 * FTP et PMA d'après les sorties avec capteur de puissance (Zwift).
 * @param {Set<string>} [tests]  identifiants des activités qui sont des tests 5 + 20 min faits à fond
 */
export function estimatePower(activities, today, tests = null) {
  const ftps = [];
  const pmas = [];
  for (const a of recent(activities, today, RECENT_DAYS, 'bike')) {
    const b = a.best ?? {};
    const isTest = tests?.has(a.id) ?? false;
    if (a.ramp?.map) {
      // Protocole du test rampe de Zwift : FTP = 75 % de la meilleure minute.
      ftps.push({
        value: Math.round(a.ramp.map * 0.75), quality: 'test', date: a.date,
        basis: `ton test rampe du ${day(a.date)} : 75 % de ta meilleure minute (${a.ramp.map} W)`,
      });
    }
    if (b[1200]) {
      ftps.push({
        value: Math.round(b[1200] * 0.95), quality: isTest ? 'test' : 'record', date: a.date,
        basis: isTest ? `ton test du ${day(a.date)} : 95 % de tes 20 min à ${b[1200]} W` : `95 % de ton record sur 20 min (${b[1200]} W, le ${day(a.date)})`,
      });
    }
    if (b[3600]) {
      ftps.push({ value: b[3600], quality: 'record', date: a.date, basis: `ton record sur 1 h (${b[3600]} W, le ${day(a.date)})` });
    }
    if (b[300]) {
      pmas.push({
        value: b[300], quality: isTest ? 'test' : 'record', date: a.date,
        basis: isTest ? `ton test du ${day(a.date)} : 5 min à ${b[300]} W` : `ton record sur 5 min (${b[300]} W, le ${day(a.date)})`,
      });
    }
  }
  let ftp = top(ftps);
  let pma = top(pmas);
  if (ftp) {
    const fromFtp = Math.round(ftp.value / FTP_PER_PMA);
    if (!pma || fromFtp > pma.value) {
      pma = {
        value: fromFtp, quality: ftp.quality, date: ftp.date, derived: true,
        basis: `ta FTP estimée (${ftp.value} W), qui vaut environ 78 % de la PMA`,
      };
    }
  } else if (pma) {
    ftp = {
      value: Math.round(pma.value * FTP_PER_PMA), quality: pma.quality, date: pma.date, derived: true,
      basis: `78 % de ta PMA estimée (${pma.value} W)`,
    };
  }
  return { ftp, pma };
}

/**
 * VMA d'après les courses à pied.
 * - Chaque course donne un minimum : vitesse (ramenée au plat) ÷ part de VMA tenable sur cette durée.
 * - Les meilleurs temps Strava (1 km, 5 km…) affinent quand il y a eu du fractionné.
 * - Avec un cardio : sur un footing régulier, la part de réserve cardiaque utilisée ≈ la part de VMA.
 */
export function estimateVma(activities, today, { fcmax = null, fcrest = null } = {}) {
  const runs = recent(activities, today, RECENT_DAYS, 'run').filter((a) => a.distanceKm > 0 && a.durationSec > 0);
  const cands = [];
  for (const a of runs) {
    const minutes = a.durationSec / 60;
    const speed = flatEquivalentKm(a.distanceKm, a.elevationM) / (a.durationSec / 3600);
    if (minutes >= 6 && minutes <= 300 && speed <= 25) {
      cands.push({
        value: speed / enduranceFraction(minutes), quality: a.race || a.rpe >= 9 ? 'test' : 'record', date: a.date,
        basis: `ta ${a.race ? 'compétition' : 'course'} du ${day(a.date)} : ${km1(a.distanceKm)} km en ${fmtClock(a.durationSec)}`,
      });
    }
    for (const [dist, sec] of Object.entries(a.runBest ?? {})) {
      const m = Number(dist);
      if (!(m >= 1000) || !(sec >= 150)) continue; // trop court : part d'anaérobie trop forte
      const v = m / 1000 / (sec / 3600);
      if (v > 25) continue;
      cands.push({
        value: v / enduranceFraction(sec / 60), quality: 'record', date: a.date,
        basis: `ton meilleur ${distLabel(m)} (${fmtClock(sec)}, le ${day(a.date)})`,
      });
    }
  }
  if (fcmax) {
    const rest = fcrest ?? 60;
    const fromHr = runs
      .filter((a) => a.avgHr > 0 && a.durationSec >= 1200 && a.durationSec <= 7200)
      .map((a) => {
        const part = (a.avgHr - rest) / (fcmax - rest);
        if (part < 0.6 || part > 0.95) return null;
        return flatEquivalentKm(a.distanceKm, a.elevationM) / (a.durationSec / 3600) / part;
      })
      .filter((v) => v != null && v <= 26)
      .sort((x, y) => x - y);
    if (fromHr.length >= 2) {
      const mid = Math.floor(fromHr.length / 2);
      const median = fromHr.length % 2 ? fromHr[mid] : (fromHr[mid - 1] + fromHr[mid]) / 2;
      cands.push({
        value: median, quality: 'cardio', date: runs[runs.length - 1]?.date ?? today,
        basis: `ta fréquence cardiaque sur ${fromHr.length} footings (allure ÷ part de réserve cardiaque utilisée)`,
      });
    }
  }
  const best = top(cands.filter((c) => c.value >= 8 && c.value <= 26));
  return best ? { ...best, value: Math.round(best.value * 10) / 10 } : null;
}

/**
 * FC max : la plus haute fréquence vue en séance si elle est plausible,
 * sinon la formule de l'âge (Tanaka : 208 − 0,7 × âge).
 */
export function estimateFcMaxFromData(activities, today, age = null) {
  const formula = age ? fcMaxFromAge(age) : null;
  const ceiling = formula ? formula + 25 : 220; // au-delà : artefact de capteur
  let seen = null;
  for (const a of recent(activities, today, HR_DAYS)) {
    const m = Number(a.maxHr);
    if (m >= 100 && m <= ceiling && (!seen || m > seen.value)) seen = { value: Math.round(m), date: a.date };
  }
  if (seen && (!formula || seen.value >= formula - 12)) {
    return {
      value: seen.value, quality: 'record', date: seen.date,
      basis: `la fréquence la plus haute vue en séance (${seen.value} bpm, le ${day(seen.date)})`,
    };
  }
  if (formula) {
    return {
      value: formula, quality: 'formule',
      basis: seen
        ? `ton âge (208 − 0,7 × âge) : tes séances enregistrées ne sont pas montées assez haut (${seen.value} bpm au plus)`
        : 'ton âge (208 − 0,7 × âge)',
    };
  }
  return null;
}

/**
 * Toutes les estimations d'un coup.
 * @param {object} profile  pour l'âge et les repères déjà saisis (FC max, FC de repos)
 * @param {Set<string>} [tests]  activités correspondant à un test 5 + 20 min du plan
 */
export function estimateRefs(activities, profile, today, tests = null) {
  const list = activities ?? [];
  const age = Number(profile?.birthYear) > 0 ? Number(today.slice(0, 4)) - Number(profile.birthYear) : null;
  const fcmax = estimateFcMaxFromData(list, today, age);
  const { ftp, pma } = estimatePower(list, today, tests);
  const knownMax = Number(profile?.refs?.fcmax) > 0 ? Number(profile.refs.fcmax) : fcmax?.value ?? null;
  const knownRest = Number(profile?.refs?.fcrest) > 0 ? Number(profile.refs.fcrest) : null;
  const vma = estimateVma(list, today, { fcmax: knownMax, fcrest: knownRest });
  return { pma, ftp, vma, fcmax };
}

/** Activités liées à une séance « test » du plan (pour traiter leurs records comme de vrais tests). */
export function testActivityIds(plan) {
  const ids = new Set();
  for (const w of Object.values(plan?.weeks ?? {})) {
    for (const s of w.sessions ?? []) if (s.kind === 'test' && s.activityId) ids.add(s.activityId);
  }
  return ids;
}

export const QUALITY_LABELS = {
  test: 'mesuré lors d’un test',
  record: 'au moins, d’après un record',
  cardio: 'd’après ton cardio',
  formule: 'ordre de grandeur',
};
