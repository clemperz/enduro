import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addDays, dayIndex, mondayOf, diffDays } from '../public/engine/dates.js';
import {
  LEVELS, goalsOf, upcomingGoals, weekInfo, previewWeeks, planProgress, primarySport, weekSplit, generateWeek,
} from '../public/engine/plan.js';
import { explainWeek, explainSession, planStages, goalNotes, planRules, AUTO_RULES } from '../public/engine/explain.js';

const MONDAY = '2026-11-16';
const base = {
  name: 'Test', level: 'intermediaire', split: 0.6, hoursNow: 5, indoor: 'semaine',
  avail: [60, 0, 75, 0, 60, 120, 180], refs: {},
};
const at = (week, day = 6) => addDays(MONDAY, 7 * (week - 1) + day); // semaine 1 = celle du départ
const goal = (id, week, { sport = 'bike', major = true, day = 6, name = `Course ${id}` } = {}) => ({ id, name, sport, date: at(week, day), major });
const plan0 = () => ({ startDate: MONDAY, weeks: {} });
const code = (w) => (w.info.phase === 'objectif' ? 'J' : w.info.phase === 'affutage' ? 'A' : w.info.phase === 'recup' ? 'P'
  : w.info.phase === 'intro' ? 'M' : w.info.etape ? 'E' : w.info.lead ? 'L' : w.info.isRecovery ? 'R' : 'C');

test('objectifs : ancien format, tri, objectif majeur par défaut, entrées invalides', () => {
  assert.deepEqual(goalsOf({}), []);
  assert.deepEqual(goalsOf({ goal: { type: 'forme', name: '', date: null } }), []);
  assert.deepEqual(goalsOf({ goal: { type: 'velo', name: 'Cyclo', date: null } }), []);
  assert.deepEqual(goalsOf({ goal: { type: 'course', name: 'Semi', date: '2027-03-07' } }),
    [{ id: 'g1', name: 'Semi', sport: 'run', date: '2027-03-07', major: true }]);
  const list = goalsOf({ goals: [
    { id: 'b', name: 'B', sport: 'bike', date: '2027-06-01', major: false },
    { id: 'x', name: 'sans date', sport: 'bike', date: '' },
    { id: 'y', name: 'sport inconnu', sport: 'nage', date: '2027-01-01' },
    { id: 'a', name: 'A', sport: 'run', date: '2027-02-01', major: false },
  ] });
  assert.deepEqual(list.map((g) => g.id), ['a', 'b']);
  // Aucun objectif majeur choisi : le dernier le devient
  assert.deepEqual(list.map((g) => g.major), [false, true]);
  // Un tableau vide l'emporte sur l'ancien champ
  assert.deepEqual(goalsOf({ goals: [], goal: { type: 'velo', date: '2027-03-07' } }), []);
});

test('objectifs : horizon court, moyen, long terme', () => {
  const h = (...weeks) => upcomingGoals({ goals: weeks.map((w, i) => goal(`g${i}`, w)) }, MONDAY).map((g) => g.horizon);
  assert.deepEqual(h(4, 12, 30), ['Court terme', 'Moyen terme', 'Long terme']);
  assert.deepEqual(h(10, 12, 14), ['Court terme', 'Moyen terme', 'Long terme']);
  assert.deepEqual(h(30, 40, 50), ['Court terme', 'Moyen terme', 'Long terme']);
  assert.deepEqual(h(3, 6), ['Court terme', 'Moyen terme']);
  assert.deepEqual(h(25, 40), ['Moyen terme', 'Long terme']);
  assert.deepEqual(h(14), ['Moyen terme']);
  assert.deepEqual(h(3), ['Court terme']);
  assert.deepEqual(h(30), ['Long terme']);
  // Les objectifs passés ne comptent plus
  const up = upcomingGoals({ goals: [goal('old', 1, { day: 0 }), goal('new', 9)] }, at(2, 0));
  assert.deepEqual(up.map((g) => g.id), ['new']);
  assert.equal(up[0].weeksLeft, 7);
  assert.equal(up[0].daysLeft, diffDays(at(2, 0), at(9)));
});

