// Nuits de la montre (Withings) : habitude, tendance sur 7 nuits, effet sur le
// feu du matin, et lecture des réponses de Withings. Les valeurs attendues ont
// été calculées à part (Python, module statistics).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addDays } from '../public/engine/dates.js';
import { hrvBaseline, nightHrBaseline, nightStatus, hrvSeries } from '../public/engine/nights.js';
import { readiness } from '../public/engine/readiness.js';
import {
  pickNights, nightFromSeries, nightHrv, parsePastedUrl, localDate, authorizeUrl, MIN_SAMPLES,
} from '../server/withings.js';
import { ARTICLES } from '../public/js/manual.js';

const TODAY = '2026-11-17';
const fresh = { ratio: 0.1, ratioNow: 0.1, monotony: null, weekLoad: 0 };

/** 28 nuits d'habitude : 40 ms les jours impairs, 50 ms les jours pairs ; pouls de nuit 50. */
function history(overrides = {}) {
  const nights = {};
  for (let i = 1; i <= 28; i++) nights[addDays(TODAY, -i)] = { rmssd: i % 2 ? 40 : 50, hrAvg: 50 };
  for (const [i, n] of Object.entries(overrides)) nights[addDays(TODAY, -Number(i))] = { hrAvg: 50, ...n };
  return nights;
}

test('nuits : habitude de VFC en logarithme, sur 4 semaines', () => {
  const base = hrvBaseline(history(), TODAY);
  // Calcul indépendant : moyenne des ln = 3,80045 ; écart type = 0,11362
  assert.ok(Math.abs(base.mean - 3.800451) < 1e-5);
  assert.ok(Math.abs(base.sd - 0.113619) < 1e-5);
  assert.deepEqual([base.ms, base.low, base.high, base.nights], [45, 42, 47, 28]);
  // Il faut au moins 7 nuits ; les nuits de plus de 4 semaines ne comptent pas
  const few = {};
  for (let i = 1; i <= 6; i++) few[addDays(TODAY, -i)] = { rmssd: 45 };
  assert.equal(hrvBaseline(few, TODAY), null);
  few[addDays(TODAY, -40)] = { rmssd: 45 };
  assert.equal(hrvBaseline(few, TODAY), null);
  few[addDays(TODAY, -7)] = { rmssd: 45 };
  // Série parfaitement régulière : l'écart type est relevé au plancher
  assert.equal(hrvBaseline(few, TODAY).sd, 0.05);
  // La nuit du jour ne fait pas partie de son propre repère
  assert.equal(hrvBaseline({ ...history(), [TODAY]: { rmssd: 200 } }, TODAY).ms, 45);
});

test('nuits : pouls de nuit habituel = médiane des 21 nuits précédentes', () => {
  const nights = history({ 1: { rmssd: 40, hrAvg: 60 }, 2: { rmssd: 50, hrAvg: 61 } });
  assert.equal(nightHrBaseline(nights, TODAY), 50);
  assert.equal(nightHrBaseline({ [addDays(TODAY, -1)]: { hrAvg: 50 } }, TODAY), null);
});

test('nuits : nuit normale, nuit basse isolée, semaine basse, nuit haute', () => {
  const normal = nightStatus({ ...history(), [TODAY]: { rmssd: 45, hrAvg: 50 } }, TODAY);
  assert.deepEqual([normal.hrv.trendLow, normal.hrv.nightLow, normal.hrv.high], [false, false, false]);
  assert.equal(normal.hr.drift, 0);

  // Une nuit à 36 ms : sous habitude − 1 écart type, mais la moyenne sur 7 nuits reste dans la normale
  const single = nightStatus({ ...history(), [TODAY]: { rmssd: 36, hrAvg: 50 } }, TODAY);
  assert.deepEqual([single.hrv.trendLow, single.hrv.nightLow], [false, true]);

  // Quatre nuits de suite à 36 ms : la semaine sort de la normale (calcul indépendant : 40 ms < 41 ms)
  const week = nightStatus({ ...history({ 1: { rmssd: 36 }, 2: { rmssd: 36 }, 3: { rmssd: 36 } }), [TODAY]: { rmssd: 36, hrAvg: 50 } }, TODAY);
  assert.equal(week.hrv.trendLow, true);
  assert.equal(week.hrv.trend, 40);
  assert.deepEqual([week.hrv.base.ms, week.hrv.base.low, week.hrv.base.high], [44, 41, 47]);

  const high = nightStatus({ ...history(), [TODAY]: { rmssd: 70, hrAvg: 50 } }, TODAY);
  assert.deepEqual([high.hrv.high, high.hrv.trendLow], [true, false]);

  // Pas de nuit ce matin : rien à dire
  assert.equal(nightStatus(history(), TODAY), null);
  // Nuit sans VFC (montre mal serrée) : seul le pouls compte
  const hrOnly = nightStatus({ ...history(), [TODAY]: { hrAvg: 52 } }, TODAY);
  assert.equal(hrOnly.hrv, null);
  assert.equal(hrOnly.hr.drift, 2);
});

