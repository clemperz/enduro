// Générateur de plan.
//
// Principes :
// - cycles de 4 semaines « 3/1 » : trois semaines de charge progressive, une
//   semaine allégée pour assimiler ;
// - phases : fondations (endurance, 1er seuil, force) → développement (on
//   « pousse » le seuil) → spécifique (on « tire » avec la PMA / VMA) →
//   affûtage → objectif ;
// - chaque séance tient dans le temps disponible du jour, jamais deux séances
//   dures deux jours de suite, la plus longue sur le plus gros créneau ;
// - le volume part de ce que tu fais vraiment et n'augmente que si tu suis.

import { addDays, mondayOf, dayIndex, diffDays } from './dates.js';
import { buildSession, minMinutes } from './workouts.js';
import { formatOf, taperWeeksOf } from './formats.js';
import { planBias } from './predict.js';

export const LEVELS = {
  debutant: {
    label: 'Débutant', maxSessions: 4, minRest: 2, growth: 1.05, offset: 0,
    keyMin: { bike: 60, run: 45 }, longMax: { bike: 150, run: 75 }, easyRun: 45, indoorLong: 90,
  },
  intermediaire: {
    label: 'Intermédiaire', maxSessions: 5, minRest: 1, growth: 1.06, offset: 1,
    keyMin: { bike: 70, run: 55 }, longMax: { bike: 240, run: 110 }, easyRun: 60, indoorLong: 120,
  },
  confirme: {
    label: 'Confirmé', maxSessions: 6, minRest: 1, growth: 1.07, offset: 2,
    keyMin: { bike: 80, run: 60 }, longMax: { bike: 300, run: 150 }, easyRun: 75, indoorLong: 150,
  },
};

export const PHASES = {
  intro: { label: 'Mise en route', short: 'Départ', tiny: 'Début', color: '#B9C6D2', blurb: 'On démarre en douceur, le temps d’installer la routine.' },
  fondations: { label: 'Fondations', short: 'Fondations', tiny: 'Base', color: '#5DB7EA', blurb: 'Construire la base : endurance, premier seuil, un peu de force.' },
  developpement: { label: 'Développement', short: 'Seuil', color: '#5CC98A', blurb: 'On « pousse » le seuil par le bas : sweet spot et seuil.' },
  specifique: { label: 'Spécifique', short: 'PMA', color: '#F68D3F', blurb: 'On « tire » le plafond : PMA et VMA, en entretenant le seuil.' },
  affutage: { label: 'Affûtage', short: 'Affûtage', tiny: 'Affût', color: '#F7C948', blurb: 'Moins de volume, un peu de rythme : on fait le plein de fraîcheur.' },
  objectif: { label: 'Objectif', short: 'Jour J', tiny: 'J', color: '#E8504F', blurb: 'Semaine de l’objectif : rester frais et confiant.' },
  recup: { label: 'Récupération', short: 'Récup', tiny: 'Récup', color: '#B9C6D2', blurb: 'Coupure après l’objectif : on recharge les batteries.' },
};

/**
 * Débuter la course à pied sans se blesser : pendant les 4 premières semaines,
 * 30 min par footing et 3 sorties par semaine au plus (1 h 30 de chocs en tout).
 */
export const RUN_START = { weeks: 4, sessionMin: 30, perWeek: 3, weeklyMin: 90 };

/** Volume de chaque semaine du cycle 3/1 par rapport à la référence. */
const CYCLE_MULT = { 1: 1.0, 2: 1.08, 3: 1.15, 4: 0.65 };
const MIN_SLOT = 25;

