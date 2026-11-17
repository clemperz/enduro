// Gestion des activités : charge, fusion des doublons (Zwift + Strava +
// saisie manuelle de la même séance), mise à jour.

import { computeLoad } from '../engine/load.js';
import { addDays } from '../engine/dates.js';

const METHOD_RANK = { none: 0, default: 1, pace: 2, rpe: 3, hr: 4, power: 5 };

/** `refs` : repères résolus (saisis ou estimés), voir resolveRefs(). */
export function withLoad(activity, refs) {
  const { load, method, est } = computeLoad(activity, refs);
  const out = { ...activity, load, loadMethod: method };
  if (est) out.loadEst = true; else delete out.loadEst;
  return out;
}

/** Les charges calculées avec un repère estimé suivent l'estimation pendant 6 semaines, puis se figent. */
const REFINE_DAYS = 42;

/**
 * Met à jour les charges quand les repères évoluent, sans réécrire tout l'historique :
 * - la mesure s'améliore (ex. estimation → puissance) : on recalcule ;
 * - la charge reposait sur un repère estimé : on recalcule si une vraie valeur
 *   est maintenant saisie, ou si l'activité est récente (l'estimation s'affine) ;
 * - sinon on ne touche à rien : une nouvelle FTP ne change pas les charges passées.
 */
export function upgradeLoads(activities, refs, today = null) {
  const recentFrom = today ? addDays(today, -REFINE_DAYS) : null;
  let changed = 0;
  for (const a of activities) {
    const next = computeLoad(a, refs);
    const better = (METHOD_RANK[next.method] ?? 0) > (METHOD_RANK[a.loadMethod] ?? 0);
    const refine = a.loadEst && next.method === a.loadMethod && next.load !== a.load
      && (!next.est || !recentFrom || a.date >= recentFrom);
    const settled = a.loadEst && next.method === a.loadMethod && !next.est;
    if (a.load == null || better || refine || settled) {
      if (a.load !== next.load || a.loadMethod !== next.method) changed += 1;
      a.load = next.load;
      a.loadMethod = next.method;
      if (next.est) a.loadEst = true; else delete a.loadEst;
    }
  }
  return changed;
}

/**
 * La même séance vue par deux sources (Zwift et Strava, par exemple) : même
 * sport, et des horaires qui se recouvrent sur au moins 70 % de la plus courte.
 * Deux sorties d'une même source ne sont jamais fusionnées.
 */
function sameSession(a, b) {
  if (a.sport !== b.sport || !a.startEpoch || !b.startEpoch) return false;
  const sourcesA = a.sources ?? [a.source];
  if (sourcesA.includes(b.source)) return false;
  const overlap = Math.min(a.startEpoch + a.durationSec, b.startEpoch + b.durationSec) - Math.max(a.startEpoch, b.startEpoch);
  return overlap >= 0.7 * Math.min(a.durationSec, b.durationSec);
}

const DEFINED = (v) => v != null && v !== '';

/**
 * Ajoute ou met à jour une activité importée.
 * - même identifiant → mise à jour (le ressenti et la note sont conservés) ;
 * - même séance vue par une autre source (départ à ±10 min) → fusion ;
 * - saisie manuelle « c'est fait » du même jour et du même sport → remplacée
 *   par l'activité réelle, en gardant le ressenti.
 * Renvoie 'added' | 'updated' | 'merged'.
 */
export function upsertActivity(activities, incoming, refs) {
  const keepUser = (target, source) => {
    if (DEFINED(source.rpe) && !DEFINED(target.rpe)) target.rpe = source.rpe;
    if (DEFINED(source.note) && !DEFINED(target.note)) target.note = source.note;
  };
  const byId = activities.findIndex((a) => a.id === incoming.id || (incoming.stravaId && a.stravaId === incoming.stravaId));
  if (byId >= 0) {
    const old = activities[byId];
    const merged = { ...old, ...incoming, id: old.id };
    // Les mesures détaillées d'un fichier (puissance seconde par seconde) priment sur un résumé.
    if (old.best && !incoming.best) Object.assign(merged, pick(old, ['best', 'np', 'avgPower', 'maxPower', 'durationSec']));
    merged.rpe = old.rpe ?? incoming.rpe ?? null;
    merged.note = old.note || incoming.note || '';
    activities[byId] = withLoad(merged, refs);
    return 'updated';
  }
  const twin = activities.findIndex((a) => a.source !== 'manual' && sameSession(a, incoming));
  if (twin >= 0) {
    const old = activities[twin];
    const detailed = old.best ? old : incoming.best ? incoming : old;
    const other = detailed === old ? incoming : old;
    const merged = { ...other, ...detailed, id: old.id };
    merged.name = incoming.source === 'strava' ? incoming.name : old.name;
    merged.stravaId = old.stravaId ?? incoming.stravaId ?? null;
    merged.sources = [...new Set([...(old.sources ?? [old.source]), incoming.source])];
    keepUser(merged, old);
    keepUser(merged, incoming);
    activities[twin] = withLoad(merged, refs);
    return 'merged';
  }
  const manual = activities.findIndex((a) => a.source === 'manual' && a.date === incoming.date && a.sport === incoming.sport);
  const next = { rpe: null, note: '', ...incoming };
  if (manual >= 0) {
    keepUser(next, activities[manual]);
    activities.splice(manual, 1);
  }
  activities.push(withLoad(next, refs));
  return 'added';
}

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => obj[k] != null).map((k) => [k, obj[k]]));
}

/** Nettoie une activité envoyée par le navigateur (saisie manuelle ou fichier importé). */
export function sanitizeActivity(raw, fallbackSource = 'manual') {
  const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  const sport = ['bike', 'run', 'other'].includes(raw.sport) ? raw.sport : 'other';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw.date ?? '') ? raw.date : null;
  const durationSec = num(raw.durationSec);
  if (!date || !durationSec || durationSec <= 0 || durationSec > 48 * 3600) return null;
  const source = ['manual', 'file', 'zwift', 'strava'].includes(raw.source) ? raw.source : fallbackSource;
  const startEpoch = num(raw.startEpoch);
  const best = raw.best && typeof raw.best === 'object'
    ? Object.fromEntries(Object.entries(raw.best).filter(([k, v]) => /^\d+$/.test(k) && Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)]))
    : null;
  return {
    id: typeof raw.id === 'string' && raw.id.length < 120 ? raw.id : `${source}:${date}-${Math.random().toString(36).slice(2, 10)}`,
    source,
    sport,
    indoor: !!raw.indoor,
    name: String(raw.name ?? '').slice(0, 120),
    date,
    start: typeof raw.start === 'string' ? raw.start.slice(0, 19) : `${date}T12:00:00`,
    startEpoch,
    durationSec: Math.round(durationSec),
    distanceKm: num(raw.distanceKm),
    elevationM: num(raw.elevationM),
    avgPower: num(raw.avgPower),
    np: num(raw.np),
    maxPower: num(raw.maxPower),
    avgHr: num(raw.avgHr),
    maxHr: num(raw.maxHr),
    avgCadence: num(raw.avgCadence),
    best: best && Object.keys(best).length ? best : null,
    ramp: Number(raw.ramp?.map) > 0 ? { map: Math.round(Number(raw.ramp.map)), steps: Number(raw.ramp.steps) || 0, stepW: Number(raw.ramp.stepW) || 0 } : null,
    rpe: num(raw.rpe),
    note: String(raw.note ?? '').slice(0, 500),
    sessionId: typeof raw.sessionId === 'string' ? raw.sessionId.slice(0, 80) : null,
  };
}
