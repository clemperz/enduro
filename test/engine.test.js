import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addDays, mondayOf, dayIndex, diffDays, fmtDuration } from '../public/engine/dates.js';
import { ZONES, resolveRefs, paceStr, stepTarget, zoneForPct, zoneTable } from '../public/engine/zones.js';
import {
  computeLoad, rpePointsPerHour, buildPmc, monotony, fitnessAt, formZone, formRatio, weekTotals, seedFromHours,
} from '../public/engine/load.js';
import { buildSession, totalSec, flatten, plannedLoad, minMinutes } from '../public/engine/workouts.js';
import { readiness, proposeAdaptation } from '../public/engine/readiness.js';
import { normalizedPower, bestEfforts, powerProfile, suggestRefs } from '../public/engine/power.js';
import { sessionToZwo, zwoFileName, ascii } from '../public/engine/zwo.js';
import { decodeFit, summarizeFit } from '../public/engine/fit.js';
import { makeFit } from './helpers.js';

test('dates : lundi, index du jour, écarts', () => {
  assert.equal(dayIndex('2026-11-15'), 6); // un dimanche
  assert.equal(mondayOf('2026-11-15'), '2026-11-09');
  assert.equal(mondayOf('2026-11-16'), '2026-11-16');
  assert.equal(addDays('2026-10-24', 2), '2026-10-26'); // passage à l'heure d'hiver
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(diffDays('2026-11-09', '2026-11-16'), 7);
  assert.equal(fmtDuration(45), '45 min');
  assert.equal(fmtDuration(95), '1 h 35');
  assert.equal(fmtDuration(120), '2 h');
});

test('zones : les 7 intensités de Grappe se suivent sans trou', () => {
  assert.equal(ZONES.length, 7);
  for (let i = 1; i < ZONES.length; i++) {
    assert.equal(ZONES[i].pma[0], ZONES[i - 1].pma[1]);
    assert.equal(ZONES[i].vma[0], ZONES[i - 1].vma[1]);
  }
  // Valeurs de l'échelle ESIE
  assert.deepEqual(ZONES[1].pma, [0.5, 0.65]);
  assert.deepEqual(ZONES[1].fc, [0.75, 0.85]);
  assert.deepEqual(ZONES[3].pma, [0.75, 0.8]);
  assert.deepEqual(ZONES[3].fc, [0.92, 0.96]);
  assert.equal(zoneForPct(0.57).id, 'i2');
  assert.equal(zoneForPct(0.78).id, 'i4');
  assert.equal(zoneForPct(0.88, 'run').id, 'i4');
  assert.equal(zoneForPct(5).id, 'i7');
});

test('repères : PMA et FTP se déduisent l’une de l’autre, FC max depuis l’âge', () => {
  const a = resolveRefs({ refs: { ftp: 234 }, birthYear: 1986 }, 2026);
  assert.equal(a.pma, 300);
  assert.equal(a.est.pma, true);
  assert.equal(a.fcmax, 180); // 208 − 0,7 × 40
  const b = resolveRefs({ refs: { pma: 300, ftp: 250, fcmax: 190, vma: 15 } }, 2026);
  assert.equal(b.ftp, 250);
  assert.equal(b.fcmax, 190);
  assert.deepEqual(b.est, { fcrest: true });
  const c = resolveRefs({}, 2026);
  assert.equal(c.pma, null);
  assert.equal(c.vma, null);
});

test('cibles : watts, allures et FC', () => {
  assert.equal(paceStr(12), '5:00');
  assert.equal(paceStr(10), '6:00');
  const refs = resolveRefs({ refs: { pma: 300, fcmax: 180, vma: 15 } }, 2026);
  const bike = stepTarget('bike', { zone: 'i4', pct: 0.78, sec: 600 }, refs);
  assert.equal(bike.main, '225–240 W');
  assert.equal(bike.hr, '166–173 bpm');
  const run = stepTarget('run', { zone: 'i2', pct: 0.7, sec: 1800 }, refs);
  assert.equal(run.main, '5:36–5:50 /km');
  const short = stepTarget('bike', { zone: 'i5', pct: 1.02, sec: 30 }, refs);
  assert.equal(short.hr, null); // la FC n'a pas le temps de monter sur 30 s
  assert.equal(zoneTable('bike', refs)[1].main, '150–195 W');
  assert.equal(stepTarget('bike', { zone: 'i2', pct: 0.57, sec: 600 }, resolveRefs({}, 2026)).main, null);
});

