import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { detectRamp } from '../public/engine/power.js';
import { summarizeFit } from '../public/engine/fit.js';
import { flatEquivalentKm, enduranceFraction } from '../public/engine/running.js';
import {
  estimatePower, estimateVma, estimateFcMaxFromData, estimateRefs, testActivityIds, fmtClock,
} from '../public/engine/estimate.js';
import { resolveRefs } from '../public/engine/zones.js';
import { computeLoad } from '../public/engine/load.js';
import { upgradeLoads, withLoad } from '../server/activities.js';
import { reanalyzeRides } from '../server/zwift.js';
import { mapStravaActivity, mapBestEfforts } from '../server/strava.js';
import { makeFit } from './helpers.js';

const TODAY = '2026-11-15';

/** Test rampe façon Zwift : 5 min à 100 W, puis +20 W par minute, arrêt, 40 s de roue libre. */
function rampSeries({ steps = 11, last = 40, tail = 40, warm = 300 } = {}) {
  const s = new Array(warm).fill(100);
  for (let k = 1; k <= steps; k++) s.push(...new Array(k === steps ? last : 60).fill(100 + 20 * k));
  s.push(...new Array(tail).fill(60));
  return s;
}

test('test rampe : reconnu à sa forme, pas confondu avec autre chose', () => {
  const ramp = detectRamp(rampSeries());
  assert.ok(ramp, 'rampe non détectée');
  assert.ok(ramp.map >= 305 && ramp.map <= 320, `meilleure minute ${ramp.map}`);
  assert.ok(ramp.steps >= 6);
  assert.ok(ramp.stepW >= 18 && ramp.stepW <= 22);
  // Avec un peu de bruit dans la puissance, comme sur un vrai home trainer
  const noisy = rampSeries().map((w, i) => w + ((i * 37) % 11) - 5);
  assert.ok(detectRamp(noisy));

  assert.equal(detectRamp(new Array(1200).fill(250)), null, 'effort régulier');
  const intervals = [];
  for (let i = 0; i < 7; i++) intervals.push(...new Array(150).fill(275), ...new Array(210).fill(130));
  assert.equal(detectRamp(intervals), null, 'fractionné');
  assert.equal(detectRamp(rampSeries({ steps: 4 })), null, 'rampe trop courte');
  assert.equal(detectRamp(rampSeries().slice(0, 400)), null, 'activité trop courte');
  // Une montée progressive qui continue fort ensuite n'est pas un test rampe
  const climb = [...rampSeries({ tail: 0 }), ...new Array(300).fill(300)];
  assert.equal(detectRamp(climb), null, 'pas d’arrêt après le pic');
  // Un sprint d'une minute au milieu d'une sortie tranquille non plus
  const sprint = [...new Array(900).fill(150), ...new Array(60).fill(450), ...new Array(900).fill(120)];
  assert.equal(detectRamp(sprint), null, 'sprint isolé');
});

test('fichier FIT : le test rampe et la FC max filtrée arrivent dans le résumé', () => {
  // FC qui monte de 120 à 181 bpm, avec un pic parasite d'une seconde à 231 bpm
  const points = rampSeries().map((power, i) => ({ power, hr: i === 500 ? 231 : 120 + Math.floor(i / 16) }));
  const s = summarizeFit(makeFit(points));
  assert.ok(s.ramp && s.ramp.map > 300);
  // Le pic isolé est ignoré : on garde la plus haute valeur tenue 3 secondes
  assert.equal(s.maxHr, 181);
  assert.equal(summarizeFit(makeFit(new Array(900).fill({ power: 200, hr: 140 }))).ramp, null);
});

