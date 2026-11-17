// Ce que « La Bible du running » et « La Nouvelle Bible de la préparation
// physique » ont apporté : format des objectifs (affûtage, allure cible),
// débuts en douceur à pied, prédictions, profil, pouls de repos.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addDays } from '../public/engine/dates.js';
import { goalsOf, weekInfo, previewWeeks, generateWeek, RUN_START } from '../public/engine/plan.js';
import { FORMATS, formatOf, taperWeeksOf } from '../public/engine/formats.js';
import { buildSession, flatten, RUN_PACE } from '../public/engine/workouts.js';
import { zoneForPct } from '../public/engine/zones.js';
import {
  riegel, timeFromVma, racePredictions, vo2maxFromVma, vo2maxFromPma, bikeProfile, planBias, athleteProfile,
} from '../public/engine/predict.js';
import { readiness, pulseBaseline } from '../public/engine/readiness.js';
import { goalNotes, explainWeek } from '../public/engine/explain.js';
import { ARTICLES } from '../public/js/manual.js';

const MONDAY = '2026-11-16';
const base = {
  name: 'Test', level: 'intermediaire', split: 0.5, hoursNow: 5, indoor: 'jamais',
  avail: [60, 0, 75, 0, 60, 120, 180], refs: {},
};
const plan0 = () => ({ startDate: MONDAY, weeks: {} });
const sunday = (week) => addDays(MONDAY, 7 * (week - 1) + 6);
const phases = (profile, n) => previewWeeks(profile, plan0(), { today: MONDAY }, MONDAY, n).map((w) => w.info.phase);

test('format des objectifs : accepté seulement s’il existe dans le sport', () => {
  const list = goalsOf({ goals: [
    { id: 'a', sport: 'run', date: '2027-03-07', format: 'semi' },
    { id: 'b', sport: 'bike', date: '2027-05-07', format: 'semi' },
    { id: 'c', sport: 'bike', date: '2027-06-07', format: 'long' },
    { id: 'd', sport: 'run', date: '2027-07-07' },
  ] });
  assert.deepEqual(list.map((g) => g.format), ['semi', undefined, 'long', undefined]);
  assert.equal(formatOf({ sport: 'run', format: 'marathon' }).km, 42.195);
  assert.equal(taperWeeksOf({ sport: 'run' }), 1);
  assert.deepEqual(FORMATS.run.map(taperWeeksOf.bind(null)).length, 3);
  assert.deepEqual(FORMATS.run.map((f) => f.taperWeeks), [0, 1, 2]);
  assert.deepEqual(FORMATS.bike.map((f) => f.taperWeeks), [0, 1, 2]);
});

test('affûtage : sa durée suit celle de l’épreuve', () => {
  const mk = (format, sport = 'run') => ({ ...base, goals: [{ id: 'g', name: 'Course', sport, date: sunday(16), major: true, ...(format ? { format } : {}) }] });
  const count = (p) => phases(p, 17).filter((x) => x === 'affutage').length;
  assert.equal(count(mk(null)), 1); // format non précisé : comme avant
  assert.equal(count(mk('semi')), 1);
  assert.equal(count(mk('court')), 0);
  assert.equal(count(mk('marathon')), 2);
  assert.equal(count(mk('long', 'bike')), 2);
  // Sans format, le calendrier est exactement celui d'avant
  assert.deepEqual(phases(mk(null), 17), phases({ ...base, goals: [{ id: 'g', name: 'Course', sport: 'run', date: sunday(16), major: true }] }, 17));
  assert.deepEqual(phases(mk('semi'), 17), phases(mk(null), 17));

  // Affûtage long : le volume baisse par paliers, puis la semaine de course
  const weeks = previewWeeks(mk('marathon'), plan0(), { today: MONDAY }, MONDAY, 17);
  const [t1, t2, race] = [weeks[13], weeks[14], weeks[15]];
  assert.deepEqual([t1.info.phase, t2.info.phase, race.info.phase], ['affutage', 'affutage', 'objectif']);
  assert.deepEqual([t1.info.taperLen, t1.info.toGoal, t2.info.toGoal], [2, 2, 1]);
  assert.ok(t1.targetMin > t2.targetMin && t2.targetMin > race.targetMin, `${t1.targetMin} > ${t2.targetMin} > ${race.targetMin}`);
  assert.ok(Math.abs(t1.targetMin / t1.refMin - 0.75) < 0.03 && Math.abs(t2.targetMin / t2.refMin - 0.6) < 0.03);
  // La semaine qui précède l'affûtage reste une semaine de charge, pas une semaine allégée
  assert.equal(weeks[12].info.isRecovery, false);
  // Épreuve courte : la dernière semaine avant la course est une semaine de charge
  const short = previewWeeks(mk('court'), plan0(), { today: MONDAY }, MONDAY, 17);
  assert.equal(short[15].info.phase, 'objectif');
  assert.ok(['specifique', 'developpement'].includes(short[14].info.phase) && !short[14].info.isRecovery);
});