test('charge : puissance, cardio, ressenti, allure', () => {
  const refs = { ftp: 200, fcmax: 180, fcrest: 60, vma: 15 };
  // 1 h à la FTP = 100 points
  assert.deepEqual(computeLoad({ sport: 'bike', durationSec: 3600, np: 200 }, refs), { load: 100, method: 'power' });
  assert.equal(computeLoad({ sport: 'bike', durationSec: 3600, np: 150 }, refs).load, 56);
  // sans puissance : cardio
  const hr = computeLoad({ sport: 'run', durationSec: 3600, avgHr: 140 }, refs);
  assert.equal(hr.method, 'hr');
  assert.ok(hr.load > 45 && hr.load < 65, `charge cardio ${hr.load}`);
  // sans capteur : ressenti (table 20…140 points/heure)
  assert.deepEqual(computeLoad({ sport: 'run', durationSec: 3600, rpe: 3 }, {}), { load: 40, method: 'rpe' });
  assert.deepEqual(computeLoad({ sport: 'bike', durationSec: 1800, rpe: 8 }, {}), { load: 50, method: 'rpe' });
  assert.equal(rpePointsPerHour(7.5), 90);
  // allure + dénivelé
  const pace = computeLoad({ sport: 'run', durationSec: 3600, distanceKm: 10, elevationM: 200 }, { vma: 15 });
  assert.equal(pace.method, 'pace');
  assert.ok(pace.load > 58 && pace.load < 76, `charge allure ${pace.load}`);
  assert.equal(computeLoad({ sport: 'bike', durationSec: 3600 }, {}).method, 'default');
  assert.equal(computeLoad({ sport: 'bike', durationSec: 0 }, refs).load, 0);
});

test('condition / fatigue / fraîcheur', () => {
  // Charge constante : condition et fatigue convergent vers la charge, fraîcheur → 0
  const loads = {};
  for (let i = 0; i < 200; i++) loads[addDays('2026-01-01', i)] = 50;
  const rows = buildPmc(loads, '2026-01-01', addDays('2026-01-01', 199), 0);
  const last = rows[rows.length - 1];
  assert.ok(Math.abs(last.ctl - 50) < 1);
  assert.ok(Math.abs(last.atl - 50) < 0.01);
  assert.ok(Math.abs(last.form) < 1);
  // Après une grosse semaine, la fatigue monte plus vite que la condition
  const spike = buildPmc({ '2026-03-02': 150, '2026-03-03': 150 }, '2026-03-01', '2026-03-04', 40);
  assert.ok(spike[3].form < -20);
  assert.equal(formZone(formRatio(40, 60)).key, 'rouge');
  assert.equal(formZone(formRatio(40, 46)).key, 'bosse');
  assert.equal(formZone(formRatio(40, 40)).key, 'equilibre');
  assert.equal(formZone(formRatio(40, 35)).key, 'frais');
  assert.equal(formZone(formRatio(40, 20)).key, 'tresfrais');
  // Monotonie : charges identiques = très monotone, charges variées = bas
  assert.equal(monotony([50, 50, 50, 50, 50, 50, 50]), 9.9);
  assert.ok(monotony([100, 0, 80, 0, 120, 0, 40]) < 1.2);
  assert.equal(monotony([0, 0, 0, 0, 0, 0, 0]), null);
});

