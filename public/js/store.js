// État de l'application côté navigateur + tout ce qui s'en déduit
// (repères, forme du jour, semaine en cours).

import { api } from './api.js';
import { todayISO, mondayOf, addDays, dayIndex, diffDays } from '../engine/dates.js';
import { resolveRefs } from '../engine/zones.js';
import { fitnessAt, seedFromHours, weekTotals } from '../engine/load.js';
import { readiness, pulseBaseline } from '../engine/readiness.js';
import { nightStatus, morningStatus } from '../engine/nights.js';
import { generateWeek, linkActivities, previewWeeks, regenerateRest, upcomingGoals } from '../engine/plan.js';
import { runCoach } from '../engine/coach.js';
import { estimateRefs, testActivityIds } from '../engine/estimate.js';

const params = new URLSearchParams(location.search);
const forcedToday = params.get('today');

export const S = {
  ready: false,
  profile: null,
  plan: null,
  checkins: {},
  activities: [],
  zwift: {},
  strava: {},
  nights: {},
  ecg: {},
  withings: {},
  server: {},
  // ?today=AAAA-MM-JJ permet de « voyager dans le temps » pour essayer l'app.
  today: /^\d{4}-\d{2}-\d{2}$/.test(forcedToday ?? '') ? forcedToday : todayISO(),
  ui: { sheet: null, weekOffset: 0, toast: null, ob: null, form: null, busy: {} },
};

export function absorb(data) {
  for (const k of ['profile', 'plan', 'checkins', 'activities', 'zwift', 'strava', 'nights', 'ecg', 'withings', 'server']) {
    if (k in data && data[k] !== undefined) S[k] = data[k];
  }
}

/**
 * Repères en vigueur : ce qui est saisi, complété par ce qu'on estime d'après
 * les activités. `profile` peut être un brouillon (écran Profil, premier lancement).
 */
export function refs(profile = S.profile) {
  const estimates = estimateRefs(S.activities, profile, S.today, testActivityIds(S.plan));
  return resolveRefs(profile, Number(S.today.slice(0, 4)), estimates);
}

export function fitness() {
  return fitnessAt(S.activities, S.today, {
    // Le point de départ reste le volume déclaré le premier jour, même si le plan a évolué depuis.
    seed: seedFromHours(S.profile?.seedHours ?? S.profile?.hoursNow ?? 0),
    startDate: S.plan?.startDate ?? null,
  });
}

/** La nuit qui se termine ce matin (montre Withings), comparée à ton habitude. */
export function todayNight() {
  return nightStatus(S.nights, S.today);
}

/** L'ECG de 30 s fait ce matin avec la montre (importé à la main), comparé à tes ECG précédents. */
export function todayEcg() {
  return morningStatus(S.ecg, S.today);
}

export function todayReadiness() {
  return readiness(fitness(), S.checkins[S.today] ?? null, {
    pulseBase: pulseBaseline(S.checkins, S.today), night: todayNight(), ecg: todayEcg(),
  });
}

/** Ce dont le générateur de plan a besoin pour s'adapter au réel. */
export function planCtx() {
  const monday = mondayOf(S.today);
  const past = [1, 2, 3, 4].map((i) => weekTotals(S.activities, addDays(monday, -7 * i)));
  const active = past.filter((w) => w.count > 0).length;
  return {
    today: S.today,
    ctl: fitness().ctl,
    recentWeeklyMin: active >= 3 ? past.reduce((s, w) => s + w.min, 0) / 4 : null,
    // Minutes de course à pied par semaine, en moyenne sur les 4 dernières semaines.
    recentRunMin: past.reduce((s, w) => s + w.run, 0) / 4,
    weekActual: (ws) => (addDays(ws, 6) < S.today ? weekTotals(S.activities, ws) : null),
  };
}

/** Allège les semaines anciennes (on garde le résumé, pas le détail des étapes). */
function prune(plan) {
  const monday = mondayOf(S.today);
  const limit = addDays(monday, -56);
  for (const w of Object.values(plan.weeks)) {
    // Semaine terminée : plus besoin de garder de quoi annuler les ajustements.
    if (w.weekStart < monday) for (const s of w.sessions) if (s.auto) delete s.auto.prev;
    if (w.weekStart >= limit) continue;
    for (const s of w.sessions) { delete s.steps; delete s.tips; delete s.why; }
  }
}

/** Ce que le coach automatique regarde : activités, ressentis, feu du jour. */
function coachEnv() {
  const ready = todayReadiness();
  return {
    today: S.today, activities: S.activities, checkins: S.checkins,
    level: ready.level, reasons: ready.reasons, ctx: planCtx(),
  };
}

/** Objectifs à venir, du plus proche au plus lointain, avec leur horizon. */
export function goals(profile = S.profile) {
  return profile ? upcomingGoals(profile, S.today) : [];
}