const sum = (a) => a.reduce((s, x) => s + x, 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round5 = (m) => Math.round(m / 5) * 5;

export function normalizeAvail(avail) {
  return Array.from({ length: 7 }, (_, i) => Math.max(0, Number(avail?.[i]) || 0));
}

// ---------------------------------------------------------------------------
// Objectifs
// ---------------------------------------------------------------------------

export const MAX_GOALS = 3;
export const HORIZONS = ['Court terme', 'Moyen terme', 'Long terme'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const byDate = (x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0);

/**
 * Objectifs datés du profil, du plus proche au plus lointain :
 * [{ id, name, sport: 'bike' | 'run', date, major, format? }].
 * - `major` : objectif majeur (affûtage avant, récupération après). Sinon c'est
 *   une « étape » : une course de préparation, courue sur une semaine allégée.
 * - `format` (facultatif) : la durée de l'épreuve (voir formats.js). Elle règle la
 *   longueur de l'affûtage et, en course à pied, l'allure travaillée avant le jour J.
 * - S'il n'y a aucun objectif majeur, le dernier le devient : il faut un sommet.
 * - L'ancien format (`profile.goal`, un seul objectif) est accepté.
 */
export function goalsOf(profile) {
  let list = [];
  if (Array.isArray(profile?.goals)) {
    list = profile.goals
      .filter((g) => g && ISO_DATE.test(g.date ?? '') && (g.sport === 'bike' || g.sport === 'run'))
      .map((g, i) => {
        const goal = { id: g.id ?? `g${i + 1}`, name: g.name ?? '', sport: g.sport, date: g.date, major: g.major !== false };
        if (formatOf(g)) goal.format = g.format;
        return goal;
      });
  } else if (profile?.goal && profile.goal.type !== 'forme' && ISO_DATE.test(profile.goal.date ?? '')) {
    const g = profile.goal;
    list = [{ id: 'g1', name: g.name ?? '', sport: g.type === 'velo' ? 'bike' : 'run', date: g.date, major: true }];
  }
  list.sort(byDate);
  if (list.length && !list.some((g) => g.major)) list[list.length - 1] = { ...list[list.length - 1], major: true };
  return list;
}

/**
 * Objectifs à venir avec leur horizon (court, moyen, long terme) et le temps
 * qu'il reste. L'horizon suit l'éloignement (moins de 8 semaines, moins de 20,
 * au-delà), sans jamais donner deux fois la même étiquette.
 */
export function upcomingGoals(profile, today) {
  const list = goalsOf(profile).filter((g) => g.date >= today);
  const rank = list.map((g) => {
    const weeks = diffDays(today, g.date) / 7;
    return weeks <= 8 ? 0 : weeks <= 20 ? 1 : 2;
  });
  for (let i = 1; i < rank.length; i++) rank[i] = Math.min(2, Math.max(rank[i], rank[i - 1] + 1));
  for (let i = rank.length - 2; i >= 0; i--) rank[i] = Math.max(0, Math.min(rank[i], rank[i + 1] - 1));
  return list.map((g, i) => ({
    ...g, horizon: HORIZONS[rank[i]], daysLeft: diffDays(today, g.date), weeksLeft: diffDays(mondayOf(today), mondayOf(g.date)) / 7,
  }));
}

/** Sport prioritaire de la semaine : celui de l'objectif qu'elle prépare (`focus`), sinon le plus pratiqué. */
export function primarySport(profile, focus = null) {
  const split = clamp(Number(profile.split ?? 0.5), 0, 1);
  if (split >= 0.999) return 'bike';
  if (split <= 0.001) return 'run';
  if (focus === 'bike' || focus === 'run') return focus;
  if (!Array.isArray(profile.goals)) {
    if (profile.goal?.type === 'velo') return 'bike';
    if (profile.goal?.type === 'course') return 'run';
  }
  return split >= 0.5 ? 'bike' : 'run';
}

export function isIndoorDay(profile, day) {
  return profile.indoor === 'toujours' || (profile.indoor === 'semaine' && day < 5);
}

// ---------------------------------------------------------------------------
// Où en est-on dans le plan ?
// ---------------------------------------------------------------------------

function mk(phase, extra = {}) {
  return { phase, cycleWeek: 0, isRecovery: false, step: 0, index: 0, ...extra };
}

/**
 * Longueur des blocs de charge avant l'affûtage. Chaque bloc est suivi d'une
 * semaine allégée, sauf le dernier, suivi de l'affûtage.
 * - jamais plus de 3 semaines de charge d'affilée, jamais un bloc d'une seule semaine ;
 * - environ une semaine allégée toutes les 4 semaines ;
 * - quand le compte ne tombe pas juste, ce sont les premiers blocs qui sont
 *   raccourcis à 2 semaines : on démarre en douceur, les blocs de 3 sont près de l'objectif.
 * Exemples : 7 → [3, 3] · 9 → [2, 2, 3] · 12 → [2, 2, 2, 3].
 * `lead` : semaines de mise en route avant le premier bloc (seulement quand rien d'autre ne tombe juste).
 */
export function cycleBlocks(R) {
  if (R <= 3) return { lead: 0, blocks: R > 0 ? [R] : [] };
  if (R === 4) return { lead: 1, blocks: [3] }; // 1 semaine de mise en route + 3 de charge, puis l'affûtage
  const c = Math.ceil((R + 1) / 4); // nombre de blocs
  const load = R - (c - 1); // semaines de charge (les autres sont allégées)
  const base = Math.floor(load / c);
  const longer = load % c;
  return { lead: 0, blocks: Array.from({ length: c }, (_, j) => base + (j >= c - longer ? 1 : 0)) };
}

/**
 * Part de chaque phase sur les `N` semaines d'une préparation.
 * Première préparation : un tiers chacune (fondations, développement, spécifique).
 * Préparations suivantes (`later`) : la base est déjà construite, on repart
 * vite sur le seuil et la PMA — des fondations seulement s'il y a du temps.
 */
function phaseSplit(N, later, bias = null) {
  let fond;
  let dev;
  if (later) {
    fond = N >= 8 ? Math.round(N * 0.25) : 0;
    const rest = N - fond;
    const spe = clamp(Math.round(rest * 0.5), Math.min(rest, 2), 8);
    dev = rest - spe;
  } else {
    const spe = clamp(Math.round(N * 0.33), Math.min(N, 2), 8);
    dev = clamp(Math.round(N * 0.33), Math.min(N - spe, 2), 8);
    fond = N - spe - dev;
  }
  // Profil du cycliste (voir predict.js) : on travaille en priorité ce qui manque.
  // Une semaine (deux sur une longue préparation) passe du seuil à la PMA, ou l'inverse,
  // sans jamais descendre sous deux semaines pour l'une des deux phases.
  const shift = bias ? (N >= 16 ? 2 : N >= 8 ? 1 : 0) : 0;
  const spe = N - fond - dev;
  if (bias === 'pma') dev -= Math.max(0, Math.min(shift, dev - 2, 8 - spe));
  if (bias === 'seuil') dev += Math.max(0, Math.min(shift, spe - 2, 8 - dev));
  return { fond, dev };
}

/**
 * Le calendrier du plan, semaine par semaine, construit à rebours depuis les objectifs.
 * - objectif majeur : semaine « objectif », précédée d'un affûtage, suivie d'une récupération ;
 * - étape (course de préparation) : elle tombe sur une semaine allégée, sans affûtage ;
 * - entre deux : des blocs de 2 ou 3 semaines de charge séparés par une semaine allégée
 *   (voir cycleBlocks), calés pour finir sur un bloc de charge ;
 * - chaque préparation (jusqu'à un objectif majeur) enchaîne fondations → développement → spécifique.
 */
function buildCalendar(firstFull, goals, bias = null) {
  const at = goals.map((g) => ({ ...g, week: diffDays(firstFull, mondayOf(g.date)) / 7 })).filter((g) => g.week >= 0);
  if (!at.length) return null;
  const last = Math.max(...at.map((g) => g.week));
  const kind = new Array(last + 2).fill(null);
  const majors = at.filter((g) => g.major);
  for (const g of majors) kind[g.week] = 'objectif';
  for (const g of majors) if (kind[g.week + 1] == null) kind[g.week + 1] = 'recup';
  // Affûtage : la ou les semaines d'avant (selon la durée de l'épreuve), s'il reste
  // au moins une semaine de préparation avant elles.
  const taperOf = {};
  for (const g of majors) {
    const want = taperWeeksOf(g);
    let got = 0;
    for (let k = 1; k <= want; k++) {
      if (g.week - k < 1 || kind[g.week - k] != null) break;
      kind[g.week - k] = 'affutage';
      got += 1;
    }
    for (let k = 1; k <= got; k++) taperOf[g.week - k] = got;
  }
  for (const g of at) if (!g.major && kind[g.week] == null) kind[g.week] = 'etape';
  let K = kind.length - 1;
  while (K > 0 && kind[K] == null) K -= 1;

  const infos = new Array(K + 1);
  let seg = 0;
  let i = 0;
  let firstRun = true;
  while (i <= K) {
    let j = i;
    while (j <= K && kind[j] !== 'objectif') j += 1;
    const end = Math.min(j, K);
    let N = 0;
    for (let w = i; w <= end; w++) if (kind[w] == null) N += 1;
    // Le profil du cycliste ne joue que sur une préparation à un objectif vélo.
    const prepGoal = at.find((g) => g.week === end && g.major) ?? at.filter((g) => g.week >= i).sort((a, b) => a.week - b.week)[0];
    const { fond, dev } = phaseSplit(N, seg > 0, prepGoal?.sport === 'bike' ? bias : null);
    const phaseAt = (n) => (n < fond ? 'fondations' : n < fond + dev ? 'developpement' : 'specifique');
    const stepBase = 2 * seg;
    const steps = {};
    let n = 0; // rang parmi les semaines « normales » de cette préparation
    let w = i;
    while (w <= end) {
      if (kind[w] != null) {
        if (kind[w] === 'etape') {
          const before = w > i && kind[w - 1] == null ? infos[w - 1] : null;
          const phase = before?.phase && before.phase !== 'intro' ? before.phase : phaseAt(Math.min(n, Math.max(0, N - 1)));
          infos[w] = mk(phase, { cycleWeek: 4, cycleLen: before?.cycleLen ?? 0, isRecovery: true, etape: true, step: (steps[phase] ?? 0) + stepBase });
        } else {
          infos[w] = mk(kind[w], taperOf[w] ? { taperLen: taperOf[w] } : {});
        }
        w += 1;
        continue;
      }
      let e = w;
      while (e + 1 <= end && kind[e + 1] == null) e += 1;
      const { lead, blocks } = cycleBlocks(e - w + 1);
      let p = w;
      for (let l = 0; l < lead; l++) {
        // Tout début du plan : mise en route. Plus tard (après une course) : semaine de reprise.
        const phase = phaseAt(n);
        infos[p] = firstRun && w === 0 ? mk('intro') : mk(phase, { lead: true, step: (steps[phase] ?? 0) + stepBase });
        p += 1;
        n += 1;
      }
      blocks.forEach((len, b) => {
        for (let c = 1; c <= len; c++) {
          const phase = phaseAt(n);
          infos[p] = mk(phase, { cycleWeek: c, cycleLen: len, step: (steps[phase] ?? 0) + stepBase });
          steps[phase] = (steps[phase] ?? 0) + 1;
          p += 1;
          n += 1;
        }
        if (b < blocks.length - 1) {
          // La semaine allégée appartient à la phase du bloc qu'elle termine.
          const phase = infos[p - 1].phase;
          infos[p] = mk(phase, { cycleWeek: 4, cycleLen: len, isRecovery: true, step: (steps[phase] ?? 0) + stepBase });
          p += 1;
          n += 1;
        }
      });
      firstRun = false;
      w = e + 1;
    }
    i = end + 1;
    seg += 1;
  }

  // Ce que chaque semaine prépare, et les courses qui s'y trouvent.
  const strip = ({ week, ...g }) => g;
  for (let w = 0; w <= K; w++) {
    const races = at.filter((g) => g.week === w).sort(byDate).map(strip);
    const ahead = at.filter((g) => g.week >= w);
    const target = ahead.find((g) => g.major) ?? ahead[0] ?? null;
    if (races.length) infos[w].races = races;
    if (target) {
      infos[w].focus = target.sport;
      infos[w].goalId = target.id;
      infos[w].toGoal = target.week - w;
      if (target.format) infos[w].format = target.format;
    }
    // Lendemain de course de préparation : pas de séance dure dans les deux jours qui suivent.
    // `afterRace` = nombre de jours entre la course et ce lundi (1 = course le dimanche).
    const justRaced = w > 0 && kind[w] == null ? at.filter((g) => g.week === w - 1).sort(byDate).pop() : null;
    if (justRaced && 7 - dayIndex(justRaced.date) <= 2) infos[w].afterRace = 7 - dayIndex(justRaced.date);
  }
  return { infos, goalWeeks: at.map((g) => ({ id: g.id, week: g.week, major: g.major })) };
}

let calCache = { key: null, value: null };
function calendarFor(firstFull, profile) {
  const goals = goalsOf(profile);
  const bias = planBias(profile);
  const key = `${firstFull}|${bias}|${JSON.stringify(goals)}`;
  if (calCache.key !== key) calCache = { key, value: buildCalendar(firstFull, goals, bias) };
  return calCache.value;
}

function rolling(i) {
  const macro = Math.floor(i / 12);
  const phase = ['fondations', 'developpement', 'specifique'][Math.floor((i % 12) / 4)];
  const cycleWeek = (i % 4) + 1;
  const isRecovery = cycleWeek === 4;
  return mk(phase, { cycleWeek, cycleLen: 3, isRecovery, step: (isRecovery ? 3 : cycleWeek - 1) + macro * 2 });
}

/** Premier lundi « complet » du plan (un plan démarré du jeudi au dimanche commence vraiment le lundi suivant). */
export function firstFullWeek(plan) {
  const startWeek = mondayOf(plan.startDate);
  return dayIndex(plan.startDate) <= 2 ? startWeek : addDays(startWeek, 7);
}

/**
 * Phase, semaine du cycle et cran de progression pour la semaine commençant le `weekStart`.
 * Renvoie aussi, quand il y a des objectifs : `races` (courses de la semaine),
 * `focus` / `goalId` / `toGoal` (l'objectif préparé et le nombre de semaines qui en séparent),
 * `etape` (semaine de course de préparation), `lead` (semaine de reprise).
 */
export function weekInfo(profile, plan, weekStart) {
  const firstFull = firstFullWeek(plan);
  if (weekStart < firstFull) return mk('intro', { index: -1 });
  const index = diffDays(firstFull, weekStart) / 7;
  const cal = calendarFor(firstFull, profile);
  if (!cal) return { ...rolling(index), index };
  if (index < cal.infos.length) return { ...cal.infos[index], index };
  return { ...rolling(index - cal.infos.length), index };
}

/** Numéro de la semaine dans le plan (1 = première semaine complète) et total jusqu'au prochain objectif majeur. */
export function planProgress(profile, plan, weekStart) {
  const firstFull = firstFullWeek(plan);
  const n = diffDays(firstFull, weekStart) / 7 + 1;
  const cal = calendarFor(firstFull, profile);
  const ahead = (cal?.goalWeeks ?? []).filter((g) => g.week >= n - 1);
  const target = ahead.find((g) => g.major) ?? ahead[0] ?? null;
  return { week: n, total: target ? target.week + 1 : null };
}

// ---------------------------------------------------------------------------
// Combien de temps cette semaine ?
// ---------------------------------------------------------------------------

function baselineMin(profile, ctx, availMin) {
  const base = ctx.recentWeeklyMin ?? (Number(profile.hoursNow) || 3) * 60;
  return clamp(base, 60, Math.max(60, availMin));
}

/** Part du prévu réellement faite sur les semaines de charge du dernier cycle. */
function cycleCompliance(stored, ctx) {
  if (!ctx.weekActual) return null;
  const ratios = [];
  for (const w of stored.slice(-4)) {
    if (w.info?.isRecovery || w.info?.phase === 'intro' || !w.targetMin) continue;
    if (ctx.today && addDays(w.weekStart, 6) >= ctx.today) continue;
    const actual = ctx.weekActual(w.weekStart);
    if (actual) ratios.push(Math.min(1.2, actual.min / w.targetMin));
  }
  return ratios.length ? sum(ratios) / ratios.length : null;
}

function weekTarget(profile, plan, info, weekStart, ctx, avail, opts) {
  const lvl = LEVELS[profile.level] ?? LEVELS.intermediaire;
  const availMin = sum(avail);
  const stored = Object.values(plan.weeks ?? {})
    .filter((w) => w.weekStart < weekStart)
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
  const prev = stored[stored.length - 1];
  let ref;
  // D'où vient la référence : sert à expliquer le volume de la semaine.
  const basis = { from: 'prev' };
  if (opts.rebaseMin) {
    ref = opts.rebaseMin;
    basis.from = 'rebase';
  } else if (!prev || diffDays(prev.weekStart, weekStart) > 14) {
    ref = baselineMin(profile, ctx, availMin);
    basis.from = ctx.recentWeeklyMin != null ? 'recent' : 'declared';
  } else {
    ref = prev.refMin;
    if (info.cycleWeek === 1 && prev.info?.isRecovery) {
      const c = cycleCompliance(stored, ctx);
      const growth = c == null || c >= 0.8 ? lvl.growth : c >= 0.6 ? 1 : 0.9;
      ref *= growth;
      basis.growth = growth;
      if (c != null) basis.compliance = Math.round(c * 100) / 100;
    }
  }
  let mult = {
    intro: 0.85, affutage: 0.65, objectif: 0.4, recup: 0.4,
  }[info.phase] ?? (info.lead ? 0.85 : CYCLE_MULT[info.cycleWeek]) ?? 1;
  // Affûtage long (marathon, très longue distance) : la baisse est progressive, sur deux semaines.
  if (info.phase === 'affutage' && info.taperLen === 2) mult = info.toGoal >= 2 ? 0.75 : 0.6;
  // Semaine précédente presque blanche (moins de la moitié du prévu) : on ne poursuit pas la
  // montée en charge comme si de rien n'était, on repart du niveau de base du cycle.
  let eased = false;
  const loading = (w) => !w.info?.isRecovery && ['fondations', 'developpement', 'specifique'].includes(w.info?.phase);
  if (prev && !opts.rebaseMin && loading({ info }) && diffDays(prev.weekStart, weekStart) === 7 && mult > CYCLE_MULT[1]) {
    const done = ctx.weekActual?.(prev.weekStart);
    if (prev.relief) {
      // La semaine précédente a été allégée en route pour cause de fatigue : même prudence.
      mult = CYCLE_MULT[1];
      eased = 'fatigue';
    } else if (loading(prev) && done && prev.targetMin > 0 && done.min < 0.5 * prev.targetMin) {
      mult = CYCLE_MULT[1];
      eased = true;
    }
  }
  basis.mult = mult;
  return { targetMin: round5(clamp(ref * mult, 30, Math.max(30, availMin))), refMin: Math.round(ref), eased, basis };
}

// ---------------------------------------------------------------------------
// Quels jours, quelles séances ?
// ---------------------------------------------------------------------------

function* combinations(items, k, start = 0, acc = []) {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = start; i < items.length; i++) {
    acc.push(items[i]);
    yield* combinations(items, k, i + 1, acc);
    acc.pop();
  }
}

/** Choisit `n` jours parmi les jours possibles : du temps, et des jours bien répartis. */
function pickDays(days, avail, n) {
  if (days.length <= n) return days.slice();
  let best = null;
  for (const combo of combinations(days, n)) {
    let score = sum(combo.map((i) => Math.min(avail[i], 150))) / 30;
    for (let a = 1; a < combo.length; a++) if (combo[a] - combo[a - 1] === 1) score -= 1;
    if (!best || score > best.score + 1e-9) best = { score, combo };
  }
  return best.combo;
}

function scoreKeys(combo, longDay, sel, info, avail, wanted, keptHard = []) {
  let s = 0;
  for (let a = 0; a < combo.length; a++) {
    for (let b = a + 1; b < combo.length; b++) {
      const gap = Math.abs(combo[a] - combo[b]);
      s += gap === 1 ? -10 : Math.min(gap, 3);
    }
  }
  for (const d of combo) {
    if (longDay != null) {
      if (d === longDay + 1) s -= 8; // lendemain de sortie longue : jambes lourdes
      if (d === longDay - 1) s -= 5; // veille de sortie longue : seulement s'il n'y a pas mieux
    }
    if (keptHard.some((k) => Math.abs(k - d) === 1)) s -= 10; // à côté d'une séance dure déjà prévue ou faite
    if (!sel.includes(d - 1)) s += 1.5; // précédé d'un jour de repos : jambes fraîches
    s += avail[d] >= wanted ? 2 : -(wanted - avail[d]) / 15; // assez de temps pour la séance complète
    s += info.isRecovery ? d * 1.2 : -d * 0.05; // test en fin de semaine de récup, sinon plutôt tôt
  }
  return s;
}

function hardCount(level, info, n, budget, keyMin) {
  if (info.phase === 'intro' || info.phase === 'recup') return 0;
  let h;
  if (info.isRecovery) h = 1;
  else if (info.phase === 'affutage') h = level === 'debutant' ? 1 : 2;
  else h = { debutant: 1, intermediaire: 2, confirme: n >= 6 ? 3 : 2 }[level] ?? 2;
  // Tout premier pas d'un débutant : une semaine 100 % facile.
  if (level === 'debutant' && info.phase === 'fondations' && info.step === 0 && !info.isRecovery) h = 0;
  if (info.lead) h = Math.min(h, 1); // semaine de reprise après une course
  h = Math.min(h, Math.floor(n / 2));
  // Les séances clés ne doivent pas manger tout le temps de la semaine.
  const affordable = Math.floor((0.65 * budget) / keyMin);
  if (affordable < h) h = Math.max(n >= 2 && budget >= 80 ? 1 : 0, affordable);
  return h;
}

const KEY_KINDS = {
  bike: {
    fondations: ['sv1', 'force', 'sweetspot'],
    developpement: ['seuil', 'sweetspot', 'pma3030'],
    specifique: ['pma', 'seuil'],
    affutage: ['pma', 'seuil'],
  },
  run: {
    fondations: ['cotes', 'tempo'],
    developpement: ['seuil', 'tempo', 'cotes'],
    specifique: ['vma', 'seuil'],
    affutage: ['vma', 'tempo'],
  },
};

/**
 * Course à pied, objectif dont on connaît la distance : à l'approche du jour J,
 * la séance clé principale se court à l'allure visée (10 km : VMA d'abord,
 * allure ensuite ; semi : allure et côtes ; marathon : longs blocs à allure).
 */
const RUN_FORMAT_KEYS = {
  court: { specifique: ['vma', 'allure10'], affutage: ['allure10', 'vma'] },
  semi: { specifique: ['allure21', 'vma', 'cotes'], affutage: ['allure21', 'vma'] },
  marathon: { specifique: ['allure42', 'seuil', 'vma'], affutage: ['allure42', 'vma'] },
};

function keyKind(sport, info, nth, level, minutes) {
  let list = KEY_KINDS[sport][info.phase] ?? KEY_KINDS[sport].fondations;
  if (sport === 'run' && info.focus === 'run') list = RUN_FORMAT_KEYS[info.format]?.[info.phase] ?? list;
  // Épreuve courte : VMA et allure 10 km comptent autant. Avec une seule séance dure
  // à pied par semaine, elles alternent d'une semaine sur l'autre.
  if (list === RUN_FORMAT_KEYS.court.specifique && info.step % 2 === 1) list = ['allure10', 'vma'];
  if (level === 'debutant' && info.phase === 'fondations') {
    list = sport === 'bike' ? ['sv1', 'tempo'] : ['tempo', 'cotes'];
  }
  let kind = nth === 0 ? list[0] : list[1 + ((nth - 1 + info.step) % (list.length - 1))];
  // On découvre la PMA / VMA par du 30/30, plus digeste.
  if ((kind === 'pma' || kind === 'vma') && info.step === 0) kind = sport === 'bike' ? 'pma3030' : 'vma3030';
  if (minMinutes(sport, kind) > minutes) {
    const backups = list.concat(sport === 'bike' ? ['pma3030'] : ['vma3030', 'cotes']);
    kind = backups.find((k) => minMinutes(sport, k) <= minutes) ?? 'endurance';
  }
  return kind;
}

/**
 * Part du vélo dans la semaine. À l'approche d'un objectif (phases spécifique
 * et affûtage), on penche un peu plus vers le sport de cet objectif.
 */
export function weekSplit(profile, info) {
  const split = clamp(Number(profile.split ?? 0.5), 0, 1);
  if (split >= 0.999 || split <= 0.001 || !info?.focus) return split;
  if (info.phase !== 'specifique' && info.phase !== 'affutage') return split;
  return Math.round(clamp(split + (info.focus === 'bike' ? 0.15 : -0.15), 0.1, 0.9) * 100) / 100;
}

function assignSports(profile, info, roles, preferKey = null) {
  const split = weekSplit(profile, info);
  const main = primarySport(profile, info.focus);
  const other = main === 'bike' ? 'run' : 'bike';
  const mono = split >= 0.999 || split <= 0.001;
  const n = roles.length;
  const sportOf = {};
  if (mono) {
    for (const r of roles) sportOf[r.day] = main;
    return sportOf;
  }
  const balanced = split >= 0.35 && split <= 0.65;
  if (n === 1) {
    sportOf[roles[0].day] = balanced && info.index % 2 === 1 ? other : main;
    return sportOf;
  }
  const nBike = clamp(Math.round(n * split), 1, n - 1);
  const total = { bike: nBike, run: n - nBike };
  const want = { ...total };
  const take = (day, sport) => { sportOf[day] = sport; want[sport] -= 1; };

  // Profil équilibré sans objectif dans un sport précis : la séance longue alterne vélo / course.
  const long = roles.find((r) => r.role === 'long');
  const legacyGoal = !Array.isArray(profile.goals) && (profile.goal?.type === 'velo' || profile.goal?.type === 'course');
  const alternate = balanced && !info.focus && !legacyGoal;
  if (long) take(long.day, alternate && Math.max(0, info.index) % 2 === 1 ? other : main);

  // Une séance dure dans un sport suppose qu'on le pratique aussi en facile :
  // le sport secondaire n'y a droit qu'à partir de deux séances par semaine.
  const canKey = (sport) => want[sport] > 0 && (sport === main || total[sport] >= 2);
  const keys = roles.filter((r) => r.role === 'key').sort((a, b) => a.day - b.day);
  const swap = balanced ? info.index % 2 === 1 : info.index % 4 === 3;
  keys.forEach((k, i) => {
    const pref = i === 0 && preferKey ? preferKey : keys.length === 1 ? (swap ? other : main) : i % 2 === 0 ? main : other;
    const alt = pref === main ? other : main;
    if (canKey(pref)) take(k.day, pref);
    else if (canKey(alt)) take(k.day, alt);
    else k.role = 'easy';
  });

  // Séances faciles : la course à pied sur les petits créneaux, sans enchaîner deux jours de course.
  // Les décrassages vont de préférence au vélo (moins de chocs pour récupérer).
  const easy = roles.filter((r) => sportOf[r.day] == null)
    .sort((a, b) => (a.role === 'recup') - (b.role === 'recup') || a.cap - b.cap);
  let needRun = Math.max(0, want.run);
  const runDays = () => Object.keys(sportOf).filter((d) => sportOf[d] === 'run').map(Number);
  for (const pass of [0, 1]) {
    for (const r of easy) {
      if (needRun <= 0 || sportOf[r.day] != null) continue;
      const adjacent = runDays().some((d) => Math.abs(d - r.day) === 1);
      if (pass === 0 && adjacent) continue;
      sportOf[r.day] = 'run';
      needRun -= 1;
    }
  }
  for (const r of easy) if (sportOf[r.day] == null) sportOf[r.day] = 'bike';
  return sportOf;
}

/** Partage `budget` entre les séances restantes, au prorata des poids, entre mini et maxi. */
function fill(items, budget) {
  const live = items.filter((it) => !it.dropped);
  let rest = budget;
  for (const it of live) {
    it.dur = it.fixed ?? null;
    if (it.fixed != null) rest -= it.fixed;
  }
  const flex = live.filter((it) => it.fixed == null);
  let free = flex.slice();
  let pool = Math.max(0, rest);
  while (free.length) {
    const wsum = sum(free.map((f) => f.weight));
    const over = free.filter((f) => (pool * f.weight) / wsum > f.cap);
    if (over.length) {
      for (const f of over) { f.dur = f.cap; pool -= f.cap; }
      free = free.filter((f) => !over.includes(f));
      continue;
    }
    const under = free.filter((f) => (pool * f.weight) / wsum < f.min);
    if (under.length) {
      for (const f of under) { f.dur = f.min; pool -= f.min; }
      free = free.filter((f) => !under.includes(f));
      pool = Math.max(0, pool);
      continue;
    }
    for (const f of free) f.dur = (pool * f.weight) / wsum;
    break;
  }
  // Les minimums peuvent faire dépasser le volume visé : on rabote ce qui a encore de la marge.
  const excess = sum(live.map((it) => it.dur)) - budget;
  const roomy = flex.filter((f) => f.dur > f.min);
  const room = sum(roomy.map((f) => f.dur - f.min));
  if (excess > 0 && room > 0) {
    const k = Math.min(1, excess / room);
    for (const f of roomy) f.dur -= (f.dur - f.min) * k;
  }
  return excess - room; // > 0 : même au minimum partout, ça ne rentre pas
}

/**
 * Répartit le temps de la semaine. Quand le volume est trop juste, on retire
 * des séances faciles plutôt que d'émietter : mieux vaut une vraie sortie
 * longue (au moins un tiers du volume) que cinq petites séances.
 */
function allocate(items, budget) {
  const count = (sport) => items.filter((it) => !it.dropped && it.sport === sport).length;
  for (;;) {
    const overflow = fill(items, budget);
    // Candidates au retrait : d'abord les décrassages, puis les séances faciles (petits créneaux d'abord),
    // sans jamais retirer la dernière séance d'un sport s'il y a une autre possibilité.
    const droppable = items.filter((it) => !it.dropped && (it.role === 'recup' || it.role === 'easy'))
      .sort((a, b) => (b.role === 'recup') - (a.role === 'recup') || a.cap - b.cap);
    const drop = droppable.find((it) => count(it.sport) > 1) ?? droppable[0];
    if (!drop) break;
    const long = items.find((it) => it.role === 'long' && !it.dropped);
    const longTooShort = long && long.dur < Math.min(long.cap, 0.33 * budget) - 2.5;
    if (overflow <= 0 && !longTooShort) break;
    drop.dropped = true;
  }
  const kept = items.filter((it) => !it.dropped);
  for (const it of kept) it.dur = clamp(round5(it.dur), Math.min(it.min, it.cap), it.cap);
  return kept;
}

function makeSession(date, role, built, extra = {}) {
  return {
    id: `${date}-${built.sport}-${built.kind}`,
    date,
    role,
    status: 'planned',
    activityId: null,
    ...built,
    ...extra,
  };
}

/**
 * Semaine qui contient une ou plusieurs courses (objectif majeur ou étape) :
 * un peu d'endurance en début de semaine, un déblocage la veille ou l'avant-veille,
 * la course, et — pour une étape — un décrassage le lendemain.
 */
function raceWeek(profile, info, weekStart, avail, fromIdx, keptDays, targetMin = Infinity) {
  const races = info.races.slice().sort(byDate);
  const first = races[0];
  const firstIdx = dayIndex(first.date);
  const lastIdx = dayIndex(races[races.length - 1].date);
  const raceDays = new Set(races.map((r) => dayIndex(r.date)));
  const main = first.sport;
  const sessions = [];
  const days = [];
  for (let i = fromIdx; i < firstIdx; i++) if (!keptDays.has(i) && !raceDays.has(i) && avail[i] >= MIN_SLOT) days.push(i);
  const actDay = days.filter((d) => d >= firstIdx - 2).pop();
  if (actDay != null && avail[actDay] >= minMinutes(main, 'activation')) {
    sessions.push(makeSession(addDays(weekStart, actDay), 'key', buildSession({ sport: main, kind: 'activation', minutes: 40 })));
  }
  const early = [];
  for (const d of days.filter((x) => x !== actDay && x <= firstIdx - 3).reverse()) {
    if (early.length < 2 && early.every((e) => Math.abs(e - d) > 1)) early.push(d);
  }
  // Objectif majeur : la première séance de la semaine, à quatre jours ou plus de la course, garde
  // un peu d'intensité (court et vif). Pendant l'affûtage on réduit le volume, pas l'allure.
  const sharp = main === 'bike' ? 'pma' : 'vma';
  const sharpDay = info.phase === 'objectif' && profile.level !== 'debutant'
    ? early.filter((d) => firstIdx - d >= 4 && avail[d] >= minMinutes(main, sharp)).sort((a, b) => a - b)[0]
    : undefined;
  // Les sorties d'endurance se partagent ce qui reste du volume de la semaine : avant une course,
  // un petit volume habituel ne doit pas se transformer en grosse semaine.
  const fixed = (sessions.length ? 40 : 0) + (sharpDay != null ? (main === 'bike' ? 50 : 40) : 0);
  const nEasy = early.filter((d) => d !== sharpDay).length;
  const easyCap = main === 'bike' ? 50 : 35;
  const easyMin = nEasy ? clamp(round5((targetMin - fixed) / nEasy), 25, easyCap) : easyCap;
  early.forEach((d) => {
    if (d === sharpDay) {
      const built = buildSession({ sport: main, kind: sharp, minutes: Math.min(avail[d], main === 'bike' ? 50 : 40), step: 0, recovery: true });
      sessions.push(makeSession(addDays(weekStart, d), 'key', {
        ...built,
        why: 'Rappel d’intensité : court et vif, pour garder le moteur réveillé sans entamer la fraîcheur. Pendant l’affûtage, on réduit le volume, pas l’allure.',
      }, { indoor: main === 'bike' && isIndoorDay(profile, d), build: { step: 0, recovery: true, sprints: false, finish: false } }));
      return;
    }
    const minutes = Math.min(avail[d], easyMin);
    sessions.push(makeSession(addDays(weekStart, d), 'easy', buildSession({ sport: main, kind: 'endurance', minutes })));
  });
  const seen = new Set();
  for (const r of races) {
    const idx = dayIndex(r.date);
    if (idx < fromIdx || keptDays.has(idx)) continue;
    const race = makeSession(r.date, 'race', buildSession({ sport: r.sport, kind: 'course', minutes: 0 }), { goalId: r.id, major: !!r.major });
    if (r.name) race.title = r.name;
    if (seen.has(race.id)) race.id += `-${r.id}`;
    seen.add(race.id);
    sessions.push(race);
  }
  // Après une étape, la semaine continue : décrassage le lendemain de la course.
  // Après un objectif majeur, plus rien : la semaine de récupération suit.
  const next = lastIdx + 1;
  if (info.phase !== 'objectif' && next < 7 && next >= fromIdx && !keptDays.has(next) && avail[next] >= MIN_SLOT) {
    const sport = primarySport(profile, 'bike'); // à vélo quand c'est possible : moins de chocs
    const minutes = Math.min(avail[next], sport === 'bike' ? 40 : 30);
    sessions.push(makeSession(addDays(weekStart, next), 'recup', buildSession({ sport, kind: 'recup', minutes }), {
      indoor: sport === 'bike' && isIndoorDay(profile, next),
    }));
  }
  return sessions;
}

/**
 * Génère une semaine.
 * @param {object} ctx  { today, ctl, recentWeeklyMin, weekActual(monday) → {min, load}|null }
 * @param {object} opts { fromIdx, keep, rebaseMin, base: {targetMin, refMin} }
 */
export function generateWeek(profile, plan, weekStart, ctx = {}, opts = {}) {
  const info = weekInfo(profile, plan, weekStart);
  const lvl = LEVELS[profile.level] ?? LEVELS.intermediaire;
  const avail = normalizeAvail(profile.avail);
  const availWeek = sum(avail);
  const startIdx = weekStart === mondayOf(plan.startDate) ? dayIndex(plan.startDate) : 0;
  const fromIdx = Math.max(startIdx, opts.fromIdx ?? 0);
  const kept = opts.keep ?? [];
  const fromDate = addDays(weekStart, fromIdx);
  // Comptent dans le quota de la semaine : les séances faites, et celles ajoutées à la main qui restent à faire.
  const isManualPlanned = (s) => s.manual && s.status === 'planned';
  const keptLive = kept.filter((s) => s.status === 'done' || isManualPlanned(s));
  const keptDays = new Set(kept.filter((s) => s.status === 'done' || isManualPlanned(s) || s.date < fromDate).map((s) => dayIndex(s.date)));
  // Jours des séances dures ou longues conservées : on évite d'y coller une autre séance dure.
  const keptHard = kept.filter((s) => s.status !== 'skipped' && (s.hard >= 2 || s.role === 'long')).map((s) => dayIndex(s.date));
  // Temps déjà pris par les séances ajoutées à la main d'ici la fin de la semaine.
  const manualAhead = kept.filter((s) => isManualPlanned(s) && s.date >= fromDate);
  const manualMin = sum(manualAhead.map((s) => s.durationMin || 0));

  const { targetMin, refMin, eased, basis } = opts.base && !opts.rebaseMin
    ? opts.base
    : weekTarget(profile, plan, info, weekStart, ctx, avail, opts);
  const week = { weekStart, info, targetMin, refMin, sessions: [] };
  if (eased) week.eased = eased;
  if (basis) week.basis = basis;
  if (ctx.today) week.madeOn = ctx.today;
  // Charge visée pour la semaine, telle que prévue à la génération : le repère des ajustements automatiques.
  const seal = () => {
    // Les séances ajoutées à la main déjà présentes font partie de la charge prévue : le reste a été construit autour.
    week.sessions = week.sessions.map((s) => (s.manual && !s.counted ? { ...s, counted: true } : s));
    week.sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    week.loadPlan = Math.round(sum(week.sessions.filter((s) => s.status !== 'skipped').map((s) => s.load || 0)));
    return week;
  };

  if (info.races?.length) {
    week.sessions = [...kept, ...raceWeek(profile, info, weekStart, avail, fromIdx, keptDays, targetMin)];
    return seal();
  }

  const days = [];
  for (let i = fromIdx; i < 7; i++) if (!keptDays.has(i) && avail[i] >= MIN_SLOT) days.push(i);
  // Disponibilité restante, jours des séances ajoutées à la main compris (leur durée est retirée ensuite).
  const manualDays = new Set(manualAhead.map((s) => dayIndex(s.date)));
  const availRest = sum(days.map((i) => avail[i])) + sum([...manualDays].map((i) => avail[i]));
  const partial = fromIdx > 0 || kept.length > 0;
  const budgetFor = (target) => Math.max(0, (partial && availWeek > 0 ? (target * availRest) / availWeek : target) - manualMin);

  const cycleIdx = Math.floor(Math.max(0, info.index) / 4);
  const main = primarySport(profile, info.focus);
  const mono = (profile.split ?? 0.5) >= 0.999 || (profile.split ?? 0.5) <= 0.001;
  const beginner = (profile.level ?? 'intermediaire') === 'debutant';
  // Débutant qui ne fait que courir : trois sorties par semaine au plus, les chocs demandent du repos.
  const runOnlyBeginner = beginner && mono && main === 'run';
  const maxSessions = Math.min(lvl.maxSessions, 7 - lvl.minRest, info.phase === 'recup' ? 4 : 7, runOnlyBeginner ? RUN_START.perWeek : 7) - keptLive.length;
  // Les quatre premières semaines d'un débutant : des footings courts, sans séance dure à pied,
  // le temps que tendons et articulations s'habituent — sauf s'il court déjà régulièrement.
  const gentleRun = beginner && info.index < RUN_START.weeks && !((ctx.recentRunMin ?? 0) >= RUN_START.weeklyMin);
  // Semaine de récup = semaine de test : un cycle sur deux par sport.
  const testSport = !info.isRecovery ? null
    : mono ? (cycleIdx % 2 === 0 ? main : null)
      : cycleIdx % 2 === 0 ? main : (main === 'bike' ? 'run' : 'bike');

  const build = (budget, weekBudget) => {
    let n = Math.min(days.length, Math.max(0, maxSessions), Math.max(1, Math.floor(budget / 35)));
    if (budget < 20) n = 0;
    if (n === 0) return [];
    const sel = pickDays(days, avail, n);

    const keptKeys = keptLive.filter((s) => s.role === 'key').length;
    const keptLong = keptLive.some((s) => s.role === 'long');
    // Affûtage : le volume baisse, pas l'intensité ni le nombre de séances. Les séances
    // dures sont donc plus courtes (moins de répétitions, même allure), les autres aussi.
    const taper = info.phase === 'affutage';
    const keyFloor = (sport) => (taper ? (sport === 'bike' ? 45 : 35) : lvl.keyMin[sport]);
    const keyMinAvg = (keyFloor('bike') + keyFloor('run')) / 2;
    const weekSessions = n + keptLive.length;
    let nHard = Math.max(0, hardCount(profile.level, info, weekSessions, weekBudget, keyMinAvg) - keptKeys);

    // Sortie longue : le plus gros créneau (à égalité, le plus tard dans la semaine).
    let longDay = null;
    if (!keptLong && n >= 2) {
      longDay = sel.reduce((best, i) => (best == null || avail[i] >= avail[best] ? i : best), null);
    }
    const others = sel.filter((i) => i !== longDay);
    // Au sortir d'une course de préparation : pas de séance dure dans les deux jours qui suivent.
    let eligible = others.filter((i) => avail[i] >= 40 && !(info.afterRace && i + info.afterRace <= 2));
    if (testSport) {
      // Le test se place un jour où il tient en entier.
      const roomy = eligible.filter((i) => avail[i] >= minMinutes(testSport, 'test'));
      if (roomy.length) eligible = roomy;
    }
    nHard = Math.min(nHard, eligible.length);
    let bestKeys = { score: -Infinity, combo: [] };
    for (const combo of combinations(eligible, nHard)) {
      const score = scoreKeys(combo, longDay, sel, info, avail, keyMinAvg, keptHard);
      if (score > bestKeys.score) bestKeys = { score, combo };
    }
    const keyDays = bestKeys.combo;

    const roles = sel.map((day) => {
      let role = 'easy';
      if (day === longDay) role = 'long';
      else if (keyDays.includes(day)) role = 'key';
      return { day, role, cap: avail[day] };
    });
    // Lendemain de grosse séance, quand la semaine est chargée : simple décrassage.
    if (weekSessions >= 5) {
      for (const r of roles) {
        if (r.role === 'easy' && (keyDays.includes(r.day - 1) || longDay === r.day - 1)) r.role = 'recup';
      }
    }
    const sportOf = assignSports(profile, info, roles, testSport);
    if (gentleRun) {
      for (const r of roles) if (sportOf[r.day] === 'run' && r.role !== 'recup') r.role = 'easy';
    }

    const longFrac = (sport) => clamp((sport === 'bike' ? 0.7 : 0.55) + 0.045 * Math.max(0, info.index), 0, 1);
    const phaseLong = info.isRecovery ? 0.7 : ['affutage', 'intro', 'recup'].includes(info.phase) ? 0.6 : 1;
    const shape = (it) => {
      const { sport, indoor, slot } = it;
      delete it.fixed;
      it.weight = 1;
      if (it.role === 'key') {
        // Une séance clé peut s'allonger d'un peu d'endurance si le créneau et le volume le permettent.
        it.min = Math.min(slot, keyFloor(sport));
        it.cap = Math.min(slot, taper ? lvl.keyMin[sport] : lvl.keyMin[sport] + (sport === 'run' ? 10 : indoor ? 15 : 45));
        it.weight = 0.6;
      } else if (it.role === 'recup') {
        it.fixed = Math.min(slot, sport === 'bike' ? 40 : 30);
        it.cap = slot;
      } else if (it.role === 'long') {
        let cap = lvl.longMax[sport] * longFrac(sport) * phaseLong;
        if (indoor) cap = Math.min(cap, lvl.indoorLong);
        cap = Math.min(cap, budget * (n <= 2 ? 0.65 : 0.5));
        it.cap = Math.min(slot, Math.max(40, round5(cap)));
        it.min = Math.min(it.cap, taper ? (sport === 'bike' ? 45 : 30) : sport === 'bike' ? 60 : 40);
        it.weight = 2.2;
      } else {
        it.cap = Math.min(slot, sport === 'bike' ? (indoor ? 75 : 120) : gentleRun ? RUN_START.sessionMin : lvl.easyRun);
        it.min = Math.min(it.cap, taper || (gentleRun && sport === 'run') ? (sport === 'bike' ? 30 : 25) : sport === 'bike' ? 40 : 30);
      }
      return it;
    };
    const items = roles.map((r) => {
      const sport = sportOf[r.day];
      return shape({ day: r.day, role: r.role, slot: r.cap, sport, indoor: sport === 'bike' && isIndoorDay(profile, r.day), min: 30 });
    });
    // Si le volume visé ne rentre pas, les décrassages redeviennent de vraies sorties d'endurance.
    const capacity = () => sum(items.map((it) => it.fixed ?? it.cap));
    for (const it of items.filter((x) => x.role === 'recup').sort((a, b) => b.slot - a.slot)) {
      if (capacity() >= budget * 0.97) break;
      it.role = 'easy';
      shape(it);
    }

    const placed = allocate(items, budget).sort((a, b) => a.day - b.day);
    const nth = { bike: 0, run: 0 };
    const sprintsDone = { bike: false, run: false };

    return placed.map((it) => {
      const date = addDays(weekStart, it.day);
      const params = { sport: it.sport, minutes: it.dur, step: info.step + lvl.offset, recovery: info.isRecovery || taper };
      if (it.role === 'key') {
        if (testSport === it.sport && it.slot >= minMinutes(it.sport, 'test')) {
          params.kind = 'test';
          params.minutes = it.slot;
        } else {
          params.kind = keyKind(it.sport, info, nth[it.sport], profile.level, it.dur);
          nth[it.sport] += 1;
        }
      } else if (it.role === 'recup') {
        params.kind = 'recup';
      } else if (it.role === 'long') {
        params.kind = 'long';
        params.finish = it.sport === 'bike' && profile.level !== 'debutant' && !info.isRecovery
          && (info.phase === 'developpement' || info.phase === 'specifique');
      } else {
        params.kind = 'endurance';
        const gentle = profile.level === 'debutant' && info.phase === 'fondations' && info.step === 0;
        const wantsSprints = !info.isRecovery && !gentle && info.phase !== 'intro' && info.phase !== 'recup'
          && !sprintsDone[it.sport] && it.dur >= (it.sport === 'bike' ? 50 : 30);
        if (wantsSprints) { params.sprints = true; sprintsDone[it.sport] = true; }
      }
      const built = buildSession(params);
      const role = built.kind === 'endurance' && it.role === 'key' ? 'easy' : it.role;
      return makeSession(date, role, built, {
        indoor: it.indoor,
        build: { step: params.step, recovery: params.recovery, sprints: !!params.sprints, finish: !!params.finish },
      });
    });
  };

  let sessions = build(budgetFor(targetMin), targetMin);
  // Garde-fou : pas plus de 1,5 fois la charge à laquelle le corps est habitué.
  if (ctx.ctl != null && ctx.ctl >= 8 && !partial) {
    const cap = Math.max(150, 7 * ctx.ctl * 1.5);
    let scaled = targetMin;
    for (let i = 0; i < 4; i++) {
      const planned = sum(sessions.map((s) => s.load));
      if (planned <= cap * 1.05) break;
      scaled *= Math.max(0.3, cap / planned);
      sessions = build(budgetFor(scaled), scaled);
      week.capped = true;
    }
    if (week.capped) week.targetMin = round5(scaled);
  }
  week.sessions = [...kept, ...sessions];
  if (gentleRun && sessions.some((s) => s.sport === 'run')) week.gentleRun = true;
  return seal();
}

/** Aperçu des semaines à venir (sans les enregistrer), en supposant que le plan est suivi. */
export function previewWeeks(profile, plan, ctx, fromWeek, count) {
  const tmp = { ...plan, weeks: { ...(plan.weeks ?? {}) } };
  const out = [];
  for (let i = 0; i < count; i++) {
    const ws = addDays(fromWeek, 7 * i);
    const week = tmp.weeks[ws] ?? generateWeek(profile, tmp, ws, { today: ctx.today, ctl: null });
    tmp.weeks[ws] = week;
    out.push(week);
  }
  return out;
}

/** Recalcule les jours restants d'une semaine (à partir de `fromDate`) en gardant ce qui est fait. */
export function regenerateRest(profile, plan, weekStart, fromDate, ctx = {}, opts = {}) {
  const old = plan.weeks?.[weekStart];
  const keep = (old?.sessions ?? []).filter((s) => s.date < fromDate || s.status === 'done' || s.manual);
  const others = { ...plan, weeks: { ...(plan.weeks ?? {}) } };
  delete others.weeks[weekStart];
  const week = generateWeek(profile, others, weekStart, ctx, {
    fromIdx: Math.max(0, diffDays(weekStart, fromDate)),
    keep,
    base: old && !opts.rebaseMin ? { targetMin: old.targetMin, refMin: old.refMin, eased: old.eased, basis: old.basis } : undefined,
    rebaseMin: opts.rebaseMin,
  });
  // Ce qui a été décidé en cours de semaine reste vrai après un recalcul.
  if (old?.relief) week.relief = old.relief;
  return week;
}

// ---------------------------------------------------------------------------
// Ajuster une séance
// ---------------------------------------------------------------------------

/** Séances proposées à l'ajout manuel, par sport (dans l'ordre d'affichage). */
export const MANUAL_KINDS = {
  bike: ['recup', 'endurance', 'long', 'sv1', 'tempo', 'sweetspot', 'seuil', 'pma3030', 'pma', 'force', 'test'],
  run: ['recup', 'endurance', 'long', 'tempo', 'allure42', 'allure21', 'allure10', 'seuil', 'vma3030', 'vma', 'cotes', 'test'],
};

/** Durée proposée par défaut pour une séance ajoutée à la main. */
export function defaultMinutes(profile, sport, kind) {
  const lvl = LEVELS[profile?.level] ?? LEVELS.intermediaire;
  if (kind === 'recup') return sport === 'bike' ? 40 : 30;
  if (kind === 'endurance') return sport === 'bike' ? 60 : 45;
  if (kind === 'long') return sport === 'bike' ? 120 : 75;
  if (kind === 'test') return sport === 'bike' ? 70 : 37;
  return Math.max(minMinutes(sport, kind), lvl.keyMin[sport]);
}

/**
 * Construit une séance choisie par l'utilisateur, au niveau de progression
 * de la semaine où elle tombe (même cran que les séances du plan).
 * `others` : séances déjà prévues ce jour-là (pour le nom du fichier Zwift).
 */
export function manualSession(profile, week, { date, sport, kind, minutes }, others = []) {
  const lvl = LEVELS[profile?.level] ?? LEVELS.intermediaire;
  const info = week?.info ?? { step: 0, isRecovery: false };
  const build = { step: (info.step ?? 0) + lvl.offset, recovery: !!info.isRecovery };
  const built = buildSession({ sport, kind, minutes, ...build });
  const role = built.kind === 'long' ? 'long' : built.hard >= 2 ? 'key' : built.kind === 'recup' ? 'recup' : 'easy';
  const session = makeSession(date, role, built, {
    id: `${date}-${sport}-${built.kind}-m${Math.random().toString(36).slice(2, 8)}`,
    manual: true,
    indoor: sport === 'bike' && isIndoorDay(profile ?? {}, dayIndex(date)),
    build,
  });
  // Deux séances vélo le même jour : la seconde a son propre fichier Zwift.
  const bikes = others.filter((o) => o.sport === 'bike' && o.status !== 'skipped').length;
  if (sport === 'bike' && bikes > 0) session.zwoSlot = Math.min(3, bikes + 1);
  return session;
}

/** Ajoute une séance à une semaine, à la place d'une autre (`replaceId`) ou en plus. */
export function insertSession(week, session, replaceId = null) {
  const sessions = week.sessions.filter((s) => s.id !== replaceId);
  sessions.push(session);
  sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { ...week, sessions };
}

/** Retire une séance de sa semaine. */
export function removeSession(week, sessionId) {
  return { ...week, sessions: week.sessions.filter((s) => s.id !== sessionId) };
}

/** Même séance, autre durée (« j'ai moins de temps aujourd'hui »). */
export function resizeSession(session, minutes) {
  const built = buildSession({ sport: session.sport, kind: session.kind, minutes, ...(session.build ?? {}) });
  const role = built.kind !== session.kind && session.role === 'key' ? 'easy' : session.role;
  return { ...session, ...built, role, id: session.id, resized: true };
}

/** Version allégée : `mode` = 'facile' (endurance un peu plus courte) ou 'recup' (décrassage). */
export function lightenSession(session, mode) {
  const minutes = mode === 'recup'
    ? Math.min(session.durationMin, session.sport === 'bike' ? 40 : 30)
    : Math.max(30, round5(session.durationMin * 0.8));
  const built = buildSession({ sport: session.sport, kind: mode === 'recup' ? 'recup' : 'endurance', minutes });
  return { ...session, ...built, role: mode === 'recup' ? 'recup' : 'easy', id: session.id, lightened: session.title, build: {} };
}

/**
 * Déplace une séance clé ratée vers un jour plus favorable de la semaine :
 * elle échange sa place avec une séance facile à venir, loin des autres
 * séances dures. Renvoie la semaine modifiée, ou null si rien ne convient.
 */
export function moveKeySession(week, sessionId, today, avail) {
  const s = week.sessions.find((x) => x.id === sessionId);
  if (!s || s.role !== 'key') return null;
  const slots = normalizeAvail(avail);
  const stress = week.sessions.filter((x) => x !== s && (x.role === 'key' || x.role === 'long') && x.status !== 'skipped').map((x) => x.date);
  const candidates = week.sessions.filter((x) => x.date > today && x.status === 'planned' && (x.role === 'easy' || x.role === 'recup')
    && slots[dayIndex(x.date)] >= minMinutes(s.sport, s.kind)
    && !stress.some((d) => Math.abs(diffDays(d, x.date)) <= 1));
  if (!candidates.length) return null;
  const target = candidates[0];
  const moved = { ...s, date: target.date, id: `${target.date}-${s.sport}-${s.kind}`, status: 'planned', moved: true };
  const swapped = { ...target, date: s.date, id: `${s.date}-${target.sport}-${target.kind}`, status: 'skipped' };
  const sessions = week.sessions.map((x) => (x === s ? swapped : x === target ? moved : x))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { ...week, sessions };
}

/**
 * Relie les activités aux séances prévues du même jour et du même sport.
 * Modifie `plan` en place ; renvoie true si quelque chose a changé.
 */
export function linkActivities(plan, activities, today) {
  let changed = false;
  const linked = new Set();
  for (const w of Object.values(plan.weeks ?? {})) for (const s of w.sessions) if (s.activityId) linked.add(s.activityId);
  const byId = new Map(activities.map((a) => [a.id, a]));
  for (const w of Object.values(plan.weeks ?? {})) {
    for (const s of w.sessions) {
      if (s.activityId && !byId.has(s.activityId)) {
        // L'activité liée a disparu (supprimée ou fusionnée) : la séance redevient à faire.
        linked.delete(s.activityId);
        s.activityId = null;
        if (s.status === 'done') s.status = 'planned';
        changed = true;
      }
      if (s.status !== 'planned' || s.date > today) continue;
      const match = activities
        .filter((a) => a.date === s.date && a.sport === s.sport && !linked.has(a.id) && (a.durationSec ?? 0) >= 600)
        .sort((a, b) => (b.durationSec ?? 0) - (a.durationSec ?? 0))[0];
      if (match) {
        s.status = 'done';
        s.activityId = match.id;
        linked.add(match.id);
        changed = true;
      }
    }
  }
  return changed;
}