test('forme du jour : valeurs du matin et graine de départ', () => {
  const seed = seedFromHours(4);
  assert.ok(Math.abs(seed - 31.43) < 0.01);
  const acts = [{ date: '2026-11-13', load: 80 }, { date: '2026-11-15', load: 200 }];
  const f = fitnessAt(acts, '2026-11-15', { seed, startDate: '2026-11-10' });
  // La séance d'aujourd'hui (200 points) est comptée tout de suite : la fatigue bondit, la condition monte un peu
  assert.equal(f.todayLoad, 200);
  assert.ok(f.ctl > f.morning.ctl + 3 && f.ctl < f.morning.ctl + 5);
  assert.ok(f.atl > f.morning.atl + 20);
  assert.ok(f.form < f.morning.form - 15);
  assert.equal(f.weekLoad, 280); // 7 jours glissants, aujourd'hui compris
  // Juste après l'effort on est au plus bas ; la jauge montre ce qu'il en restera demain matin
  assert.equal(f.forecast, true);
  assert.ok(f.ratioNow < f.ratio && f.ratio < f.morning.ratio, `${f.ratioNow} < ${f.ratio} < ${f.morning.ratio}`);
  // Avant la séance du jour, on voit l'état du matin tel quel
  const dawn = fitnessAt(acts.slice(0, 1), '2026-11-15', { seed, startDate: '2026-11-10' });
  assert.deepEqual([dawn.ctl, dawn.atl, dawn.todayLoad], [f.morning.ctl, f.morning.atl, 0]);
  assert.deepEqual([dawn.forecast, dawn.ratio, dawn.ratioNow], [false, f.morning.ratio, f.morning.ratio]);
  // Le lendemain matin, une nuit a passé : la fatigue a perdu un septième, puis rien ne bouge sans séance
  const next = fitnessAt(acts, '2026-11-16', { seed, startDate: '2026-11-10' });
  assert.equal(next.todayLoad, 0);
  assert.ok(Math.abs(next.atl - (f.morning.atl * 6) / 7 - 200 / 7) < 1e-9);
  assert.ok(Math.abs(next.ctl - (f.morning.ctl * 41) / 42 - 200 / 42) < 1e-9);
  assert.ok(next.atl < f.atl && next.ctl < f.ctl);
  assert.equal(next.atl, next.morning.atl);
  // …et la jauge de ce matin-là est exactement celle annoncée la veille au soir
  assert.ok(Math.abs(next.ratio - f.ratio) < 1e-12);
  assert.equal(f.rows[0].date, '2026-11-10');
  const empty = fitnessAt([], '2026-11-15', { seed: 30 });
  assert.equal(empty.ctl, 30);
  assert.equal(empty.zone.key, 'equilibre');
  const totals = weekTotals([
    { date: '2026-11-09', sport: 'bike', durationSec: 3600, load: 50 },
    { date: '2026-11-15', sport: 'run', durationSec: 1800, load: 30 },
    { date: '2026-11-16', sport: 'run', durationSec: 1800, load: 30 },
  ], '2026-11-09');
  assert.deepEqual(totals, { min: 90, load: 80, count: 2, bike: 60, run: 30, other: 0 });
});

