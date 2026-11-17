import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addDays, dayIndex, mondayOf } from '../public/engine/dates.js';
import {
  LEVELS, weekInfo, generateWeek, previewWeeks, regenerateRest, resizeSession, lightenSession,
  moveKeySession, linkActivities, planProgress, primarySport,
  MANUAL_KINDS, defaultMinutes, manualSession, insertSession, removeSession,
} from '../public/engine/plan.js';
import { zwoFileName } from '../public/engine/zwo.js';

const base = {
  name: 'Test', level: 'intermediaire', split: 0.6, hoursNow: 5, indoor: 'semaine',
  avail: [60, 0, 75, 0, 60, 120, 180],
  goal: { type: 'forme' },
  refs: {},
};
const MONDAY = '2026-11-16';
const sumMin = (w) => w.sessions.reduce((s, x) => s + x.durationMin, 0);

function checkWeek(profile, week, label) {
  const lvl = LEVELS[profile.level];
  const ids = new Set();
  const byDay = {};
  for (const s of week.sessions) {
    const d = dayIndex(s.date);
    assert.ok(!ids.has(s.id), `${label} : identifiant en double ${s.id}`);
    ids.add(s.id);
    assert.ok(!byDay[d], `${label} : deux séances le même jour`);
    byDay[d] = s;
    assert.equal(mondayOf(s.date), week.weekStart, `${label} : séance hors de la semaine`);
    if (s.role !== 'race') {
      assert.ok(s.durationMin <= profile.avail[d], `${label} : ${s.title} dure ${s.durationMin} min pour ${profile.avail[d]} min dispo`);
      assert.ok(s.durationMin >= 20, `${label} : séance trop courte (${s.durationMin})`);
      assert.ok(s.load > 0, `${label} : charge nulle`);
    }
    if (profile.split >= 0.999) assert.equal(s.sport, 'bike', label);
    if (profile.split <= 0.001) assert.equal(s.sport, 'run', label);
  }
  // Jamais deux séances dures deux jours de suite
  for (let d = 0; d < 6; d++) {
    const hardPair = byDay[d]?.hard >= 2 && byDay[d + 1]?.hard >= 2;
    assert.ok(!hardPair, `${label} : deux séances dures de suite (${byDay[d]?.title}, ${byDay[d + 1]?.title})`);
  }
  assert.ok(week.sessions.length <= lvl.maxSessions, `${label} : trop de séances`);
  assert.ok(7 - week.sessions.length >= lvl.minRest, `${label} : pas assez de repos`);
  assert.ok(sumMin(week) <= profile.avail.reduce((a, b) => a + b, 0) + 5, `${label} : dépasse le temps disponible`);
}

test('une semaine type respecte le temps disponible et l’alternance dur / facile', () => {
  const plan = { startDate: MONDAY, weeks: {} };
  const week = generateWeek(base, plan, MONDAY, {});
  checkWeek(base, week, 'semaine 1');
  assert.equal(week.info.phase, 'fondations');
  assert.equal(week.info.cycleWeek, 1);
  // Volume proche de l'habitude déclarée (5 h)
  assert.ok(Math.abs(sumMin(week) - 300) <= 30, `volume ${sumMin(week)} min`);
  // La sortie longue tombe sur le plus gros créneau (dimanche)
  const long = week.sessions.find((s) => s.role === 'long');
  assert.equal(dayIndex(long.date), 6);
  assert.equal(long.sport, 'bike');
  // Pas de séance un jour sans disponibilité
  assert.ok(week.sessions.every((s) => base.avail[dayIndex(s.date)] > 0));
  // Deux séances clés pour un niveau intermédiaire
  assert.equal(week.sessions.filter((s) => s.role === 'key').length, 2);
});

test('toutes les combinaisons de profils donnent des semaines valides sur 20 semaines', () => {
  const avails = [
    [60, 60, 60, 60, 60, 120, 180],
    [0, 45, 0, 45, 0, 90, 0],
    [30, 30, 30, 30, 30, 30, 30],
    [0, 0, 0, 0, 0, 180, 240],
    [90, 0, 0, 0, 0, 0, 0],
    [45, 60, 45, 60, 45, 150, 120],
  ];
  let count = 0;
  for (const level of Object.keys(LEVELS)) {
    for (const split of [0, 0.3, 0.5, 0.8, 1]) {
      for (const avail of avails) {
        for (const hoursNow of [2, 6, 12]) {
          const profile = { ...base, level, split, avail, hoursNow };
          const plan = { startDate: MONDAY, weeks: {} };
          const weeks = previewWeeks(profile, plan, {}, MONDAY, 20);
          weeks.forEach((w, i) => checkWeek(profile, w, `${level} split=${split} dispo=${avail.join('/')} h=${hoursNow} s${i + 1}`));
          count += weeks.length;
        }
      }
    }
  }
  assert.equal(count, 3 * 5 * 6 * 3 * 20);
});