test('course à pied : la séance clé se court à l’allure de l’objectif', () => {
  const mk = (format) => ({ ...base, split: 0, goals: [{ id: 'g', name: 'Course', sport: 'run', date: sunday(16), major: true, format }] });
  const kinds = (format) => {
    const out = new Set();
    for (const w of previewWeeks(mk(format), plan0(), { today: MONDAY }, MONDAY, 16)) {
      if (w.info.phase !== 'specifique' && w.info.phase !== 'affutage') continue;
      assert.equal(w.info.format, format);
      for (const s of w.sessions) if (s.role === 'key') out.add(s.kind);
    }
    return out;
  };
  assert.ok(kinds('court').has('allure10'));
  assert.ok(kinds('semi').has('allure21'));
  // Affûtage : le rappel d'allure tient dans une séance courte, à la même allure
  const taper = previewWeeks(mk('semi'), plan0(), { today: MONDAY }, MONDAY, 16).find((w) => w.info.phase === 'affutage');
  const reminder = taper.sessions.find((x) => x.kind === 'allure21');
  assert.ok(reminder && reminder.durationMin <= 45, 'rappel d’allure court pendant l’affûtage');
  assert.ok(kinds('marathon').has('allure42'));
  assert.ok(!kinds('semi').has('allure42') && !kinds('marathon').has('allure10'));
  // Sans format, ou pour un objectif vélo, rien ne change
  const plain = { ...base, split: 0, goals: [{ id: 'g', name: 'Course', sport: 'run', date: sunday(16), major: true }] };
  for (const w of previewWeeks(plain, plan0(), { today: MONDAY }, MONDAY, 16)) {
    assert.ok(w.sessions.every((s) => !/^allure/.test(s.kind)));
  }
});