test('objectifs : même plan avec l’ancien et le nouveau format', () => {
  const date = at(14);
  const legacy = { ...base, goal: { type: 'velo', name: 'La Cyclo', date } };
  const modern = { ...base, goals: [{ id: 'g1', name: 'La Cyclo', sport: 'bike', date, major: true }] };
  const strip = (weeks) => weeks.map((w) => ({
    phase: w.info.phase, cycleWeek: w.info.cycleWeek, isRecovery: w.info.isRecovery, step: w.info.step, targetMin: w.targetMin,
    sessions: w.sessions.map((s) => [s.date, s.sport, s.kind, s.durationMin, s.role, s.title].join('|')),
  }));
  const a = previewWeeks(legacy, plan0(), {}, MONDAY, 18);
  const b = previewWeeks(modern, plan0(), {}, MONDAY, 18);
  // Différences voulues : en phase spécifique et à l'affûtage, le sport de l'objectif prend plus de place ;
  // une fois l'objectif passé, il ne dicte plus le sport prioritaire.
  const same = (w) => w.info.phase !== 'specifique' && w.info.phase !== 'affutage' && w.weekStart <= mondayOf(date);
  assert.deepEqual(strip(a.filter(same)), strip(b.filter(same)));
  assert.deepEqual(a.map((w) => w.info.phase), b.map((w) => w.info.phase));
});

test('trois objectifs : étape, objectif majeur, puis second objectif majeur', () => {
  const profile = { ...base, goals: [
    goal('a', 6, { sport: 'run', major: false, name: '10 km' }),
    goal('b', 14, { sport: 'bike', day: 5, name: 'Cyclo' }),
    goal('c', 26, { sport: 'run', name: 'Semi' }),
  ] };
  const weeks = previewWeeks(profile, plan0(), {}, MONDAY, 29);
  const seq = weeks.map(code).join('');
  assert.equal(seq, 'CCRCCECCRCCCAJPCCRCCRCCCAJPCC', seq);
  // Étape : semaine allégée, course au bon jour, pas de séance dure, décrassage impossible (dimanche)
  const etape = weeks[5];
  assert.equal(etape.info.isRecovery, true);
  assert.equal(etape.info.phase, weeks[4].info.phase);
  const race = etape.sessions.find((s) => s.role === 'race');
  assert.equal(race.date, at(6));
  assert.equal(race.title, '10 km');
  assert.equal(race.sport, 'run');
  assert.equal(race.major, false);
  assert.ok(etape.sessions.every((s) => s.role === 'race' || s.hard < 2));
  // Lendemain d'étape (course le dimanche) : pas de séance dure lundi ni mardi
  assert.equal(weeks[6].info.afterRace, 1);
  assert.ok(weeks[6].sessions.filter((s) => s.role === 'key').every((s) => dayIndex(s.date) >= 2));
  // Objectif majeur : affûtage, course, récupération
  assert.equal(weeks[12].info.phase, 'affutage');
  assert.equal(weeks[13].sessions.find((s) => s.role === 'race').date, at(14, 5));
  assert.ok(weeks[13].sessions.every((s) => s.date <= at(14, 5)));
  assert.equal(weeks[14].info.phase, 'recup');
  // Ce que chaque semaine prépare
  assert.equal(weeks[0].info.focus, 'bike');
  assert.equal(weeks[0].info.goalId, 'b');
  assert.equal(weeks[0].info.toGoal, 13);
  assert.equal(weeks[15].info.focus, 'run');
  assert.equal(weeks[15].info.goalId, 'c');
  assert.equal(weeks[27].info.focus, undefined);
  // Seconde préparation : la progression ne repart pas de zéro
  assert.ok(weeks[15].info.step >= 2);
  // Numérotation : jusqu'au prochain objectif majeur
  assert.deepEqual(planProgress(profile, plan0(), MONDAY), { week: 1, total: 14 });
  assert.deepEqual(planProgress(profile, plan0(), at(16, 0)), { week: 16, total: 26 });
  assert.equal(planProgress(profile, plan0(), at(28, 0)).total, null);
  // Sport prioritaire : celui de l'objectif préparé
  assert.equal(primarySport(profile, 'run'), 'run');
  assert.equal(primarySport({ ...profile, split: 1 }, 'run'), 'bike');
  assert.equal(weekSplit(profile, { phase: 'specifique', focus: 'run' }), 0.45);
  assert.equal(weekSplit(profile, { phase: 'specifique', focus: 'bike' }), 0.75);
  assert.equal(weekSplit(profile, { phase: 'fondations', focus: 'run' }), 0.6);
  assert.equal(weekSplit({ ...profile, split: 1 }, { phase: 'specifique', focus: 'run' }), 1);
});