test('cycle 3/1 : la charge monte trois semaines puis redescend', () => {
  const profile = { ...base, avail: [90, 90, 90, 90, 90, 240, 240] };
  const weeks = previewWeeks(profile, { startDate: MONDAY, weeks: {} }, {}, MONDAY, 8);
  const mins = weeks.map(sumMin);
  assert.deepEqual(weeks.map((w) => w.info.cycleWeek), [1, 2, 3, 4, 1, 2, 3, 4]);
  assert.ok(weeks.every((w) => w.info.cycleLen === 3));
  assert.ok(mins[1] > mins[0] && mins[2] > mins[1], `progression ${mins.join(', ')}`);
  assert.ok(mins[3] < mins[0] * 0.8, `semaine de récup ${mins[3]} vs ${mins[0]}`);
  // Le cycle suivant repart un peu plus haut que le précédent
  assert.ok(mins[4] > mins[0], `nouveau cycle ${mins[4]} vs ${mins[0]}`);
  assert.ok(mins[4] <= mins[0] * 1.12);
  // Semaine de récup : une séance de test, pas d'autre séance dure
  const rec = weeks[3];
  assert.equal(rec.sessions.filter((s) => s.hard >= 2).length, 1);
  assert.equal(rec.sessions.find((s) => s.hard >= 2).kind, 'test');
});

test('phases : fondations → développement → spécifique, puis affûtage avant l’objectif', () => {
  const rolling = previewWeeks(base, { startDate: MONDAY, weeks: {} }, {}, MONDAY, 13).map((w) => w.info.phase);
  assert.deepEqual(rolling.slice(0, 12), [
    ...Array(4).fill('fondations'), ...Array(4).fill('developpement'), ...Array(4).fill('specifique'),
  ]);
  assert.equal(rolling[12], 'fondations');

  const goalDate = addDays(MONDAY, 7 * 13 + 6); // un dimanche, 14e semaine
  const profile = { ...base, goal: { type: 'velo', name: 'La Cyclo', date: goalDate } };
  const plan = { startDate: MONDAY, weeks: {} };
  const weeks = previewWeeks(profile, plan, {}, MONDAY, 16);
  const phases = weeks.map((w) => w.info.phase);
  assert.equal(phases[13], 'objectif');
  assert.equal(phases[12], 'affutage');
  assert.equal(phases[11], 'specifique');
  assert.equal(phases[0], 'fondations');
  assert.equal(phases[14], 'recup');
  assert.equal(phases[15], 'fondations');
  // La dernière semaine de charge n'est pas une semaine de récup
  assert.equal(weeks[11].info.isRecovery, false);
  // L'affûtage allège nettement
  assert.ok(sumMin(weeks[12]) < sumMin(weeks[11]) * 0.8);
  // Semaine de l'objectif : la course est au bon jour, déblocage la veille ou l'avant-veille
  const goalWeek = weeks[13];
  const race = goalWeek.sessions.find((s) => s.role === 'race');
  assert.equal(race.date, goalDate);
  assert.equal(race.title, 'La Cyclo');
  const act = goalWeek.sessions.find((s) => s.kind === 'activation');
  assert.ok(act && act.date < goalDate);
  assert.ok(goalWeek.sessions.every((s) => s.date <= goalDate));
  assert.deepEqual(planProgress(profile, plan, MONDAY), { week: 1, total: 14 });
  assert.equal(planProgress(base, plan, addDays(MONDAY, 14)).total, null);
});

test('débutant : première semaine sans séance dure, deux jours de repos', () => {
  const profile = { ...base, level: 'debutant', hoursNow: 2, avail: [45, 45, 45, 45, 45, 90, 90] };
  const weeks = previewWeeks(profile, { startDate: MONDAY, weeks: {} }, {}, MONDAY, 3);
  assert.equal(weeks[0].sessions.filter((s) => s.hard >= 2).length, 0);
  assert.ok(weeks[0].sessions.length <= 4);
  assert.ok(weeks[1].sessions.some((s) => s.role === 'key'));
});