test('séances d’allure : intensité, zone et récupérations', () => {
  const zoneOf = { allure10: 'i4', allure21: 'i3', allure42: 'i3' };
  let previous = 1;
  for (const kind of ['allure10', 'allure21', 'allure42']) {
    assert.ok(RUN_PACE[kind] < previous, 'plus la course est longue, plus l’allure est basse');
    previous = RUN_PACE[kind];
    assert.equal(zoneForPct(RUN_PACE[kind], 'run').id, zoneOf[kind]);
    for (const step of [0, 3, 9]) {
      const s = buildSession({ sport: 'run', kind, minutes: 100, step });
      assert.equal(s.kind, kind);
      // Les fractions à allure (sans les lignes droites de l'échauffement) et leurs récupérations
      const flat = flatten(s.steps);
      const on = flat.filter((x) => x.kind === 'on' && /^Allure/.test(x.label));
      const off = flat.filter((x, i) => x.kind === 'off' && on.includes(flat[i - 1]));
      assert.ok(on.length >= 1 && on.every((x) => x.pct === RUN_PACE[kind] && x.zone === zoneOf[kind]));
      // Récupération nettement plus courte que l'effort : c'est de l'allure, pas de la VMA
      assert.ok(off.every((x) => x.sec <= on[0].sec / 2 && x.sec >= 90));
    }
  }
  // Les fractions s'allongent avec la distance préparée
  const block = (kind) => flatten(buildSession({ sport: 'run', kind, minutes: 100, step: 3 }).steps).find((x) => x.kind === 'on' && /^Allure/.test(x.label)).sec;
  assert.ok(block('allure10') < block('allure21') && block('allure21') <= block('allure42'));
  // Les parts de VMA sont dans les fourchettes classiques
  assert.ok(RUN_PACE.allure10 >= 0.85 && RUN_PACE.allure10 <= 0.9);
  assert.ok(RUN_PACE.allure21 >= 0.8 && RUN_PACE.allure21 <= 0.85);
  assert.ok(RUN_PACE.allure42 >= 0.75 && RUN_PACE.allure42 <= 0.8);
});

test('débutant : quatre premières semaines en douceur à pied', () => {
  const beginner = { ...base, level: 'debutant', split: 0.5, avail: [60, 60, 0, 60, 0, 90, 120] };
  const weeks = previewWeeks(beginner, plan0(), { today: MONDAY }, MONDAY, 8);
  weeks.slice(0, RUN_START.weeks).forEach((w, i) => {
    const runs = w.sessions.filter((s) => s.sport === 'run');
    assert.ok(runs.length <= RUN_START.perWeek, `semaine ${i + 1} : ${runs.length} sorties à pied`);
    assert.ok(runs.every((s) => s.durationMin <= RUN_START.sessionMin), `semaine ${i + 1} : footing trop long`);
    assert.ok(runs.every((s) => s.hard === 0 && s.role !== 'key' && s.role !== 'long'), `semaine ${i + 1} : séance dure à pied`);
    assert.ok(runs.reduce((t, s) => t + s.durationMin, 0) <= RUN_START.weeklyMin);
    if (runs.length) {
      assert.equal(w.gentleRun, true);
      assert.ok(explainWeek(beginner, plan0(), w, MONDAY).some((x) => x.title === 'La course à pied en douceur'));
    }
  });
  // Ensuite, le plan reprend son cours
  assert.ok(weeks.slice(RUN_START.weeks).every((w) => !w.gentleRun));
  assert.ok(weeks.slice(RUN_START.weeks).some((w) => w.sessions.some((s) => s.sport === 'run' && s.durationMin > RUN_START.sessionMin)));
  // Il court déjà régulièrement : pas de bride
  const used = generateWeek(beginner, plan0(), MONDAY, { today: MONDAY, recentRunMin: 120 });
  assert.ok(!used.gentleRun);
  // Les autres niveaux ne sont pas concernés
  assert.ok(previewWeeks(base, plan0(), { today: MONDAY }, MONDAY, 4).every((w) => !w.gentleRun));
  // Débutant qui ne fait que courir : trois sorties par semaine au plus, jamais deux jours de suite quand c'est évitable
  const runner = { ...beginner, split: 0, avail: [45, 45, 45, 45, 45, 60, 90] };
  for (const w of previewWeeks(runner, plan0(), { today: MONDAY }, MONDAY, 10)) {
    assert.ok(w.sessions.length <= RUN_START.perWeek, `${w.weekStart} : ${w.sessions.length} séances`);
  }
});