test('course à pied : équivalent plat et part de VMA tenable', () => {
  assert.equal(flatEquivalentKm(10, 0), 10);
  // Parcours roulant : montées et descentes se compensent presque
  assert.ok(Math.abs(flatEquivalentKm(10, 100) - 10.243) < 0.001);
  // Montagne : 100 m de D+ = 1 km
  assert.equal(flatEquivalentKm(10, 1000), 20);
  assert.equal(flatEquivalentKm(0, 100), 0);
  assert.equal(enduranceFraction(6), 1);
  assert.ok(Math.abs(enduranceFraction(20) - 0.918) < 0.002);
  assert.ok(Math.abs(enduranceFraction(60) - 0.843) < 0.002);
  assert.ok(enduranceFraction(240) < enduranceFraction(120));
  assert.ok(enduranceFraction(3) > 1 && enduranceFraction(0.1) <= 1.12);
  assert.equal(fmtClock(2368), '39 min 28');
  assert.equal(fmtClock(3725), '1 h 02 min');
  assert.equal(fmtClock(1200), '20 min');
});

test('FTP et PMA : test rampe, records, tests du plan', () => {
  const rampRide = { id: 'r', sport: 'bike', date: '2026-11-12', best: { 60: 316, 300: 274 }, ramp: { map: 316, steps: 10, stepW: 22 } };
  const workout = { id: 'w', sport: 'bike', date: '2026-11-13', best: { 300: 224, 1200: 209 } };
  const both = estimatePower([rampRide, workout], TODAY);
  assert.equal(both.ftp.value, 237); // 75 % de 316 W
  assert.equal(both.ftp.quality, 'test');
  assert.match(both.ftp.basis, /test rampe du 12 nov\./);
  assert.equal(both.pma.value, 304); // 237 / 0,78, au-dessus du record sur 5 min (274 W)
  assert.equal(both.pma.derived, true);

  // Sans test rampe : les records donnent un minimum
  const records = estimatePower([workout], TODAY);
  assert.equal(records.ftp.value, 199); // 95 % de 209 W
  assert.equal(records.ftp.quality, 'record');
  assert.equal(records.pma.value, 255); // 199 / 0,78 > 224 W
  // Un gros record sur 5 min l'emporte sur la valeur déduite de la FTP
  const punchy = estimatePower([{ id: 'p', sport: 'bike', date: '2026-11-10', best: { 300: 330, 1200: 240 } }], TODAY);
  assert.equal(punchy.pma.value, 330);
  assert.equal(punchy.pma.quality, 'record');
  assert.equal(punchy.ftp.value, 228);
  // Seulement un record sur 5 min : la FTP s'en déduit
  const short = estimatePower([{ id: 's', sport: 'bike', date: '2026-11-10', best: { 300: 300 } }], TODAY);
  assert.equal(short.pma.value, 300);
  assert.equal(short.ftp.value, 234);
  assert.equal(short.ftp.derived, true);

  // Une séance « test » du plan faite à fond : mêmes calculs, mais notés comme un vrai test
  const done = { id: 'manual:1', sport: 'bike', date: '2026-11-14', best: { 300: 310, 1200: 250 } };
  const tested = estimatePower([done], TODAY, new Set(['manual:1']));
  assert.equal(tested.pma.quality, 'test');
  assert.equal(tested.ftp.value, 238);
  assert.equal(tested.ftp.quality, 'test');
  assert.deepEqual([...testActivityIds({ weeks: { a: { sessions: [{ kind: 'test', activityId: 'manual:1' }, { kind: 'seuil', activityId: 'x' }, { kind: 'test' }] } } })], ['manual:1']);

  // Trop vieux (plus de 4 mois), autre sport, ou sans puissance : rien
  assert.deepEqual(estimatePower([{ ...rampRide, date: '2026-06-01' }], TODAY), { ftp: null, pma: null });
  assert.deepEqual(estimatePower([{ id: 'x', sport: 'run', date: '2026-11-10', best: { 300: 400 } }], TODAY), { ftp: null, pma: null });
  assert.deepEqual(estimatePower([{ id: 'y', sport: 'bike', date: '2026-11-10' }], TODAY), { ftp: null, pma: null });
});