test('démarrage en fin de semaine : petite semaine de mise en route', () => {
  const plan = { startDate: '2026-11-15', weeks: {} }; // un dimanche
  const info = weekInfo(base, plan, '2026-11-09');
  assert.equal(info.phase, 'intro');
  const week = generateWeek(base, plan, '2026-11-09', {});
  assert.equal(week.sessions.length, 1);
  assert.equal(week.sessions[0].date, '2026-11-15');
  assert.equal(week.sessions[0].hard, 0);
  assert.equal(weekInfo(base, plan, MONDAY).cycleWeek, 1);
  // Démarrage un mardi : la semaine en cours est déjà la semaine 1
  const tue = { startDate: '2026-11-17', weeks: {} };
  const w = generateWeek(base, tue, MONDAY, {});
  assert.equal(w.info.cycleWeek, 1);
  assert.ok(w.sessions.every((s) => s.date >= '2026-11-17'));
});

test('sports : répartition vélo / course et séances clés', () => {
  const profile = { ...base, split: 0.5, avail: [60, 60, 60, 60, 60, 120, 150] };
  const week = generateWeek(profile, { startDate: MONDAY, weeks: {} }, MONDAY, {});
  const bikes = week.sessions.filter((s) => s.sport === 'bike').length;
  const runs = week.sessions.filter((s) => s.sport === 'run').length;
  assert.ok(bikes >= 2 && runs >= 2, `${bikes} vélo / ${runs} course`);
  assert.equal(primarySport({ ...base, split: 0.3 }), 'run');
  assert.equal(primarySport({ ...base, split: 0.3, goal: { type: 'velo' } }), 'bike');
  assert.equal(primarySport({ ...base, split: 1, goal: { type: 'course' } }), 'bike');
  // « Surtout vélo » avec peu de volume : on garde quand même une course à pied chaque semaine de charge
  const fewHours = { ...base, split: 0.75, hoursNow: 4, avail: [60, 60, 45, 60, 60, 90, 120] };
  for (const w of previewWeeks(fewHours, { startDate: MONDAY, weeks: {} }, {}, MONDAY, 8)) {
    if (!w.info.isRecovery) assert.ok(w.sessions.some((s) => s.sport === 'run'), `pas de course la semaine du ${w.weekStart}`);
  }
  // Sport secondaire pratiqué une seule fois par semaine : toujours en facile
  const mostlyBike = { ...base, split: 0.8, avail: [60, 60, 60, 60, 60, 120, 150] };
  for (const w of previewWeeks(mostlyBike, { startDate: MONDAY, weeks: {} }, {}, MONDAY, 12)) {
    const r = w.sessions.filter((s) => s.sport === 'run');
    if (r.length === 1) assert.ok(r[0].hard < 2, `course unique mais dure : ${r[0].title}`);
  }
});

test('le volume s’adapte à ce qui est réellement fait', () => {
  const profile = { ...base, avail: [90, 90, 90, 90, 90, 240, 240] };
  const plan = { startDate: MONDAY, weeks: {} };
  for (let i = 0; i < 4; i++) {
    const ws = addDays(MONDAY, 7 * i);
    plan.weeks[ws] = generateWeek(profile, plan, ws, {});
  }
  const next = addDays(MONDAY, 28);
  const ref = plan.weeks[addDays(MONDAY, 21)].refMin;
  const followed = generateWeek(profile, plan, next, { today: next, weekActual: (ws) => ({ min: plan.weeks[ws].targetMin, load: 0 }) });
  const half = generateWeek(profile, plan, next, { today: next, weekActual: (ws) => ({ min: plan.weeks[ws].targetMin * 0.5, load: 0 }) });
  assert.ok(followed.refMin > ref, 'plan suivi : le volume de référence augmente');
  assert.ok(half.refMin < ref, 'plan à moitié suivi : le volume de référence baisse');
  // Semaine précédente presque blanche : pas de montée en charge, on repart du niveau de base du cycle
  const p2 = { startDate: MONDAY, weeks: {} };
  p2.weeks[MONDAY] = generateWeek(profile, p2, MONDAY, {});
  const second = addDays(MONDAY, 7);
  const actual = (ratio) => ({ today: second, weekActual: (ws) => ({ min: p2.weeks[ws].targetMin * ratio, load: 0 }) });
  const normal = generateWeek(profile, p2, second, actual(1));
  const afterBlank = generateWeek(profile, p2, second, actual(0.2));
  assert.equal(normal.info.cycleWeek, 2);
  assert.ok(normal.targetMin > p2.weeks[MONDAY].targetMin, 'semaine suivie : ça monte');
  assert.equal(normal.eased, undefined);
  assert.equal(afterBlank.targetMin, p2.weeks[MONDAY].targetMin);
  assert.equal(afterBlank.eased, true);
  // À moitié faite ou plus : la progression continue
  assert.equal(generateWeek(profile, p2, second, actual(0.6)).targetMin, normal.targetMin);

  // Garde-fou : jamais plus de 1,5 fois la charge habituelle
  const big = { ...profile, hoursNow: 12 };
  const guarded = generateWeek(big, { startDate: MONDAY, weeks: {} }, MONDAY, { ctl: 20 });
  assert.equal(guarded.capped, true);
  assert.ok(guarded.sessions.reduce((s, x) => s + x.load, 0) <= 7 * 20 * 1.5 * 1.25);
});