test('feu du matin : la VFC ne fait passer à l’orange que si un autre signe confirme', () => {
  const at = (todayNight, overrides = {}) => nightStatus({ ...history(overrides), [TODAY]: { hrAvg: 50, ...todayNight } }, TODAY);
  const lowWeek = at({ rmssd: 36 }, { 1: { rmssd: 36 }, 2: { rmssd: 36 }, 3: { rmssd: 36 } });

  // Dans la normale : rien ne change, « jambes de feu » possibles
  assert.equal(readiness(fresh, { feel: 4 }, { night: at({ rmssd: 45 }) }).level, 'bleu');

  // Une nuit basse isolée : un mot, pas d'orange, mais plus de « jambes de feu »
  const single = readiness(fresh, { feel: 4 }, { night: at({ rmssd: 36 }) });
  assert.equal(single.level, 'vert');
  assert.ok(single.reasons.some((r) => /nuit isolée ne veut rien dire/.test(r)));

  // Semaine basse, mais tu te sens bien et ton pouls est normal : pas d'alerte
  const alone = readiness(fresh, { feel: 4 }, { night: lowWeek });
  assert.equal(alone.level, 'vert');
  assert.ok(alone.reasons.some((r) => /Seule, ce n’est pas une alerte/.test(r)));
  // … même sans bilan du matin
  assert.equal(readiness(fresh, null, { night: lowWeek }).level, 'vert');

  // Semaine basse + « Moyen » : orange
  const meh = readiness(fresh, { feel: 3 }, { night: lowWeek });
  assert.equal(meh.level, 'orange');
  assert.ok(meh.reasons.some((r) => /tu te sens moyen/.test(r)));

  // Semaine basse + pouls du matin un peu haut (+4) : orange
  const pulse = readiness(fresh, { feel: 4, pulse: 54 }, { pulseBase: 50, night: lowWeek });
  assert.equal(pulse.level, 'orange');
  assert.ok(pulse.reasons.some((r) => /VFC de nuit baisse.*pouls de repos est plus haut/.test(r)));

  // Semaine basse + pouls de nuit un peu haut (+4) : orange
  const lowWeekHr = at({ rmssd: 36, hrAvg: 54 }, { 1: { rmssd: 36 }, 2: { rmssd: 36 }, 3: { rmssd: 36 } });
  assert.equal(readiness(fresh, { feel: 4 }, { night: lowWeekHr }).level, 'orange');

  // Nuit haute : bon signe, dit seulement quand tout va bien
  const high = readiness(fresh, { feel: 4 }, { night: at({ rmssd: 70 }) });
  assert.equal(high.level, 'bleu');
  assert.ok(high.reasons.some((r) => /belle récupération/.test(r)));
  assert.ok(!readiness(fresh, { feel: 2 }, { night: at({ rmssd: 70 }) }).reasons.some((r) => /belle récupération/.test(r)));

  // Malade : rouge, quoi que dise la montre
  assert.equal(readiness(fresh, { feel: 4, sick: true }, { night: at({ rmssd: 70 }) }).level, 'rouge');
});

test('feu du matin : le pouls de nuit suit la règle du pouls du matin', () => {
  const at = (hrAvg) => nightStatus({ ...history(), [TODAY]: { rmssd: 45, hrAvg } }, TODAY);
  const alert = readiness(fresh, { feel: 4 }, { night: at(57) });
  assert.equal(alert.level, 'orange');
  assert.ok(alert.reasons.some((r) => /pouls de cette nuit est 7 battements au-dessus/.test(r)));
  const watch = readiness(fresh, { feel: 4 }, { night: at(54) });
  assert.equal(watch.level, 'vert');
  assert.ok(watch.reasons.some((r) => /un peu plus haut/.test(r)));
  assert.equal(readiness(fresh, { feel: 4 }, { night: at(53) }).level, 'bleu');
});

test('nuits : série du graphique (une valeur par jour, moyenne sur 7 nuits)', () => {
  const rows = hrvSeries({ ...history(), [TODAY]: { rmssd: 45 } }, TODAY, 14);
  assert.equal(rows.length, 14);
  assert.equal(rows.at(-1).date, TODAY);
  assert.equal(rows.at(-1).value, 45);
  assert.ok(rows.every((r) => r.trend > 40 && r.trend < 50));
});

