// Le coach automatique.
//
// À chaque changement (activité enregistrée, séance ajoutée, ressenti du
// matin, nouvelle semaine), il relit la semaine en cours et la suivante et
// applique quelques règles simples. Chaque ajustement est écrit dans le
// journal du plan (`plan.journal`) avec sa raison, et peut être annulé.
//
// Les règles, dans l'ordre :
// 1. nouvelle semaine  → elle est recalculée d'après ce qui a vraiment été fait ;
// 2. séance clé ratée  → elle prend la place d'une séance facile à venir ;
// 3. séance dure ajoutée ou imprévue à côté d'une séance clé → la séance clé
//    change de jour, ou devient de l'endurance ;
// 4. fatigue du jour   → la séance dure est reportée ou allégée ;
// 5. fatigue qui dure  → la fin de semaine devient une semaine allégée ;
// 6. semaine trop chargée (séance ajoutée, sortie imprévue) → on retire du
//    volume facile pour retrouver la charge prévue.
//
// Principes : on ne touche jamais à une séance que tu as choisie ou réglée
// toi-même, on ne rajoute jamais de charge pour « rattraper », et relancer le
// coach sans rien de neuf ne change rien.

import { addDays, mondayOf, dayIndex, diffDays, fmtDuration, DAYS } from './dates.js';
import { minMinutes } from './workouts.js';
import { normalizeAvail, resizeSession, lightenSession, generateWeek, isIndoorDay } from './plan.js';

const sum = (a) => a.reduce((s, x) => s + x, 0);
const round5 = (m) => Math.round(m / 5) * 5;
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const isPlanned = (s) => s.status === 'planned';
const dayName = (date) => DAYS[dayIndex(date)].name.toLowerCase();
const DayName = (date) => DAYS[dayIndex(date)].name;
export const sessionLabel = (s) => `${s.title}${s.detail ? ` ${s.detail}` : ''}`;
const withDur = (s) => `${sessionLabel(s)}${s.durationMin ? ` (${fmtDuration(s.durationMin)})` : ''}`;

/** Séance que tu as choisie ou réglée toi-même : le coach n'y touche pas. */
export const isPinned = (s) => !!(s.manual || s.keepAsIs || s.resized || s.lightened || s.moved);

const JOURNAL_MAX = 60;
/** En dessous de 10 minutes, raccourcir une séance n'est que du bruit. */
const MIN_CUT = 10;

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

const entryOf = (plan, key) => (plan.journal ?? []).find((e) => e.key === key) ?? null;

function upsert(plan, entry) {
  plan.journal ??= [];
  const old = entryOf(plan, entry.key);
  if (old) {
    // Même décision qu'avant : rien de neuf à signaler.
    if (old.title === entry.title && JSON.stringify(old.changes) === JSON.stringify(entry.changes)) return;
    plan.journal = plan.journal.filter((e) => e !== old);
  }
  plan.journal.push({ seen: false, undone: false, ...entry });
}

function drop(plan, key) {
  if (plan.journal) plan.journal = plan.journal.filter((e) => e.key !== key);
}

/** Note un événement dans le journal (changement d'objectif, recalcul demandé…). */
export function note(plan, today, { rule, title, why, changes = [], weekStart = null }) {
  plan.journal ??= [];
  const n = plan.journal.filter((e) => e.date === today && e.rule === rule).length;
  plan.journal.push({ key: `${rule}:${today}:${n}`, date: today, rule, title, why, changes, weekStart, seen: true, undone: false });
  trim(plan, today);
}

function trim(plan, today) {
  const limit = addDays(today, -90);
  plan.journal = (plan.journal ?? []).filter((e) => e.date >= limit).slice(-JOURNAL_MAX);
}

/** Ajustements pas encore vus, du plus récent au plus ancien. */
export function pendingNotices(plan) {
  return (plan?.journal ?? []).filter((e) => !e.seen && !e.undone).slice().reverse();
}