test('séances : durées, structure et charge cohérentes', () => {
  const end = buildSession({ sport: 'bike', kind: 'endurance', minutes: 60 });
  assert.equal(end.durationMin, 60);
  assert.equal(end.hard, 0);
  assert.ok(end.load > 40 && end.load < 60, `endurance vélo 1 h = ${end.load} pts`);

  const seuil = buildSession({ sport: 'bike', kind: 'seuil', minutes: 70, step: 3 });
  assert.equal(seuil.detail, '3 × 10 min');
  assert.ok(seuil.durationMin >= 65 && seuil.durationMin <= 72);
  assert.ok(seuil.load > end.load);
  const onSeuil = flatten(seuil.steps).filter((s) => s.kind === 'on' && s.zone === 'i4' && s.sec === 600);
  assert.equal(onSeuil.length, 3);

  // Moins de temps : la séance rétrécit plutôt que de déborder
  const short = buildSession({ sport: 'bike', kind: 'seuil', minutes: 45, step: 5 });
  assert.equal(short.kind, 'seuil');
  assert.ok(short.durationMin <= 47);
  // Vraiment trop court : on bascule sur de l'endurance
  const tiny = buildSession({ sport: 'bike', kind: 'sv1', minutes: 30, step: 2 });
  assert.equal(tiny.kind, 'endurance');
  assert.equal(tiny.fallback, true);
  assert.equal(tiny.durationMin, 30);

  const trente = buildSession({ sport: 'run', kind: 'vma3030', minutes: 45, step: 2 });
  assert.equal(trente.detail, '2 × (8 × 30/30)');
  assert.ok(trente.durationMin <= 47);
  const recov = buildSession({ sport: 'run', kind: 'vma3030', minutes: 45, step: 2, recovery: true });
  assert.equal(recov.detail, '8 × 30/30');

  const sprints = buildSession({ sport: 'bike', kind: 'endurance', minutes: 75, sprints: true });
  assert.equal(sprints.durationMin, 75);
  assert.equal(flatten(sprints.steps).filter((s) => s.zone === 'i7').length, 6);

  const test1 = buildSession({ sport: 'bike', kind: 'test', minutes: 90 });
  assert.equal(test1.durationMin, 70);
  assert.equal(test1.steps.filter((s) => s.kind === 'free').length, 2);
  // Créneau d'1 h : version compacte, avec les deux mêmes efforts de 5 et 20 min
  const compact = buildSession({ sport: 'bike', kind: 'test', minutes: 60 });
  assert.equal(compact.durationMin, 59);
  assert.deepEqual(compact.steps.filter((s) => s.kind === 'free').map((s) => s.sec), [300, 1200]);
  assert.equal(minMinutes('bike', 'test'), 59);
  assert.equal(buildSession({ sport: 'run', kind: 'test', minutes: 30 }).durationMin, 29);
  assert.equal(minMinutes('run', 'test'), 29);

  for (const sport of ['bike', 'run']) {
    for (const kind of ['recup', 'endurance', 'long']) {
      const s = buildSession({ sport, kind, minutes: 50 });
      assert.equal(totalSec(s.steps), 50 * 60, `${sport} ${kind}`);
    }
  }
  // 1 h au seuil = 100 points
  assert.equal(plannedLoad('bike', [{ kind: 'steady', sec: 3600, zone: 'i4', pct: 0.78 }]), 100);
  assert.equal(plannedLoad('run', [{ kind: 'steady', sec: 3600, zone: 'i4', pct: 0.88 }]), 100);
});

test('feu tricolore du jour', () => {
  const fit = (ratio, extra = {}) => ({ ratio, monotony: null, weekLoad: 0, ...extra });
  assert.equal(readiness(fit(0)).level, 'vert');
  assert.equal(readiness(fit(-0.3)).level, 'orange');
  assert.equal(readiness(fit(-0.5)).level, 'rouge');
  assert.equal(readiness(fit(0.1)).level, 'bleu');
  assert.equal(readiness(fit(0.1), { feel: 2 }).level, 'orange');
  assert.equal(readiness(fit(0.1), { feel: 1 }).level, 'rouge');
  assert.equal(readiness(fit(-0.05), { feel: 5 }).level, 'bleu');
  assert.equal(readiness(fit(0), { feel: 4, sick: true }).level, 'rouge');
  assert.equal(readiness(fit(-0.15, { monotony: 2.5, weekLoad: 400 })).level, 'orange');

  const key = { status: 'planned', role: 'key', hard: 2, kind: 'seuil', durationMin: 70 };
  const easy = { status: 'planned', role: 'easy', hard: 0, kind: 'endurance', durationMin: 60 };
  assert.equal(proposeAdaptation(key, 'vert'), null);
  assert.equal(proposeAdaptation(key, 'orange').mode, 'facile');
  assert.equal(proposeAdaptation(easy, 'orange'), null);
  assert.equal(proposeAdaptation(easy, 'rouge').mode, 'recup');
  assert.equal(proposeAdaptation({ ...key, status: 'done' }, 'rouge'), null);
  assert.equal(proposeAdaptation(null, 'rouge'), null);
});