test('Withings : une nuit par matin, dans le fuseau de la montre', () => {
  // 23 h 30 à Paris le 16 = 22 h 30 UTC ; réveil 7 h 10 le 17
  assert.equal(localDate(Date.UTC(2026, 10, 17, 6, 10) / 1000, 'Europe/Paris'), '2026-11-17');
  assert.equal(localDate(Date.UTC(2026, 10, 16, 23, 30) / 1000, 'Europe/Paris'), '2026-11-17');
  assert.equal(localDate(Date.UTC(2026, 10, 16, 23, 30) / 1000, 'America/New_York'), '2026-11-16');
  const night = {
    startdate: Date.UTC(2026, 10, 16, 22, 30) / 1000, enddate: Date.UTC(2026, 10, 17, 6, 10) / 1000, timezone: 'Europe/Paris',
    modified: 1, model_id: 94, data: { total_sleep_time: 25200, hr_average: 52, hr_min: 46, rmssd_start_avg: 48, rmssd_end_avg: 60 },
  };
  const nap = {
    startdate: Date.UTC(2026, 10, 17, 13, 0) / 1000, enddate: Date.UTC(2026, 10, 17, 13, 40) / 1000, timezone: 'Europe/Paris',
    data: { total_sleep_time: 2100, hr_average: 58 },
  };
  const odd = { startdate: 10, enddate: 5, data: {} }; // dates incohérentes : ignorée
  const list = pickNights([nap, night, odd, null]);
  assert.equal(list.length, 1);
  assert.deepEqual(
    { date: list[0].date, sleepMin: list[0].sleepMin, hrAvg: list[0].hrAvg, hrMin: list[0].hrMin, model: list[0].model },
    { date: '2026-11-17', sleepMin: 420, hrAvg: 52, hrMin: 46, model: 94 },
  );
  // Valeurs impossibles écartées
  const bad = pickNights([{ ...night, data: { hr_average: 0, rmssd_start_avg: 0 } }])[0];
  assert.equal(bad.hrAvg, null);
  assert.equal(bad.rmssdStart, null);
});

test('Withings : VFC de la nuit = médiane des mesures, sinon moyennes du résumé', () => {
  const t = 1700000000;
  // Forme réelle : une liste de tranches de sommeil. Une mesure aberrante (250) ne déplace pas la médiane.
  const parts = [
    { startdate: t, enddate: t + 3600, rmssd: { [t]: 40, [t + 600]: 44, [t + 1200]: 46 }, hr: { [t]: 52, [t + 600]: 50 } },
    { startdate: t + 3600, enddate: t + 7200, rmssd: { [t + 3600]: 48, [t + 4200]: 50, [t + 4800]: 52, [t + 5400]: 250 }, hr: { [t + 3600]: 49, [t + 4200]: 48, [t + 4800]: 47 } },
  ];
  assert.deepEqual(nightFromSeries(parts), { rmssd: 48, samples: 7, hrMedian: 49 });
  // Forme documentée : un seul objet
  assert.equal(nightFromSeries(parts[1]).samples, 4);
  assert.equal(nightFromSeries(parts[1]).rmssd, null); // moins de MIN_SAMPLES mesures
  assert.equal(MIN_SAMPLES, 5);
  assert.deepEqual(nightFromSeries(undefined), { rmssd: null, samples: 0, hrMedian: null });
  // Mesures 0 ou absurdes écartées
  assert.equal(nightFromSeries([{ rmssd: { 1: 0, 2: -3, 3: 900, 4: 'x' } }]).samples, 0);

  assert.deepEqual(nightHrv({ samples: 7, rmssdSeries: 48, rmssdStart: 30, rmssdEnd: 34 }), { rmssd: 48, hrvFrom: 'detail' });
  assert.deepEqual(nightHrv({ samples: 2, rmssdSeries: null, rmssdStart: 30, rmssdEnd: 35 }), { rmssd: 32.5, hrvFrom: 'resume' });
  assert.deepEqual(nightHrv({ samples: 0, rmssdStart: null, rmssdEnd: 41 }), { rmssd: 41, hrvFrom: 'resume' });
  assert.deepEqual(nightHrv({ samples: 0 }), { rmssd: null, hrvFrom: null });
});

test('Withings : adresse d’autorisation et adresse collée', () => {
  const url = new URL(authorizeUrl('abc', 'http://localhost:5180/api/withings/callback', 'w123'));
  assert.equal(url.origin + url.pathname, 'https://account.withings.com/oauth2_user/authorize2');
  assert.equal(url.searchParams.get('scope'), 'user.activity');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:5180/api/withings/callback');
  assert.deepEqual(parsePastedUrl(' https://exemple.fr/retour?code=XYZ&state=w1 '), { code: 'XYZ', state: 'w1', error: null });
  assert.deepEqual(parsePastedUrl('code=XYZ&state=w1'), { code: 'XYZ', state: 'w1', error: null });
  assert.deepEqual(parsePastedUrl('n’importe quoi'), { code: null, state: null, error: null });
});

test('manuel : la fiche récupération explique la VFC et cite ses sources', () => {
  const recup = ARTICLES.find((a) => a.id === 'recup');
  const text = JSON.stringify(recup.blocks ?? recup);
  assert.match(text, /VFC de la nuit/);
  assert.match(text, /Une baisse seule n’est pas une alerte/);
  assert.ok(recup.sources.some((s) => /Plews/.test(s)));
  assert.ok(recup.sources.some((s) => /Javaloyes/.test(s)));
  assert.ok(recup.sources.some((s) => /Bible du running/.test(s) && /VFC/.test(s)));
});