test('VMA : courses, meilleurs temps, cardio', () => {
  const runs = [
    { sport: 'run', date: '2026-10-13', distanceKm: 4.09, durationSec: 1029, elevationM: 28 },
    { sport: 'run', date: '2026-11-01', distanceKm: 9.78, durationSec: 2680, elevationM: 87 },
    { sport: 'run', date: '2026-11-15', distanceKm: 9.37, durationSec: 2368, elevationM: 29 },
  ];
  const v = estimateVma(runs, TODAY);
  assert.equal(v.value, 16.4);
  assert.equal(v.quality, 'record');
  assert.match(v.basis, /course du 15 nov\. : 9,4 km en 39 min 28/);
  // La même course marquée « compétition » dans Strava : un effort maximal, donc un vrai test
  assert.equal(estimateVma([{ ...runs[2], race: true }], TODAY).quality, 'test');
  assert.equal(estimateVma([{ ...runs[2], rpe: 9 }], TODAY).quality, 'test');

  // Du fractionné : le meilleur kilomètre (3 min 20) en dit plus que la moyenne de la séance
  const track = { sport: 'run', date: '2026-11-10', distanceKm: 8, durationSec: 2880, runBest: { 400: 70, 1000: 200, 5000: 1500 } };
  const t = estimateVma([track], TODAY);
  assert.equal(t.value, 17.3);
  assert.match(t.basis, /meilleur 1 km \(3 min 20/);
  // Le 400 m en 70 s (trop court, trop d'anaérobie) n'est pas utilisé
  assert.ok(estimateVma([{ ...track, runBest: { 400: 60 } }], TODAY).value < 13);

  // Footings au cardio : allure ÷ part de réserve cardiaque (ici 10 km/h à 70 % → VMA ≈ 14,3)
  const easy = [1, 2, 3].map((i) => ({ sport: 'run', date: `2026-11-0${i}`, distanceKm: 10, durationSec: 3600, avgHr: 60 + 0.7 * 130 }));
  const h = estimateVma(easy, TODAY, { fcmax: 190, fcrest: 60 });
  assert.equal(h.value, 14.3);
  assert.equal(h.quality, 'cardio');
  assert.match(h.basis, /3 footings/);
  // Sans FC max connue, on retombe sur le minimum donné par la performance
  assert.equal(estimateVma(easy, TODAY).quality, 'record');
  assert.ok(estimateVma(easy, TODAY).value < 12.5);

  // Trace GPS aberrante, activité trop vieille ou vélo : ignorées
  assert.equal(estimateVma([{ sport: 'run', date: '2026-11-10', distanceKm: 30, durationSec: 3600 }], TODAY), null);
  assert.equal(estimateVma([{ ...runs[2], date: '2026-05-01' }], TODAY), null);
  assert.equal(estimateVma([{ ...runs[2], sport: 'bike' }], TODAY), null);
  assert.equal(estimateVma([], TODAY), null);
});

test('FC max : la plus haute vue en séance, sinon l’âge', () => {
  const act = (maxHr, date = '2026-11-10') => ({ sport: 'run', date, maxHr });
  // 40 ans → 180 bpm par la formule
  const seen = estimateFcMaxFromData([act(172), act(186), act(150)], TODAY, 40);
  assert.equal(seen.value, 186);
  assert.equal(seen.quality, 'record');
  // Jamais monté haut (155 bpm) : la formule reste plus crédible
  const low = estimateFcMaxFromData([act(155)], TODAY, 40);
  assert.equal(low.value, 180);
  assert.equal(low.quality, 'formule');
  assert.match(low.basis, /155 bpm au plus/);
  // Un pic à 228 bpm est un artefact de capteur
  assert.equal(estimateFcMaxFromData([act(228), act(184)], TODAY, 40).value, 184);
  // Sans âge : on prend ce qu'on voit ; sans rien : pas d'estimation
  assert.equal(estimateFcMaxFromData([act(191)], TODAY, null).value, 191);
  assert.equal(estimateFcMaxFromData([], TODAY, 40).value, 180);
  assert.equal(estimateFcMaxFromData([], TODAY, null), null);
  // Plus d'un an : trop vieux
  assert.equal(estimateFcMaxFromData([act(195, '2025-10-01')], TODAY, 40).value, 180);
});

test('repères : ce qui est saisi passe avant, le reste est estimé', () => {
  const acts = [
    { id: 'r', sport: 'bike', date: '2026-11-12', best: { 300: 274 }, ramp: { map: 316 } },
    { id: 'c', sport: 'run', date: '2026-11-15', distanceKm: 9.37, durationSec: 2368, elevationM: 29 },
  ];
  // Rien de saisi : tout vient des activités et de l'âge
  const empty = { birthYear: 1997, refs: {} };
  const a = resolveRefs(empty, 2026, estimateRefs(acts, empty, TODAY));
  assert.deepEqual([a.ftp, a.pma, a.vma, a.fcmax], [237, 304, 16.4, 188]);
  assert.deepEqual(a.est, { pma: true, ftp: true, fcmax: true, fcrest: true, vma: true });
  assert.equal(a.why.ftp.quality, 'test');
  assert.equal(a.why.vma.quality, 'record');
  assert.equal(a.why.fcmax.quality, 'formule');

  // FTP saisie : on la garde, et la PMA s'en déduit
  const withFtp = { birthYear: 1997, refs: { ftp: 241 } };
  const b = resolveRefs(withFtp, 2026, estimateRefs(acts, withFtp, TODAY));
  assert.equal(b.ftp, 241);
  assert.equal(b.est.ftp, undefined);
  assert.equal(b.pma, 309);
  assert.equal(b.why.pma.quality, 'formule');
  assert.equal(b.vma, 16.4);

  // FTP saisie mais record sur 5 min supérieur à la valeur déduite : le record l'emporte
  const strong = [{ id: 'p', sport: 'bike', date: '2026-11-10', best: { 300: 330 } }];
  const c = resolveRefs(withFtp, 2026, estimateRefs(strong, withFtp, TODAY));
  assert.equal(c.pma, 330);
  assert.equal(c.why.pma.quality, 'record');

  // Tout saisi : aucune estimation ne s'en mêle
  const full = { birthYear: 1997, refs: { pma: 320, ftp: 250, vma: 17.5, fcmax: 192, fcrest: 48 } };
  const d = resolveRefs(full, 2026, estimateRefs(acts, full, TODAY));
  assert.deepEqual([d.pma, d.ftp, d.vma, d.fcmax, d.fcrest], [320, 250, 17.5, 192, 48]);
  assert.deepEqual(d.est, {});
  assert.deepEqual(d.why, {});

  // PMA saisie seule : la FTP vaut 78 % de la PMA, sauf si un test dit mieux (sans dépasser 90 % de la PMA)
  const withPma = { refs: { pma: 300 } };
  assert.equal(resolveRefs(withPma, 2026, estimateRefs([], withPma, TODAY)).ftp, 234);
  assert.equal(resolveRefs(withPma, 2026, estimateRefs(acts, withPma, TODAY)).ftp, 237);
  const lowPma = { refs: { pma: 250 } };
  assert.equal(resolveRefs(lowPma, 2026, estimateRefs(acts, lowPma, TODAY)).ftp, 225);

  // Aucune donnée, aucun âge : rien à estimer, et l'app le dit
  const none = resolveRefs({ refs: {} }, 2026, estimateRefs([], { refs: {} }, TODAY));
  assert.deepEqual([none.pma, none.ftp, none.vma, none.fcmax], [null, null, null, null]);
});

test('charges : elles suivent l’estimation tant qu’elle s’affine, puis se figent', () => {
  const run = { sport: 'run', date: '2026-11-10', durationSec: 3600, distanceKm: 12 };
  const estimated = { vma: 15, est: { vma: true } };
  assert.deepEqual(computeLoad(run, estimated), { load: 83, method: 'pace', est: true });
  assert.deepEqual(computeLoad(run, { vma: 15, est: {} }), { load: 83, method: 'pace' });

  const list = [withLoad(run, estimated), withLoad({ ...run, date: '2026-08-01' }, estimated)];
  assert.equal(list[0].loadEst, true);
  // L'estimation monte (nouveau record) : la course récente est recalculée, l'ancienne reste figée
  assert.equal(upgradeLoads(list, { vma: 16, est: { vma: true } }, TODAY), 1);
  assert.equal(list[0].load, 73);
  assert.equal(list[1].load, 83);
  // Une vraie VMA est saisie : toutes les charges estimées sont recalculées, et ne bougeront plus
  assert.equal(upgradeLoads(list, { vma: 17, est: {} }, TODAY), 2);
  assert.deepEqual(list.map((a) => [a.load, a.loadEst]), [[64, undefined], [64, undefined]]);
  assert.equal(upgradeLoads(list, { vma: 18, est: {} }, TODAY), 0);
  assert.equal(list[0].load, 64);
});

test('Strava : meilleurs temps et compétitions', () => {
  assert.deepEqual(mapBestEfforts([
    { name: '400m', distance: 400, elapsed_time: 92, moving_time: 92 },
    { name: '1K', distance: 1000, elapsed_time: 241 },
    { name: '5K', distance: 5000.4, moving_time: 1290 },
    { name: 'cassé', distance: 0, elapsed_time: 10 },
  ]), { 400: 92, 1000: 241, 5000: 1290 });
  assert.deepEqual(mapBestEfforts(undefined), {});
  const base = { id: 5, start_date_local: '2026-11-14T10:00:00Z', moving_time: 2400 };
  assert.equal(mapStravaActivity({ ...base, sport_type: 'Run', workout_type: 1 }).race, true);
  assert.equal(mapStravaActivity({ ...base, sport_type: 'Ride', workout_type: 11 }).race, true);
  assert.equal(mapStravaActivity({ ...base, sport_type: 'Run', workout_type: 2 }).race, undefined);
  assert.equal(mapStravaActivity({ ...base, sport_type: 'Ride', workout_type: 1 }).race, undefined);
});

test('Zwift : les sorties déjà importées sont relues pour y trouver un test rampe', () => {
  const dir = mkdtempSync(join(tmpdir(), 'enduro-zwift-'));
  try {
    mkdirSync(join(dir, 'Activities'));
    writeFileSync(join(dir, 'Activities', 'rampe.fit'), makeFit(rampSeries().map((power) => ({ power }))));
    writeFileSync(join(dir, 'Activities', 'casse.fit'), Buffer.from('ceci n’est pas un fichier fit'));
    const activities = [
      { id: 'zwift:rampe', best: { 60: 300 }, rpe: 7 },
      { id: 'zwift:disparue', best: { 60: 200 } },
      { id: 'zwift:casse', best: { 60: 210 } },
      { id: 'zwift:deja', fitV: 2 },
      { id: 'strava:1' },
    ];
    assert.equal(reanalyzeRides(dir, activities), 1);
    assert.ok(activities[0].ramp.map > 300);
    assert.equal(activities[0].rpe, 7);
    assert.equal(activities[0].fitV, 2);
    // Fichier disparu ou illisible : on garde ce qu'on avait, sans réessayer à chaque ouverture
    assert.deepEqual(activities[1], { id: 'zwift:disparue', best: { 60: 200 }, fitV: 2 });
    assert.deepEqual(activities[2], { id: 'zwift:casse', best: { 60: 210 }, fitV: 2 });
    assert.deepEqual(activities[4], { id: 'strava:1' });
    assert.equal(reanalyzeRides(dir, activities), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