test('recalcul en cours de semaine : ce qui est fait est conservé', () => {
  const plan = { startDate: MONDAY, weeks: {} };
  const week = generateWeek(base, plan, MONDAY, {});
  plan.weeks[MONDAY] = week;
  const first = week.sessions[0];
  first.status = 'done';
  const from = addDays(MONDAY, 3);
  const changed = { ...base, avail: [60, 0, 75, 0, 0, 60, 60] };
  const redo = regenerateRest(changed, plan, MONDAY, from, {});
  assert.ok(redo.sessions.some((s) => s.id === first.id && s.status === 'done'));
  assert.equal(redo.targetMin, week.targetMin);
  const later = redo.sessions.filter((s) => s.date >= from);
  assert.ok(later.length > 0);
  assert.ok(later.every((s) => changed.avail[dayIndex(s.date)] > 0 && s.durationMin <= changed.avail[dayIndex(s.date)]));
  // Les séances d'avant restent en place
  assert.deepEqual(redo.sessions.filter((s) => s.date < from).map((s) => s.id), week.sessions.filter((s) => s.date < from).map((s) => s.id));
});

test('ajuster une séance : moins de temps, plus facile, déplacée', () => {
  const plan = { startDate: MONDAY, weeks: {} };
  const week = generateWeek(base, plan, MONDAY, {});
  const key = week.sessions.find((s) => s.role === 'key');
  const shorter = resizeSession(key, 50);
  assert.equal(shorter.id, key.id);
  assert.ok(shorter.durationMin <= 52);
  const easy = lightenSession(key, 'facile');
  assert.equal(easy.kind, 'endurance');
  assert.equal(easy.hard, 0);
  assert.equal(easy.lightened, key.title);
  assert.ok(easy.durationMin < key.durationMin);
  assert.equal(lightenSession(key, 'recup').kind, 'recup');

  const moved = moveKeySession(week, key.id, key.date, base.avail);
  if (moved) {
    const again = moved.sessions.find((s) => s.kind === key.kind && s.status === 'planned');
    assert.ok(again.date > key.date);
    assert.equal(moved.sessions.length, week.sessions.length);
    assert.equal(new Set(moved.sessions.map((s) => s.id)).size, moved.sessions.length);
  }
});

test('les activités importées valident les séances prévues', () => {
  const plan = { startDate: MONDAY, weeks: {} };
  plan.weeks[MONDAY] = generateWeek(base, plan, MONDAY, {});
  const s = plan.weeks[MONDAY].sessions[0];
  const acts = [
    { id: 'zwift:a', date: s.date, sport: s.sport, durationSec: 3000 },
    { id: 'zwift:b', date: s.date, sport: s.sport, durationSec: 300 },
    { id: 'x', date: s.date, sport: s.sport === 'bike' ? 'run' : 'bike', durationSec: 3000 },
  ];
  assert.equal(linkActivities(plan, acts, addDays(MONDAY, 6)), true);
  assert.equal(s.status, 'done');
  assert.equal(s.activityId, 'zwift:a');
  assert.equal(linkActivities(plan, acts, addDays(MONDAY, 6)), false);
  // L'activité disparaît : la séance redevient à faire
  assert.equal(linkActivities(plan, [], addDays(MONDAY, 6)), true);
  assert.equal(s.status, 'planned');
  assert.equal(s.activityId, null);
});