test('objectifs rapprochés, étape après le dernier objectif majeur, étape pendant l’affûtage', () => {
  const close = { ...base, goals: [goal('a', 8), goal('b', 10), goal('c', 14, { sport: 'run', major: false, day: 5 })] };
  const w1 = previewWeeks(close, plan0(), {}, MONDAY, 17);
  assert.equal(w1.map(code).join(''), 'CCRCCCAJPJPCCECCC');
  // Étape un samedi : décrassage le dimanche
  const etape = w1[13];
  assert.equal(etape.sessions.find((s) => s.role === 'race').date, at(14, 5));
  const after = etape.sessions.find((s) => s.date === at(14, 6));
  assert.equal(after.kind, 'recup');
  // Après la dernière course : le plan continue sans objectif
  assert.equal(w1[14].info.focus, undefined);
  assert.equal(w1[14].info.cycleWeek, 1);

  const taper = { ...base, goals: [goal('p', 7, { major: false, name: 'Prépa' }), goal('g', 8, { name: 'Grand' })] };
  const w2 = previewWeeks(taper, plan0(), {}, MONDAY, 9);
  assert.equal(w2.map(code).join(''), 'CCRCCCAJP');
  assert.equal(w2[6].sessions.find((s) => s.role === 'race').title, 'Prépa');
  assert.equal(w2[7].sessions.find((s) => s.role === 'race').title, 'Grand');

  // Deux courses la même semaine, dont une le même jour : identifiants distincts
  const twin = { ...base, goals: [goal('x', 5, { day: 5, name: 'Samedi' }), goal('y', 5, { day: 5, name: 'Samedi bis' })] };
  const w3 = previewWeeks(twin, plan0(), {}, MONDAY, 5)[4];
  const races = w3.sessions.filter((s) => s.role === 'race');
  assert.equal(races.length, 2);
  assert.notEqual(races[0].id, races[1].id);
});

test('calendrier : règles respectées pour toutes sortes de combinaisons d’objectifs', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let run = 0; run < 160; run++) {
    const n = 1 + rnd(3);
    const goals = Array.from({ length: n }, (_, i) => goal(`g${i}`, 1 + rnd(40), { sport: rnd(2) ? 'bike' : 'run', major: rnd(3) > 0, day: rnd(7) }));
    const level = Object.keys(LEVELS)[rnd(3)];
    const profile = { ...base, level, split: [1, 0.75, 0.5, 0.25, 0][rnd(5)], goals };
    if (profile.split === 1) goals.forEach((g) => { g.sport = 'bike'; });
    if (profile.split === 0) goals.forEach((g) => { g.sport = 'run'; });
    const eff = goalsOf(profile);
    const lastWeek = Math.max(...eff.map((g) => diffDays(MONDAY, mondayOf(g.date)) / 7));
    const weeks = previewWeeks(profile, plan0(), {}, MONDAY, lastWeek + 4);
    const seq = weeks.map(code).join('');
    const label = `${level} ${profile.split} ${JSON.stringify(eff.map((g) => [g.date, g.sport, g.major]))} ${seq}`;
    for (const g of eff) {
      const i = diffDays(MONDAY, mondayOf(g.date)) / 7;
      const w = weeks[i];
      // La course est au programme, le bon jour, dans le bon sport
      const race = w.sessions.find((s) => s.role === 'race' && s.goalId === g.id);
      assert.ok(race && race.date === g.date && race.sport === g.sport, `course absente : ${label}`);
      if (g.major) {
        assert.equal(w.info.phase, 'objectif', label);
        assert.ok(['P', 'J'].includes(seq[i + 1]), `pas de récupération après un objectif majeur : ${label}`);
        if (i >= 2) assert.ok(['A', 'P', 'J'].includes(seq[i - 1]), `pas d'affûtage avant un objectif majeur : ${label}`);
      } else {
        assert.ok(['E', 'A', 'P', 'J'].includes(seq[i]), `étape sur une semaine de charge : ${label}`);
      }
      // Rien de dur la veille d'une course
      const eve = w.sessions.find((s) => s.date === addDays(g.date, -1));
      assert.ok(!eve || eve.role === 'race' || eve.hard < 2, `séance dure la veille d'une course : ${label}`);
    }
    assert.ok(!/CCCC/.test(seq), `4 semaines de charge d'affilée : ${label}`);
    assert.ok(!/RR|RA|RE|RJ/.test(seq), `semaine allégée mal placée : ${label}`);
    weeks.forEach((w, i) => {
      const avail = profile.avail;
      const byDay = {};
      for (const s of w.sessions) {
        const d = dayIndex(s.date);
        assert.equal(mondayOf(s.date), w.weekStart, label);
        if (s.role !== 'race') {
          assert.ok(s.durationMin <= avail[d], `${label} s${i + 1} : ${s.title} dépasse le créneau`);
          assert.ok(!byDay[d] || byDay[d].role === 'race', `${label} s${i + 1} : deux séances le même jour`);
        }
        byDay[d] ??= s;
        if (profile.split === 1) assert.equal(s.sport, 'bike', label);
        if (profile.split === 0) assert.equal(s.sport, 'run', label);
      }
      // (deux courses deux jours de suite, c'est le choix de l'athlète : le plan n'y peut rien)
      const tough = (s) => s && s.role !== 'race' && s.hard >= 2;
      for (let d = 0; d < 6; d++) assert.ok(!(tough(byDay[d]) && tough(byDay[d + 1])), `${label} s${i + 1} : deux jours durs de suite`);
      // La semaine prépare le prochain objectif majeur (ou, à défaut, la prochaine course)
      const ahead = eff.filter((g) => mondayOf(g.date) >= w.weekStart);
      const target = ahead.find((g) => g.major) ?? ahead[0];
      assert.equal(w.info.goalId, target?.id, `${label} s${i + 1}`);
      assert.equal(w.info.focus, target?.sport, `${label} s${i + 1}`);
      assert.ok(w.loadPlan >= 0 && Number.isFinite(w.targetMin));
    });
  }
});