test('prédictions : Riegel, VMA, VO2max', () => {
  // Quand la distance double, le temps fait un peu plus que doubler
  assert.ok(Math.abs(riegel(3000, 10, 20) / 3000 - 2.085) < 0.005);
  assert.ok(Math.abs(riegel(50 * 60, 10, 21.0975) / 60 - 110.3) < 0.5);
  assert.equal(riegel(0, 10, 20), null);
  // Part de VMA tenue selon la distance : dans les fourchettes classiques
  for (const vma of [11, 14, 17, 20]) {
    const part = (km) => km / (timeFromVma(vma, km) / 3600) / vma;
    assert.ok(part(10) >= 0.83 && part(10) <= 0.9, `10 km : ${part(10)}`);
    assert.ok(part(21.0975) >= 0.78 && part(21.0975) <= 0.85, `semi : ${part(21.0975)}`);
    assert.ok(part(42.195) >= 0.73 && part(42.195) <= 0.8, `marathon : ${part(42.195)}`);
    assert.ok(part(10) > part(21.0975) && part(21.0975) > part(42.195));
  }
  // Les deux méthodes se recoupent : du 10 km prédit au semi prédit, à 3 % près
  const t10 = timeFromVma(15, 10);
  assert.ok(Math.abs(riegel(t10, 10, 21.0975) / timeFromVma(15, 21.0975) - 1) < 0.03);
  const preds = racePredictions(15);
  assert.deepEqual(preds.map((p) => p.id), ['court', 'semi', 'marathon']);
  assert.ok(preds[0].sec > 44 * 60 && preds[0].sec < 48 * 60);
  assert.match(preds[0].pace, /^4:\d\d$/);
  assert.deepEqual(racePredictions(null), []);
  assert.equal(vo2maxFromVma(14), 49);
  assert.ok(Math.abs(vo2maxFromPma(300, 70) - 55.1) < 0.2);
  assert.equal(vo2maxFromPma(300, null), null);
});

test('profil du cycliste : diesel, puncheur, équilibré', () => {
  const given = (pma, ftp) => ({ pma, ftp, est: {}, why: {} });
  assert.equal(bikeProfile(given(300, 252)).key, 'diesel');
  assert.equal(bikeProfile(given(300, 216)).key, 'punch');
  assert.equal(bikeProfile(given(300, 234)).key, 'equilibre');
  // Une valeur déduite de l'autre, ou tirée d'un simple record, ne dit rien du profil
  assert.equal(bikeProfile({ pma: 309, ftp: 241, est: { pma: true }, why: { pma: { quality: 'formule' } } }), null);
  assert.equal(bikeProfile({ pma: 290, ftp: 241, est: { pma: true }, why: { pma: { quality: 'record' } } }), null);
  assert.equal(bikeProfile({ pma: 290, ftp: 241, est: { pma: true }, why: { pma: { quality: 'test' } } }).key, 'diesel');
  assert.equal(planBias({ refs: { pma: 300, ftp: 252 } }), 'pma');
  assert.equal(planBias({ refs: { pma: 300, ftp: 216 } }), 'seuil');
  assert.equal(planBias({ refs: { ftp: 241 } }), null);
  const a = athleteProfile({ pma: 300, ftp: 234, vma: 13, weightKg: 70, est: {}, why: {} });
  assert.equal(a.lead, 'bike');
  assert.equal(a.wkg, 3.3);
  assert.equal(a.predictions.length, 3);

  // Le plan penche vers ce qui manque, sans changer l'ordre des phases ni la durée totale
  const goals = [{ id: 'g', name: 'Cyclo', sport: 'bike', date: sunday(20), major: true }];
  const count = (refs) => {
    const list = phases({ ...base, goals, refs }, 21);
    const order = list.filter((x, i) => ['developpement', 'specifique'].includes(x) && x !== list[i - 1]);
    assert.deepEqual(order.slice(0, 2), ['developpement', 'specifique']);
    return { dev: list.filter((x) => x === 'developpement').length, spe: list.filter((x) => x === 'specifique').length, n: list.length };
  };
  const neutral = count({});
  const diesel = count({ pma: 300, ftp: 252 });
  const punch = count({ pma: 300, ftp: 216 });
  assert.ok(diesel.dev < neutral.dev && diesel.spe > neutral.spe, 'diesel : plus de PMA, moins de seuil');
  assert.ok(punch.dev > neutral.dev && punch.spe < neutral.spe, 'puncheur : plus de seuil, moins de PMA');
  assert.equal(diesel.dev + diesel.spe, neutral.dev + neutral.spe);
  assert.equal(punch.dev + punch.spe, neutral.dev + neutral.spe);
  assert.ok(diesel.dev >= 2 && punch.spe >= 2 && diesel.n === neutral.n);
  // Un objectif à pied n'est pas concerné
  const run = (refs) => phases({ ...base, goals: [{ ...goals[0], sport: 'run' }], refs }, 21);
  assert.deepEqual(run({ pma: 300, ftp: 252 }), run({}));
});