test('séance ajoutée à la main : construite au bon niveau, conservée par les recalculs', () => {
  const plan = { startDate: MONDAY, weeks: {} };
  plan.weeks[MONDAY] = generateWeek(base, plan, MONDAY, {});
  const week = plan.weeks[MONDAY];

  // Mercredi (jour de repos dans le profil) : un seuil au vélo
  const wed = addDays(MONDAY, 2);
  const s = manualSession(base, week, { date: wed, sport: 'bike', kind: 'seuil', minutes: 70 });
  assert.equal(s.manual, true);
  assert.equal(s.role, 'key');
  assert.equal(s.status, 'planned');
  assert.equal(s.kind, 'seuil');
  assert.ok(s.durationMin <= 70 && s.durationMin >= 60);
  assert.equal(s.indoor, true); // vélo en semaine sur home trainer dans ce profil
  assert.match(s.id, /^2026-11-18-bike-seuil-m[a-z0-9]+$/);
  assert.deepEqual(s.build, { step: 1, recovery: false }); // cran de la semaine + niveau intermédiaire
  assert.equal(s.zwoSlot, undefined);
  // Trop court : la séance devient de l'endurance, mais reste « à moi »
  const short = manualSession(base, week, { date: wed, sport: 'bike', kind: 'seuil', minutes: 25 });
  assert.equal(short.kind, 'endurance');
  assert.equal(short.fallback, true);
  assert.equal(short.role, 'easy');
  assert.equal(short.manual, true);
  // Rôles
  assert.equal(manualSession(base, week, { date: wed, sport: 'run', kind: 'long', minutes: 75 }).role, 'long');
  assert.equal(manualSession(base, week, { date: wed, sport: 'run', kind: 'recup', minutes: 30 }).role, 'recup');
  assert.equal(defaultMinutes(base, 'bike', 'endurance'), 60);
  assert.equal(defaultMinutes(base, 'run', 'vma'), 55);
  assert.ok(MANUAL_KINDS.bike.includes('sweetspot') && !MANUAL_KINDS.run.includes('sweetspot'));

  plan.weeks[MONDAY] = insertSession(week, s);
  assert.equal(plan.weeks[MONDAY].sessions.length, week.sessions.length + 1);
  // Les dates restent dans l'ordre
  const dates = plan.weeks[MONDAY].sessions.map((x) => x.date);
  assert.deepEqual(dates, [...dates].sort());

  // Recalcul de la semaine depuis le lundi (bouton « Recalculer », changement de profil…)
  const redo = regenerateRest(base, plan, MONDAY, MONDAY, {});
  const mine = redo.sessions.filter((x) => x.manual);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].id, s.id);
  assert.equal(redo.sessions.filter((x) => x.date === wed).length, 1, 'pas d’autre séance le même jour');
  // Pas d'autre séance dure la veille ni le lendemain du seuil ajouté
  for (const d of [addDays(wed, -1), addDays(wed, 1)]) {
    assert.ok(!redo.sessions.some((x) => x.date === d && x.hard >= 2), `séance dure le ${d}`);
  }
  // Le seuil ajouté compte comme une des deux séances clés de la semaine
  assert.equal(redo.sessions.filter((x) => x.role === 'key').length, 2);
  // Le volume total reste proche de la cible : la séance ajoutée est prise sur le reste
  const total = redo.sessions.reduce((t, x) => t + x.durationMin, 0);
  assert.ok(total <= redo.targetMin + 40, `volume ${total} pour une cible de ${redo.targetMin}`);
  // …et toutes les séances générées respectent toujours le temps disponible
  for (const x of redo.sessions.filter((y) => !y.manual)) assert.ok(x.durationMin <= base.avail[dayIndex(x.date)]);

  // Recalcul en milieu de semaine : la séance ajoutée (à venir) est toujours là
  const later = regenerateRest(base, { ...plan, weeks: { [MONDAY]: redo } }, MONDAY, addDays(MONDAY, 1), {});
  assert.ok(later.sessions.some((x) => x.id === s.id));

  // Retirer la séance
  const removed = removeSession(redo, s.id);
  assert.ok(!removed.sessions.some((x) => x.id === s.id));
  assert.equal(removed.sessions.length, redo.sessions.length - 1);
});