export function markSeen(plan, key = null) {
  let changed = false;
  for (const e of plan?.journal ?? []) {
    if (!e.seen && (key == null || e.key === key)) { e.seen = true; changed = true; }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Modifier une séance en gardant de quoi revenir en arrière
// ---------------------------------------------------------------------------

/**
 * La séance `next` remplace `prev` ; `prev` est conservée pour pouvoir annuler.
 * `pair` : identifiant commun aux deux séances d'un échange (on n'annule pas l'une sans l'autre).
 */
function stamp(prev, next, rule, key, today, what, pair = null) {
  const { zwift, resized, lightened, moved, ...clean } = next; // le fichier déjà envoyé à Zwift n'est plus le bon
  const auto = { rule, key, date: today, what, from: sessionLabel(prev), prev };
  if (pair) auto.pair = pair;
  return { ...clean, auto };
}

function replace(week, old, next) {
  week.sessions = week.sessions.map((s) => (s === old ? next : s)).sort(byDate);
}

const fit = (session, minutes) => resizeSession(session, minutes);
const soften = (session, mode) => lightenSession(session, mode);

/**
 * Peut-on encore revenir sur cette séance modifiée par le coach ? Oui tant qu'elle
 * est à faire, que tu ne l'as pas réglée toi-même depuis, et que revenir en
 * arrière ne la renvoie pas dans le passé.
 */
function restorable(s, today) {
  if (!s.auto?.prev || isPinned(s) || s.auto.prev.date < today) return false;
  return isPlanned(s) || (s.status === 'skipped' && (s.auto.what === 'annulée' || s.auto.what === 'retirée'));
}

/** Les deux séances d'un échange sont-elles toujours là, toutes les deux annulables ? */
function wholePairs(members, today) {
  const pairs = {};
  for (const s of members) if (s.auto.pair) (pairs[s.auto.pair] ??= []).push(s);
  return Object.values(pairs).every((p) => p.length === 2 && p.every((s) => restorable(s, today)));
}

/** Annule les modifications portant la clé `key`. Tout ou rien : renvoie false s'il en reste. */
function restore(week, key, today) {
  const members = week.sessions.filter((s) => s.auto?.key === key);
  if (!members.length) return true;
  if (!members.every((s) => restorable(s, today)) || !wholePairs(members, today)) return false;
  week.sessions = week.sessions.map((s) => (s.auto?.key === key ? s.auto.prev : s)).sort(byDate);
  return true;
}

// ---------------------------------------------------------------------------
// Lire la semaine
// ---------------------------------------------------------------------------

function freeActivities(week, env) {
  const end = addDays(week.weekStart, 6);
  const linked = new Set(week.sessions.map((s) => s.activityId).filter(Boolean));
  return (env.activities ?? []).filter((a) => a.date >= week.weekStart && a.date <= end && !linked.has(a.id));
}

/** Activité intense (au moins « costaud » pendant une bonne demi-heure) ou compétition. */
function isIntense(a) {
  const hours = (a.durationSec ?? 0) / 3600;
  const load = a.load ?? 0;
  return !!a.race || (load >= 45 && hours > 0 && load / hours >= 75);
}
/** Grosse sortie : beaucoup de charge, même à allure tranquille. */
const isBig = (a) => (a.load ?? 0) >= 100;

const isHardSession = (s) => s.hard >= 2 || s.role === 'key';

/**
 * Jours qui fatiguent, hors `except` : `hard` = séances clés, courses, activités
 * libres intenses ; `long` = sorties longues et grosses sorties tranquilles.
 */
function stressDates(week, env, except = []) {
  const hard = [];
  const long = [];
  for (const s of week.sessions) {
    if (except.includes(s) || s.status === 'skipped') continue;
    if (isPlanned(s) && s.date < env.today) continue; // manquée : elle n'a fatigué personne
    if (isHardSession(s) || s.role === 'race') hard.push(s.date);
    else if (s.role === 'long') long.push(s.date);
  }
  for (const a of freeActivities(week, env)) {
    if (isIntense(a)) hard.push(a.date);
    else if (isBig(a)) long.push(a.date);
  }
  return { hard, long };
}

/**
 * Jour où déplacer la séance dure `key` : elle y échange sa place avec une
 * séance facile du plan, sur un créneau assez long. Jamais à côté d'un autre
 * jour dur, jamais le lendemain d'une sortie longue ; la veille d'une sortie
 * longue seulement s'il n'y a pas mieux (comme dans le plan lui-même).
 */
function findSwap(profile, week, key, env, { from }) {
  const avail = normalizeAvail(profile.avail);
  const stress = stressDates(week, env, [key]);
  const need = minMinutes(key.sport, key.kind);
  const busyToday = (env.activities ?? []).some((a) => a.date === env.today);
  const eve = (x) => (stress.long.some((d) => diffDays(x.date, d) === 1) ? 1 : 0);
  return week.sessions
    .filter((x) => x !== key && isPlanned(x) && !isPinned(x) && (x.role === 'easy' || x.role === 'recup'))
    .filter((x) => x.date >= from && x.date !== key.date && !(x.date === env.today && busyToday))
    .filter((x) => avail[dayIndex(x.date)] >= need)
    .filter((x) => !stress.hard.some((d) => Math.abs(diffDays(d, x.date)) <= 1))
    .filter((x) => !stress.long.some((d) => { const gap = diffDays(d, x.date); return gap === 0 || gap === 1; }))
    .sort((x, y) => eve(x) - eve(y) || byDate(x, y))[0] ?? null;
}

function moveTo(profile, week, s, date) {
  const taken = new Set(week.sessions.filter((x) => x !== s).map((x) => x.id));
  let id = `${date}${s.id.slice(10)}`;
  while (taken.has(id)) id += 'b';
  const out = { ...s, date, id };
  if (s.sport === 'bike') out.indoor = isIndoorDay(profile, dayIndex(date));
  return out;
}

/**
 * Échange la séance dure `key` avec la séance facile `easy`.
 * `easyAs` : ce que devient la séance facile sur l'ancien jour de la séance dure
 * (null = telle quelle, 'recup' = décrassage, 'skip' = annulée).
 */
function swap(profile, week, key, easy, { rule, entryKey, today, easyAs = null }) {
  const avail = normalizeAvail(profile.avail);
  let k2 = moveTo(profile, week, key, easy.date);
  const slotK = avail[dayIndex(easy.date)];
  if (k2.durationMin > slotK) k2 = fit(k2, slotK);
  let e2 = moveTo(profile, week, easy, key.date);
  const slotE = avail[dayIndex(key.date)];
  if (slotE >= 25 && e2.durationMin > slotE) e2 = fit(e2, slotE);
  if (easyAs === 'recup' && e2.kind !== 'recup') e2 = soften(e2, 'recup');
  if (easyAs === 'skip') e2 = { ...e2, status: 'skipped' };
  const pair = `${entryKey}#${key.id}`;
  week.sessions = week.sessions
    .map((s) => (s === key ? stamp(key, k2, rule, entryKey, today, 'déplacée', pair)
      : s === easy ? stamp(easy, e2, rule, entryKey, today, easyAs === 'skip' ? 'annulée' : 'déplacée', pair) : s))
    .sort(byDate);
  return { key: k2, easy: e2 };
}

// ---------------------------------------------------------------------------
// 1. Nouvelle semaine : recalculée d'après ce qui a vraiment été fait
// ---------------------------------------------------------------------------

const outline = (sessions) => sessions.filter((s) => !s.manual).map((s) => [s.date, s.sport, s.kind, s.durationMin].join(':')).join('|');
const digest = (sessions) => sessions.filter((s) => s.status !== 'skipped')
  .map((s) => `${dayName(s.date).slice(0, 3)}. ${sessionLabel(s)}${s.durationMin ? ` ${fmtDuration(s.durationMin)}` : ''}`).join(' · ') || 'repos';

function refreshWeek(profile, plan, monday, env) {
  const week = plan.weeks[monday];
  if (!week || !env.ctx || !week.madeOn || week.madeOn >= monday) return;
  // Déjà entamée ou réglée à la main : on la laisse.
  if (week.sessions.some((s) => s.status !== 'planned' || s.auto || (isPinned(s) && !s.manual))) { week.madeOn = env.today; return; }
  const keep = week.sessions.filter((s) => s.date < env.today || s.manual);
  const others = { ...plan, weeks: { ...plan.weeks } };
  delete others.weeks[monday];
  const fresh = generateWeek(profile, others, monday, env.ctx, { fromIdx: Math.max(0, diffDays(monday, env.today)), keep });
  if (outline(fresh.sessions) === outline(week.sessions)) {
    week.madeOn = env.today;
    return;
  }
  plan.weeks[monday] = fresh;
  const why = fresh.eased === 'fatigue'
    ? 'La semaine dernière a été allégée en route parce que tu étais fatigué. On ne reprend pas la montée en charge là où elle s’était arrêtée : cette semaine repart du niveau de base du cycle.'
    : fresh.eased
      ? 'La semaine dernière a été presque blanche (moins de la moitié du prévu). Reprendre comme si de rien n’était, c’est le meilleur moyen de se blesser : cette semaine repart du niveau de base du cycle.'
      : 'Cette semaine avait été préparée à l’avance. Maintenant que la précédente est terminée, elle est recalculée d’après ce que tu as vraiment fait (volume, charge, séances manquées).';
  upsert(plan, {
    key: `refresh:${monday}`, date: env.today, rule: 'refresh', weekStart: monday,
    title: 'Nouvelle semaine recalculée',
    why,
    changes: [
      `Volume prévu : ${fmtDuration(week.targetMin)} → ${fmtDuration(fresh.targetMin)}`,
      `Avant : ${digest(week.sessions)}`,
      `Maintenant : ${digest(fresh.sessions)}`,
    ],
  });
}

// ---------------------------------------------------------------------------
// 2. Séance clé ratée
// ---------------------------------------------------------------------------

function missedKeys(profile, plan, week, env) {
  if (env.level === 'rouge' || env.level === 'orange' || week.relief || week.info?.races?.length) return;
  const free = freeActivities(week, env);
  const missed = week.sessions.filter((s) => isPlanned(s) && s.date < env.today && s.role === 'key' && !isPinned(s) && !s.auto);
  for (const k of missed) {
    const key = `missed:${k.id}`;
    if (entryOf(plan, key)) continue;
    // Une autre séance intense a été faite ce jour-là : l'effort y est, inutile de le refaire.
    if (free.some((a) => a.date === k.date && isIntense(a))) continue;
    const target = findSwap(profile, week, k, env, { from: env.today });
    if (!target) continue;
    const moved = swap(profile, week, k, target, { rule: 'missed', entryKey: key, today: env.today, easyAs: 'skip' });
    upsert(plan, {
      key, date: env.today, rule: 'missed', weekStart: week.weekStart,
      title: `Séance clé déplacée à ${dayName(moved.key.date)}`,
      why: `Tu n’as pas fait ta séance clé de ${dayName(k.date)} (${sessionLabel(k)}). C’est elle qui fait progresser cette semaine, alors elle prend la place d’une séance facile, celle qu’on peut sacrifier sans regret. Elle reste à distance des autres séances dures. Le volume manqué, lui, n’est pas rattrapé.`,
      changes: [`${DayName(target.date)} : ${withDur(target)} → ${withDur(moved.key)}`],
    });
  }
}

// ---------------------------------------------------------------------------
// 3. Séance dure ajoutée, ou grosse sortie imprévue, à côté d'une séance clé
// ---------------------------------------------------------------------------

function extrasOf(week, env) {
  const mine = week.sessions
    .filter((s) => s.manual && s.status !== 'skipped' && (s.status === 'done' || s.date >= env.today))
    .filter((s) => isHardSession(s) || s.role === 'long')
    .map((s) => ({ id: s.id, date: s.date, name: sessionLabel(s), mine: true, both: isHardSession(s) }));
  const free = freeActivities(week, env)
    .filter((a) => a.date <= env.today && (isIntense(a) || isBig(a)))
    .map((a) => ({ id: a.id, date: a.date, name: a.name || 'activité libre', mine: false, both: isIntense(a) }));
  return [...mine, ...free];
}

function clashes(profile, plan, week, env) {
  // Une cause disparue (séance retirée, activité supprimée) : on revient en arrière.
  const extras = extrasOf(week, env);
  const exists = (id) => week.sessions.some((s) => s.id === id) || (env.activities ?? []).some((a) => a.id === id);
  for (const e of (plan.journal ?? []).filter((x) => x.rule === 'clash' && x.weekStart === week.weekStart && !x.undone)) {
    if (exists(e.cause)) continue;
    if (restore(week, e.key, env.today)) drop(plan, e.key);
  }
  if (week.info?.races?.length) return;
  for (const x of extras) {
    const keys = week.sessions.filter((s) => isPlanned(s) && s.date >= env.today && !isPinned(s) && isHardSession(s) && s.role !== 'race');
    for (const k of keys) {
      const gap = diffDays(x.date, k.date); // 1 = la séance clé tombe le lendemain
      if (!(gap === 0 || gap === 1 || (gap === -1 && x.both))) continue;
      const key = `clash:${k.id}:${x.id}`;
      if (entryOf(plan, key)) continue;
      const cause = x.mine ? `Tu as ajouté « ${x.name} » ${dayName(x.date)}` : `Tu as fait une grosse séance imprévue ${dayName(x.date)} (${x.name})`;
      const where = gap === 0 ? 'le même jour que' : gap === 1 ? 'la veille de' : 'le lendemain de';
      const rule = 'Deux jours durs de suite, c’est beaucoup de fatigue pour peu de progrès : c’est la récupération entre les deux qui fait progresser.';
      // Un effort dur compte déjà comme séance de qualité : la séance clé voisine n'est pas déplacée, elle s'efface.
      const target = x.both ? null : findSwap(profile, week, k, env, { from: env.today });
      if (target) {
        const moved = swap(profile, week, k, target, { rule: 'clash', entryKey: key, today: env.today });
        upsert(plan, {
          key, date: env.today, rule: 'clash', weekStart: week.weekStart, cause: x.id,
          title: `Séance clé déplacée à ${dayName(moved.key.date)}`,
          why: `${cause}, ${where} la séance clé du plan (${sessionLabel(k)}). ${rule} La séance clé change donc de jour et échange sa place avec une séance facile.`,
          changes: [
            `${DayName(moved.key.date)} : ${withDur(target)} → ${withDur(moved.key)}`,
            `${DayName(moved.easy.date)} : ${withDur(k)} → ${withDur(moved.easy)}`,
          ],
        });
      } else {
        const next = soften(k, 'facile');
        replace(week, k, stamp(k, next, 'clash', key, env.today, 'allégée'));
        upsert(plan, {
          key, date: env.today, rule: 'clash', weekStart: week.weekStart, cause: x.id,
          title: `${sessionLabel(k)} devient de l’endurance`,
          why: `${cause}, ${where} la séance clé du plan (${sessionLabel(k)}). ${rule} ${x.both
            ? `${x.mine ? 'Ta séance' : 'Cet effort'} compte comme une séance de qualité de la semaine : la séance clé du plan lui laisse la place et devient une sortie facile.`
            : 'Aucun autre jour ne convenait cette semaine : la séance clé devient une sortie facile.'}`,
          changes: [`${DayName(k.date)} : ${withDur(k)} → ${withDur(next)}`],
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Fatigue du jour
// ---------------------------------------------------------------------------

function fatigue(profile, plan, week, env) {
  const key = `fatigue:${env.today}`;
  if (entryOf(plan, key)?.undone) return;
  // On repart de la semaine telle qu'elle était, puis on redécide avec le ressenti actuel.
  if (!restore(week, key, env.today)) return;
  const level = env.level;
  if (level !== 'orange' && level !== 'rouge') { drop(plan, key); return; }
  const sick = !!env.checkins?.[env.today]?.sick;
  const changes = [];
  let postponed = false;
  const todays = week.sessions.filter((s) => s.date === env.today && isPlanned(s) && !isPinned(s) && s.role !== 'race');
  for (const s of todays) {
    const hard = isHardSession(s);
    if (level === 'orange' && !hard) continue;
    if (level === 'rouge' && !sick && s.kind === 'recup' && s.durationMin <= 40) continue;
    // D'abord essayer de reporter la séance dure à un jour où elle servira.
    if (hard && !week.info?.races?.length && !week.relief) {
      const target = findSwap(profile, week, s, env, { from: addDays(env.today, 2) })
        ?? (level === 'orange' ? findSwap(profile, week, s, env, { from: addDays(env.today, 1) }) : null);
      if (target) {
        const moved = swap(profile, week, s, target, { rule: 'fatigue', entryKey: key, today: env.today, easyAs: sick ? 'skip' : level === 'rouge' ? 'recup' : null });
        postponed = true;
        changes.push(`${DayName(moved.key.date)} : ${withDur(target)} → ${withDur(moved.key)}`);
        changes.push(`${DayName(env.today)} : ${withDur(s)} → ${moved.easy.status === 'skipped' ? 'repos complet' : withDur(moved.easy)}`);
        continue;
      }
    }
    if (sick) {
      replace(week, s, stamp(s, { ...s, status: 'skipped' }, 'fatigue', key, env.today, 'annulée'));
      changes.push(`${DayName(env.today)} : ${withDur(s)} → repos complet`);
    } else {
      const next = soften(s, level === 'rouge' ? 'recup' : 'facile');
      replace(week, s, stamp(s, next, 'fatigue', key, env.today, 'allégée'));
      changes.push(`${DayName(env.today)} : ${withDur(s)} → ${withDur(next)}`);
    }
  }
  if (!changes.length) { drop(plan, key); return; }
  const reasons = (env.reasons ?? []).join(' ');
  const why = sick
    ? `Tu as signalé que tu es malade ou blessé. On ne s’entraîne pas dans cet état : le corps a besoin de toute son énergie pour récupérer.${postponed ? ' La séance dure n’est pas perdue, elle est reportée à un jour où elle servira.' : ''}`
    : level === 'rouge'
      ? `${reasons} Feu rouge : une séance faite dans cet état fatigue beaucoup et n’apporte rien. Aujourd’hui c’est décrassage très court (ou repos complet si tu préfères).${postponed ? ' La séance dure est reportée à un jour où elle servira.' : ''}`
      : `${reasons} Une séance dure faite fatigué, c’est beaucoup de fatigue pour peu de progrès.${postponed ? ' Elle est reportée à un jour où tu pourras la faire bien ; aujourd’hui, du facile.' : ' Aucun autre jour ne convenait cette semaine : elle devient une sortie facile.'}`;
  upsert(plan, {
    key, date: env.today, rule: 'fatigue', weekStart: week.weekStart,
    title: sick ? 'Repos : tu es malade ou blessé' : level === 'rouge' ? 'Séance du jour allégée : feu rouge' : postponed ? 'Séance dure reportée : tu es fatigué' : 'Séance du jour allégée : tu es fatigué',
    why: why.trim(),
    changes,
  });
}

// ---------------------------------------------------------------------------
// 5. Fatigue qui dure : la fin de semaine devient une semaine allégée
// ---------------------------------------------------------------------------

function relief(profile, plan, week, env) {
  const key = `relief:${week.weekStart}`;
  const old = entryOf(plan, key);
  if (old && (old.undone || old.date !== env.today)) return;
  if (old) {
    if (!restore(week, key, env.today)) return;
    delete week.relief;
  }
  const bad = (d) => {
    const c = env.checkins?.[d];
    return !!c && (!!c.sick || (c.feel != null && c.feel <= 2));
  };
  const days = [0, 1, 2].filter((i) => bad(addDays(env.today, -i))).length;
  if (!bad(env.today) || days < 2) { drop(plan, key); return; }
  const changes = [];
  const rest = week.sessions.filter((s) => isPlanned(s) && s.date > env.today && !isPinned(s) && s.role !== 'race');
  for (const s of rest) {
    if (isHardSession(s)) {
      const next = soften(s, 'facile');
      replace(week, s, stamp(s, next, 'relief', key, env.today, 'allégée'));
      changes.push(`${DayName(s.date)} : ${withDur(s)} → ${withDur(next)}`);
    } else if (s.role === 'long') {
      const minutes = Math.max(s.sport === 'bike' ? 60 : 40, round5(s.durationMin * 0.75));
      if (minutes > s.durationMin - MIN_CUT) continue;
      const next = fit(s, minutes);
      replace(week, s, stamp(s, next, 'relief', key, env.today, 'raccourcie'));
      changes.push(`${DayName(s.date)} : ${sessionLabel(s)} ${fmtDuration(s.durationMin)} → ${fmtDuration(next.durationMin)}`);
    }
  }
  week.relief = env.today;
  changes.push('Semaine prochaine : reprise au niveau de base du cycle, sans rattraper');
  upsert(plan, {
    key, date: env.today, rule: 'relief', weekStart: week.weekStart,
    title: 'Fin de semaine allégée : la fatigue s’installe',
    why: `Cela fait ${days} jours sur les trois derniers que tu te dis fatigué ou malade. Un jour sans, ça arrive ; plusieurs de suite, c’est le signe que la charge dépasse ce que tu assimiles en ce moment. Momo transforme le reste de la semaine en semaine allégée : plus de séance dure, sortie longue raccourcie. Mieux vaut perdre trois jours que trois semaines.`,
    changes,
  });
}

// ---------------------------------------------------------------------------
// 6. Semaine plus chargée que prévu : on retire du volume facile
// ---------------------------------------------------------------------------

function unwindBalance(week, today) {
  week.sessions = week.sessions
    .map((s) => (s.auto?.rule === 'balance' && s.date >= today && restorable(s, today) ? s.auto.prev : s))
    .sort(byDate);
}

function balance(profile, plan, week, env) {
  const key = `balance:${week.weekStart}`;
  if (week.loadPlan == null) {
    // Semaine créée avant l'arrivée du coach : ce qui s'y trouve déjà est la référence.
    week.loadPlan = Math.round(sum(week.sessions.filter((s) => s.status !== 'skipped').map((s) => s.load || 0)));
    for (const s of week.sessions) if (s.manual) s.counted = true;
  }
  const old = entryOf(plan, key);
  if (week.noBalance || old?.undone) return;
  // Ce qui s'est ajouté au plan : séances choisies après coup et activités libres.
  const added = week.sessions.filter((s) => s.manual && !s.counted && s.status !== 'skipped');
  const free = freeActivities(week, env).filter((a) => a.date <= env.today);
  const cause = [...added.map((s) => s.id), ...free.map((a) => a.id)].sort().join(',');
  // Même cause qu'à la dernière décision : on ne retouche pas la semaine tous les jours.
  if (old && old.cause === cause) return;
  unwindBalance(week, env.today);
  if (week.info?.races?.length || week.relief) { drop(plan, key); return; }

  const end = addDays(week.weekStart, 6);
  const acts = (env.activities ?? []).filter((a) => a.date >= week.weekStart && a.date <= end && a.date <= env.today);
  const remaining = week.sessions.filter((s) => isPlanned(s) && s.date >= env.today);
  const projected = sum(acts.map((a) => a.load ?? 0)) + sum(remaining.map((s) => s.load || 0));
  const intended = week.loadPlan;
  const extraLoad = sum(added.map((s) => s.load || 0)) + sum(free.map((a) => a.load ?? 0));
  let need = Math.min(projected - Math.max(intended * 1.12, intended + 20), extraLoad);
  if (!(need >= 10)) { drop(plan, key); return; }
  const over = Math.round(((projected - intended) / Math.max(1, intended)) * 100);

  const changes = [];
  const pool = () => week.sessions.filter((s) => isPlanned(s) && s.date >= env.today && !isPinned(s) && !s.auto && s.role !== 'race');
  const apply = (s, next, what, line) => {
    need -= (s.load || 0) - (next.status === 'skipped' ? 0 : next.load || 0);
    replace(week, s, stamp(s, next, 'balance', key, env.today, what));
    changes.push(line);
  };
  // a) les décrassages sont facultatifs
  for (const s of pool().filter((x) => x.role === 'recup').reverse()) {
    if (need < 10) break;
    apply(s, { ...s, status: 'skipped' }, 'retirée', `${DayName(s.date)} : ${withDur(s)} → retirée (décrassage facultatif)`);
  }
  // b) les séances d'endurance raccourcissent, toutes dans la même proportion
  const easy = pool().filter((x) => x.role === 'easy');
  const floor = (s) => Math.min(s.durationMin, s.sport === 'bike' ? 40 : 30);
  const room = sum(easy.map((s) => (s.durationMin - floor(s)) * ((s.load || 0) / Math.max(1, s.durationMin))));
  if (need >= 10 && room > 0) {
    const f = Math.min(1, need / room);
    for (const s of easy) {
      const minutes = Math.max(floor(s), round5(s.durationMin - f * (s.durationMin - floor(s))));
      if (minutes > s.durationMin - MIN_CUT) continue; // rogner 5 minutes ne change rien : on laisse
      const next = fit(s, minutes);
      apply(s, next, 'raccourcie', `${DayName(s.date)} : ${sessionLabel(s)} ${fmtDuration(s.durationMin)} → ${fmtDuration(next.durationMin)}`);
    }
  }
  // c) puis la sortie longue, de 30 % au plus
  for (const s of pool().filter((x) => x.role === 'long')) {
    if (need < 10) break;
    const lowest = Math.max(s.sport === 'bike' ? 60 : 40, round5(s.durationMin * 0.7));
    const perMin = (s.load || 0) / Math.max(1, s.durationMin);
    const minutes = Math.max(lowest, round5(s.durationMin - need / Math.max(0.1, perMin)));
    if (minutes > s.durationMin - MIN_CUT) continue;
    const next = fit(s, minutes);
    apply(s, next, 'raccourcie', `${DayName(s.date)} : ${sessionLabel(s)} ${fmtDuration(s.durationMin)} → ${fmtDuration(next.durationMin)}`);
  }
  // d) en dernier recours, si ce qui a été ajouté était dur : une séance clé du plan devient facile
  const hardExtra = added.some(isHardSession) || free.some(isIntense);
  if (hardExtra && need > 0.1 * intended) {
    const k = pool().filter(isHardSession).pop();
    if (k) {
      const next = soften(k, 'facile');
      apply(k, next, 'allégée', `${DayName(k.date)} : ${withDur(k)} → ${withDur(next)}`);
    }
  }
  if (!changes.length) { drop(plan, key); return; }
  const names = [...added.map((s) => `« ${sessionLabel(s)} »`), ...free.map((a) => `« ${a.name || 'activité libre'} »`)];
  const what = names.length === 1 ? names[0] : `${names.length} séances en plus`;
  upsert(plan, {
    key, date: env.today, rule: 'balance', weekStart: week.weekStart, cause,
    title: `Semaine rééquilibrée autour de ${what}`,
    why: `Avec ${what}, la semaine ferait ${Math.round(projected)} points de charge au lieu des ${Math.round(intended)} prévus (+${over} %). Le plan vise une charge précise chaque semaine : assez pour progresser, pas trop pour assimiler. Momo retire donc un peu de volume facile ailleurs, sans toucher à la qualité tant que c’est possible.${need >= 10 ? ' Le reste du dépassement est accepté : pas question de vider ta semaine.' : ''}`,
    changes,
  });
}

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

/**
 * Applique les règles à la semaine en cours et à la suivante.
 * @param {object} env { today, activities, checkins, level, reasons, ctx }
 *   level / reasons : feu du jour (readiness) ; ctx : contexte de génération (planCtx).
 * Modifie `plan` en place ; renvoie true si quelque chose a changé.
 */
export function runCoach(profile, plan, env) {
  if (!profile || !plan?.weeks || !env?.today) return false;
  plan.journal ??= [];
  const monday = mondayOf(env.today);
  const next = addDays(monday, 7);
  const print = () => JSON.stringify([plan.weeks[monday] ?? null, plan.weeks[next] ?? null, plan.journal]);
  const before = print();

  refreshWeek(profile, plan, monday, env);
  const week = plan.weeks[monday];
  if (week) {
    missedKeys(profile, plan, week, env);
    clashes(profile, plan, week, env);
    relief(profile, plan, week, env); // avant la fatigue du jour : si la semaine est allégée, on ne reporte plus rien
    fatigue(profile, plan, week, env);
    balance(profile, plan, week, env);
  }
  const upcoming = plan.weeks[next];
  if (upcoming) {
    clashes(profile, plan, upcoming, env);
    balance(profile, plan, upcoming, env);
  }
  trim(plan, env.today);
  return print() !== before;
}

/** Peut-on proposer « Rétablir » pour cet ajustement ? */
export function canUndo(plan, entry, today) {
  if (!entry || entry.undone || !entry.weekStart || entry.rule === 'missed' || entry.rule === 'refresh') return false;
  const week = plan?.weeks?.[entry.weekStart];
  const members = (week?.sessions ?? []).filter((s) => s.auto?.key === entry.key);
  if (!members.length) return false;
  return members.every((s) => restorable(s, today)) && wholePairs(members, today);
}

/**
 * Annule un ajustement : les séances reviennent comme avant et le coach ne
 * refera pas ce changement (elles sont marquées « je garde ma séance »).
 */
export function undoEntry(plan, key, today) {
  const entry = entryOf(plan, key);
  if (!canUndo(plan, entry, today)) return false;
  const week = plan.weeks[entry.weekStart];
  week.sessions = week.sessions
    .map((s) => (s.auto?.key === entry.key ? { ...s.auto.prev, keepAsIs: true } : s))
    .sort(byDate);
  if (entry.rule === 'relief') delete week.relief;
  if (entry.rule === 'balance') week.noBalance = true;
  entry.undone = true;
  entry.seen = true;
  return true;
}