test('pouls de repos : repère, alerte, prudence', () => {
  const fresh = { ratio: 0.1, ratioNow: 0.1, monotony: null, weekLoad: 0 };
  const day = (n) => addDays('2026-11-01', n);
  const log = {};
  for (let i = 0; i < 3; i++) log[day(i)] = { feel: 4, pulse: 52 + i };
  assert.equal(pulseBaseline(log, day(10)), null); // trois mesures : pas encore de repère
  log[day(3)] = { feel: 4, pulse: 55 };
  log[day(4)] = { feel: 4 };
  assert.equal(pulseBaseline(log, day(10)), 53.5);
  assert.equal(pulseBaseline(log, day(40)), null); // trop ancien
  const base53 = { pulseBase: 53.5 };
  assert.equal(readiness(fresh, { feel: 4, pulse: 54 }, base53).level, 'bleu');
  const watch = readiness(fresh, { feel: 4, pulse: 58 }, base53);
  assert.equal(watch.level, 'vert');
  assert.ok(watch.reasons.some((r) => /un peu plus haut/.test(r)));
  const alert = readiness(fresh, { feel: 4, pulse: 62 }, base53);
  assert.equal(alert.level, 'orange');
  assert.ok(alert.reasons.some((r) => /pas fini de récupérer/.test(r)));
  // Sans repère, le pouls ne change rien ; malade reste rouge
  assert.equal(readiness(fresh, { feel: 4, pulse: 70 }).level, 'bleu');
  assert.equal(readiness(fresh, { feel: 3, sick: true, pulse: 70 }, base53).level, 'rouge');
});

test('explications et manuel', () => {
  const profile = { ...base, split: 0, goals: [{ id: 'g', name: 'Semi de printemps', sport: 'run', date: sunday(16), major: true, format: 'semi' }] };
  const [note] = goalNotes(profile, plan0(), MONDAY, { vma: 15, est: {} });
  assert.equal(note.formatLabel, 'Semi-marathon');
  assert.match(note.how, /une semaine d’affûtage/);
  assert.match(note.how, /tu vaux environ 1 h 4\d min sur semi \(4:\d\d \/km\)/);
  const long = goalNotes({ ...profile, goals: [{ ...profile.goals[0], format: 'marathon' }] }, plan0(), MONDAY)[0];
  assert.match(long.how, /deux semaines d’affûtage/);
  const short = goalNotes({ ...profile, goals: [{ ...profile.goals[0], format: 'court' }] }, plan0(), MONDAY)[0];
  assert.match(short.how, /la semaine de course suffit/);

  assert.equal(ARTICLES.length, 15);
  for (const id of ['profil', 'chrono', 'croise']) assert.ok(ARTICLES.some((a) => a.id === id));
  assert.equal(new Set(ARTICLES.map((a) => a.id)).size, ARTICLES.length);
  assert.ok(ARTICLES.filter((a) => a.sources.some((s) => s.includes('La Bible du running'))).length >= 5);
  assert.ok(ARTICLES.filter((a) => a.sources.some((s) => s.includes('préparation physique'))).length >= 5);
});