test('le pourquoi : plan, semaine et séance expliqués', () => {
  const profile = { ...base, goals: [
    goal('a', 6, { sport: 'run', major: false, name: '10 km' }),
    goal('b', 14, { name: 'La Cyclo' }),
  ] };
  const plan = plan0();
  const weeks = previewWeeks(profile, plan, { today: MONDAY }, MONDAY, 16);
  for (const w of weeks) plan.weeks[w.weekStart] = w;

  const notes = goalNotes(profile, plan, MONDAY);
  assert.deepEqual(notes.map((g) => g.role), ['Étape de préparation', 'Objectif majeur']);
  assert.deepEqual(notes.map((g) => g.horizon), ['Court terme', 'Moyen terme']);
  assert.match(notes[0].how, /semaine allégée/);
  assert.match(notes[1].how, /à rebours/);
  assert.match(notes[1].left, /13 semaines/);

  const stages = planStages(profile, plan, MONDAY);
  assert.deepEqual(stages.map((s) => s.phase), ['fondations', 'developpement', 'specifique', 'affutage', 'objectif', 'recup']);
  assert.equal(stages.reduce((t, s) => t + s.weeks, 0), 15);
  assert.equal(stages[0].current, true);
  assert.equal(stages[1].races[0].name, '10 km');
  assert.equal(stages[4].races[0].name, 'La Cyclo');
  assert.ok(stages.every((s) => s.why && s.label && s.from <= s.to));
  // Sans objectif : les trois phases du cycle de 12 semaines
  assert.deepEqual(planStages(base, plan0(), MONDAY).map((s) => s.phase), ['fondations', 'developpement', 'specifique']);
  assert.ok(planRules(profile).length >= 5 && AUTO_RULES.length >= 5);

  // Chaque semaine s'explique, sans trou
  for (const w of weeks) {
    const items = explainWeek(profile, plan, w, MONDAY);
    assert.ok(items.length >= 3, w.weekStart);
    assert.ok(items.every((x) => x.title && x.text && !/undefined|NaN|null/.test(x.text)), JSON.stringify(items));
    for (const s of w.sessions) {
      const why = explainSession(profile, w, s);
      assert.ok(why.length > 20 && !/undefined|NaN/.test(why), `${w.weekStart} ${s.title} : ${why}`);
    }
  }
  const first = explainWeek(profile, plan, weeks[0], MONDAY);
  assert.match(first[0].text, /Fondations/);
  assert.match(first[0].text, /La Cyclo/);
  assert.match(first[1].text, /déclaré/);
  assert.match(explainWeek(profile, plan, weeks[1], MONDAY)[1].text, /8 %/);
  assert.match(explainWeek(profile, plan, weeks[2], MONDAY)[1].text, /allégée/);
  const sports = first.find((x) => x.title === 'Les sports');
  assert.match(sports.text, /vélo/);
  const long = weeks[0].sessions.find((s) => s.role === 'long');
  assert.match(explainSession(profile, weeks[0], long), /plus gros créneau/);

  // Semaine qui reprend après une référence augmentée : c'est dit
  const grown = weeks.find((w) => w.basis?.growth > 1);
  assert.ok(grown);
  assert.match(explainWeek(profile, plan, grown, MONDAY)[1].text, /\+6 %/);
  // Une semaine enregistrée avant ces évolutions (sans détail) s'explique quand même
  const old = { weekStart: MONDAY, info: { phase: 'fondations', cycleWeek: 1, isRecovery: false, step: 0, index: 0 }, targetMin: 180, refMin: 180, sessions: generateWeek(base, plan0(), MONDAY, {}).sessions };
  assert.ok(explainWeek(base, plan0(), old, MONDAY).every((x) => x.text));
});