test('puissance : normalisée et records', () => {
  const flat = new Array(600).fill(200);
  assert.equal(Math.round(normalizedPower(flat)), 200);
  // Effort irrégulier : la puissance normalisée dépasse la moyenne
  const spiky = [];
  for (let i = 0; i < 20; i++) spiky.push(...new Array(60).fill(300), ...new Array(60).fill(100));
  assert.ok(normalizedPower(spiky) > 220);
  const series = [...new Array(300).fill(100), ...new Array(300).fill(250), ...new Array(300).fill(100)];
  const best = bestEfforts(series);
  assert.equal(best[300], 250);
  assert.equal(best[60], 250);
  assert.equal(best[1200], undefined); // activité trop courte
  const ppr = powerProfile([
    { date: '2026-11-12', best: { 300: 274, 60: 316 } },
    { date: '2026-11-13', best: { 300: 224, 1200: 209 } },
    { date: '2026-11-14' },
  ]);
  assert.deepEqual(ppr[300], { watts: 274, date: '2026-11-12' });
  assert.deepEqual(suggestRefs(ppr), { pma: 274, ftp: 199 });
});

test('export Zwift (.zwo)', () => {
  const s = { ...buildSession({ sport: 'bike', kind: 'pma3030', minutes: 60, step: 1 }), date: '2026-11-17' };
  const xml = sessionToZwo(s, { pma: 300, ftp: 240 });
  assert.match(xml, /^<workout_file>/);
  assert.match(xml, /<sportType>bike<\/sportType>/);
  assert.match(xml, /<name>Enduro Mar 17-11 30\/30 2 x \(8 x 30\/30\)<\/name>/);
  // 102 % de PMA avec FTP = 80 % de PMA → 1,275 × FTP
  assert.match(xml, /<IntervalsT Repeat="8" OnDuration="30" OffDuration="30" OnPower="1.275" OffPower="0.563">/);
  assert.match(xml, /<Warmup Duration="720" PowerLow="0.500" PowerHigh="0.775">/);
  assert.match(xml, /<Cooldown Duration="480" PowerLow="0.688" PowerHigh="0.500">/);
  assert.ok(!/[^\x00-\x7F]/.test(xml), 'ASCII uniquement');
  // La durée totale du fichier est celle de la séance
  const durations = [...xml.matchAll(/<(Warmup|Cooldown|SteadyState|FreeRide) Duration="(\d+)"/g)].map((m) => Number(m[2]));
  const intervals = [...xml.matchAll(/Repeat="(\d+)" OnDuration="(\d+)" OffDuration="(\d+)"/g)].map((m) => m[1] * (Number(m[2]) + Number(m[3])));
  assert.equal([...durations, ...intervals].reduce((a, b) => a + b, 0), totalSec(s.steps));
  assert.equal(zwoFileName(s), 'enduro-2-mar.zwo');
  assert.equal(zwoFileName({ date: '2026-11-22' }), 'enduro-7-dim.zwo');
  assert.equal(ascii('Échauffement « très » doux → œuf'), 'Echauffement "tres" doux -> oeuf');

  const t = { ...buildSession({ sport: 'bike', kind: 'test', minutes: 75 }), date: '2026-12-06' };
  assert.equal([...sessionToZwo(t).matchAll(/<FreeRide /g)].length, 2);
  const force = { ...buildSession({ sport: 'bike', kind: 'force', minutes: 70 }), date: '2026-12-01' };
  assert.match(sessionToZwo(force), /cadence 50-60 tr\/min/);
  // Blocs longs : pas de récupération après le dernier, et la durée du fichier reste exacte
  const seuil = { ...buildSession({ sport: 'bike', kind: 'seuil', minutes: 70, step: 3 }), date: '2026-12-01' };
  const zs = sessionToZwo(seuil);
  assert.match(zs, /<IntervalsT Repeat="2" OnDuration="600" OffDuration="300"/);
  const zd = [...zs.matchAll(/<(Warmup|Cooldown|SteadyState|FreeRide) Duration="(\d+)"/g)].map((m) => Number(m[2]));
  const zi = [...zs.matchAll(/Repeat="(\d+)" OnDuration="(\d+)" OffDuration="(\d+)"/g)].map((m) => m[1] * (Number(m[2]) + Number(m[3])));
  assert.equal([...zd, ...zi].reduce((a, b) => a + b, 0), totalSec(seuil.steps));
  assert.throws(() => sessionToZwo({ ...buildSession({ sport: 'run', kind: 'endurance', minutes: 40 }), date: '2026-12-01' }));
});