test('séance ajoutée à la place d’une autre, ou en plus le même jour', () => {
  const plan = { startDate: MONDAY, weeks: {} };
  const week = generateWeek(base, plan, MONDAY, {});
  const sunday = week.sessions.find((x) => x.role === 'long');
  // À la place
  const swap = manualSession(base, week, { date: sunday.date, sport: 'run', kind: 'long', minutes: 80 });
  const replaced = insertSession(week, swap, sunday.id);
  assert.equal(replaced.sessions.length, week.sessions.length);
  assert.ok(!replaced.sessions.some((x) => x.id === sunday.id));
  assert.equal(replaced.sessions.find((x) => x.date === sunday.date).sport, 'run');
  // En plus : deuxième séance vélo le même jour → fichier Zwift distinct
  const others = week.sessions.filter((x) => x.date === sunday.date);
  const extra = manualSession(base, week, { date: sunday.date, sport: 'bike', kind: 'recup', minutes: 30 }, others);
  assert.equal(extra.zwoSlot, 2);
  assert.equal(zwoFileName(extra), 'enduro-7-dim-2.zwo');
  assert.equal(zwoFileName(sunday), 'enduro-7-dim.zwo');
  const both = insertSession(week, extra);
  assert.equal(both.sessions.filter((x) => x.date === sunday.date).length, 2);
  // Une course en plus n'a pas besoin de fichier Zwift
  assert.equal(manualSession(base, week, { date: sunday.date, sport: 'run', kind: 'recup', minutes: 30 }, others).zwoSlot, undefined);
});

test('cycles avant un objectif : jamais plus de 3 semaines de charge, jamais une seule', () => {
  for (const level of Object.keys(LEVELS)) {
    for (let total = 3; total <= 32; total++) {
      const goalDate = addDays(MONDAY, 7 * (total - 1) + 5); // un samedi
      const profile = { ...base, level, goal: { type: 'velo', name: 'Objectif', date: goalDate } };
      const weeks = previewWeeks(profile, { startDate: MONDAY, weeks: {} }, {}, MONDAY, total);
      const label = `${level}, objectif dans ${total} semaines`;
      weeks.forEach((w, i) => checkWeek(profile, w, `${label} s${i + 1}`));
      const kinds = weeks.map((w) => (w.info.isRecovery ? 'R' : w.info.phase === 'intro' ? 'M' : w.info.phase === 'affutage' ? 'A' : w.info.phase === 'objectif' ? 'J' : 'C'));
      const seq = kinds.join('');
      assert.equal(kinds[kinds.length - 1], 'J', label);
      if (total >= 4) {
        assert.equal(kinds[kinds.length - 2], 'A', label);
        assert.equal(kinds[kinds.length - 3], 'C', `${label} : la semaine avant l'affûtage doit être une semaine de charge (${seq})`);
      }
      assert.ok(!/CCCC/.test(seq), `${label} : 4 semaines de charge d'affilée (${seq})`);
      assert.ok(!/(^|R)CR/.test(seq), `${label} : bloc d'une seule semaine de charge (${seq})`);
      assert.ok(!/RR|RA/.test(seq), `${label} : deux semaines légères d'affilée (${seq})`);
      // À peu près une semaine allégée toutes les 4 semaines avant l'affûtage
      const before = total - 2;
      const recoveries = kinds.filter((k) => k === 'R').length;
      if (before >= 5) assert.equal(recoveries, Math.ceil((before + 1) / 4) - 1, `${label} (${seq})`);
      weeks.forEach((w, i) => {
        // Semaine de charge numérotée 1, 2, 3 dans son bloc ; la semaine allégée garde la phase de son bloc
        if (kinds[i] === 'C') assert.equal(w.info.cycleWeek, kinds[i - 1] === 'C' ? weeks[i - 1].info.cycleWeek + 1 : 1, `${label} s${i + 1}`);
        // La longueur annoncée du bloc (« semaine 2 sur 2 ») correspond à la réalité
        if (kinds[i] === 'C' && kinds[i + 1] !== 'C') assert.equal(w.info.cycleWeek, w.info.cycleLen, `${label} s${i + 1}`);
        if (kinds[i] === 'R') assert.equal(w.info.phase, weeks[i - 1].info.phase, `${label} s${i + 1}`);
      });
      // Les semaines de charge d'un bloc montent, la semaine allégée redescend nettement
      weeks.forEach((w, i) => {
        if (kinds[i] === 'R') assert.ok(w.targetMin < weeks[i - 1].targetMin * 0.8, `${label} s${i + 1} : récup pas assez légère`);
      });
    }
  }
});