/**
 * S'assure que le plan existe, que la semaine en cours est générée, que les
 * activités sont reliées aux séances, puis laisse le coach ajuster ce qui doit
 * l'être (fatigue, séance ajoutée, séance manquée…). Renvoie true si le plan a changé.
 */
export function ensurePlan() {
  if (!S.profile) return false;
  let changed = false;
  if (!S.plan || !S.plan.startDate) {
    S.plan = { startDate: S.today, weeks: {} };
    changed = true;
  }
  S.plan.weeks ??= {};
  const monday = mondayOf(S.today);
  if (!S.plan.weeks[monday]) {
    S.plan.weeks[monday] = generateWeek(S.profile, S.plan, monday, planCtx(), { fromIdx: dayIndex(S.today) });
    prune(S.plan);
    changed = true;
  }
  if (linkActivities(S.plan, S.activities, S.today)) changed = true;
  if (runCoach(S.profile, S.plan, coachEnv())) changed = true;
  return changed;
}

export async function savePlan() {
  await api.savePlan(S.plan);
}

/** Semaine affichée : 0 = cette semaine, 1 = la suivante (figée dès qu'on la regarde), < 0 = passé. */
export function weekAt(offset) {
  const monday = addDays(mondayOf(S.today), 7 * offset);
  const stored = S.plan?.weeks?.[monday];
  if (stored) return { monday, week: stored, stored: true };
  if (offset === 1 && S.profile && S.plan) {
    const week = generateWeek(S.profile, S.plan, monday, planCtx());
    S.plan.weeks[monday] = week;
    savePlan().catch(() => {});
    return { monday, week, stored: true };
  }
  return { monday, week: null, stored: false };
}

/** Aperçu du plan : de la semaine en cours jusqu'au dernier objectif (ou 12 semaines). */
export function planPreview() {
  if (!S.profile || !S.plan) return [];
  const monday = mondayOf(S.today);
  let count = 12;
  const last = goals().pop();
  if (last) count = Math.min(44, Math.max(4, diffDays(monday, mondayOf(last.date)) / 7 + 2));
  return previewWeeks(S.profile, S.plan, planCtx(), monday, count);
}

/** Recalcule la fin de la semaine en cours (et oublie la suivante si rien n'y est fait). */
export function replan({ rebaseMin = null } = {}) {
  if (!S.profile || !S.plan) return;
  const monday = mondayOf(S.today);
  S.plan.weeks[monday] = regenerateRest(S.profile, S.plan, monday, S.today, planCtx(), { rebaseMin });
  // La semaine prochaine, déjà figée, est refaite avec le nouveau profil — en gardant les séances ajoutées à la main.
  const next = addDays(monday, 7);
  const upcoming = S.plan.weeks[next];
  if (upcoming?.sessions.some((s) => s.manual || s.status === 'done')) {
    S.plan.weeks[next] = regenerateRest(S.profile, S.plan, next, next, planCtx(), { rebaseMin });
  } else if (upcoming) {
    delete S.plan.weeks[next];
  }
  linkActivities(S.plan, S.activities, S.today);
}

/** Semaine contenant `date` (cette semaine ou la suivante, générée et enregistrée au besoin). */
export function weekFor(date) {
  return weekAt(diffDays(mondayOf(S.today), mondayOf(date)) / 7);
}

/**
 * Même chose, mais sans rien enregistrer : la semaine prochaine reste libre de
 * s'adapter à ce qui sera fait cette semaine tant qu'on n'y touche pas.
 * Le résultat est identique à ce que weekFor() enregistrerait au même moment.
 */
export function peekWeek(date) {
  const monday = mondayOf(date);
  const stored = S.plan?.weeks?.[monday];
  if (stored) return stored;
  if (!S.profile || !S.plan || diffDays(mondayOf(S.today), monday) !== 7) return null;
  peekCache ??= {};
  const key = `${monday}|${S.activities.length}|${Object.keys(S.plan.weeks).length}`;
  peekCache[monday] = peekCache[monday]?.key === key ? peekCache[monday] : { key, week: generateWeek(S.profile, S.plan, monday, planCtx()) };
  return peekCache[monday].week;
}
let peekCache = null;

/** Jours où l'on peut ajouter une séance : d'aujourd'hui à la fin de la semaine prochaine. */
export function plannableDays() {
  const end = addDays(mondayOf(S.today), 13);
  const out = [];
  for (let d = S.today; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function findSession(id) {
  for (const w of Object.values(S.plan?.weeks ?? {})) {
    const s = w.sessions.find((x) => x.id === id);
    if (s) return { week: w, session: s };
  }
  return null;
}

export function replaceSession(id, next) {
  const found = findSession(id);
  if (!found) return;
  found.week.sessions = found.week.sessions.map((s) => (s.id === id ? next : s));
}

export const activityById = (id) => S.activities.find((a) => a.id === id) ?? null;