test('lecture d’un fichier FIT', () => {
  const points = Array.from({ length: 900 }, (_, i) => ({ power: i < 300 ? 150 : i < 600 ? 250 : 100, hr: 140 }));
  const file = makeFit(points);
  const raw = decodeFit(file);
  assert.equal(raw.records.length, 900);
  assert.equal(raw.sessions.length, 1);
  const s = summarizeFit(file);
  assert.equal(s.sport, 'bike');
  assert.equal(s.durationSec, 900);
  assert.equal(s.distanceKm, 12.35);
  assert.equal(s.avgPower, 167);
  assert.equal(s.maxPower, 250);
  assert.equal(s.best[300], 250);
  assert.equal(s.avgHr, 140);
  assert.equal(s.startEpoch, 1000000000 + 631065600);
  assert.ok(s.np > s.avgPower);

  const run = summarizeFit(makeFit([{ power: 0xffff, hr: 150 }, { power: 0xffff, hr: 152 }], { sport: 1 }));
  assert.equal(run.sport, 'run');
  assert.equal(run.np, null);
  assert.equal(run.avgHr, 151);

  assert.throws(() => decodeFit(new Uint8Array(20)), /FIT/);
  assert.equal(summarizeFit(makeFit([])), null);
});

test('condition et fatigue, jour après jour, sur dix semaines', () => {
  // Dix semaines d'entraînement irrégulier : séances, jours de repos, deux séances le même jour, une semaine blanche.
  const start = '2026-09-07';
  const acts = [];
  for (let d = 0; d < 70; d++) {
    const date = addDays(start, d);
    if (d >= 35 && d < 42) continue; // semaine sans rien
    const load = [0, 55, 0, 70, 0, 30, 95][d % 7] + (d % 5 === 0 ? 12 : 0);
    if (load) acts.push({ date, load });
    if (d % 11 === 0) acts.push({ date, load: 25 }); // deuxième séance du jour
  }
  const seed = 30;
  // Calcul de référence, écrit sans les fonctions du moteur.
  const daily = {};
  for (const a of acts) daily[a.date] = (daily[a.date] || 0) + a.load;
  let ctl = seed;
  let atl = seed;
  for (let d = 0; d < 70; d++) {
    const date = addDays(start, d);
    const load = daily[date] || 0;
    const known = acts.filter((a) => a.date <= date);
    const f = fitnessAt(known, date, { seed, startDate: start });
    // Maintenant = état du matin + séances du jour
    assert.ok(Math.abs(f.ctl - (ctl + load / 42)) < 1e-9, `condition le ${date}`);
    assert.ok(Math.abs(f.atl - (atl + load / 7)) < 1e-9, `fatigue le ${date}`);
    assert.equal(f.todayLoad, load);
    let week = 0;
    for (let k = 0; k < 7 && d - k >= 0; k++) week += daily[addDays(date, -k)] || 0;
    assert.equal(f.weekLoad, week, `points sur 7 jours le ${date}`);
    // Une nuit passe : la fatigue perd un septième, la condition un quarante-deuxième
    ctl += (load - ctl) / 42;
    atl += (load - atl) / 7;
    // La jauge annonce la fraîcheur du prochain réveil
    const wake = load > 0 ? (ctl - atl) / Math.max(ctl, 15) : f.morning.ratio;
    assert.ok(Math.abs(f.ratio - wake) < 1e-9, `fraîcheur le ${date}`);
  }
  // Après la semaine blanche, la fatigue est retombée bien plus vite que la condition
  const rested = fitnessAt(acts.filter((a) => a.date <= addDays(start, 41)), addDays(start, 41), { seed, startDate: start });
  assert.ok(rested.atl < rested.ctl * 0.6);
  assert.equal(rested.zone.key, 'tresfrais');
});
