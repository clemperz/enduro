// Ce que le plan doit respecter d'après « Science of Cycling » (D. Bailey, DK, 2025) :
// intensités des séances en % de FTP, affûtage, semaine de course, ravitaillement, renforcement.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addDays, dayIndex, diffDays } from '../public/engine/dates.js';
import { buildSession, flatten } from '../public/engine/workouts.js';
import { FTP_PER_PMA, DEFAULT_PCT } from '../public/engine/zones.js';
import { previewWeeks } from '../public/engine/plan.js';
import { explainWeek, strengthNote, PHASE_WHY } from '../public/engine/explain.js';
import { ARTICLES } from '../public/js/manual.js';

const START = '2026-11-16';
const ftp = (pctPma) => Math.round((pctPma / FTP_PER_PMA) * 100); // % de FTP
/** Blocs d'effort d'une séance (hors échauffement, récupérations et remplissage). */
const efforts = (s, zone) => flatten(s.steps).filter((x) => x.zone === zone && x.sec >= 20 && !/veil|chauff|calme/i.test(x.label ?? ''));
const sumMin = (w) => w.sessions.reduce((t, s) => t + (s.durationMin || 0), 0);
const hard = (s) => s.hard >= 2 && s.role !== 'race';

test('livre : intensités des séances vélo, en % de FTP', () => {
  const s = (kind, step = 3, minutes = 90) => buildSession({ sport: 'bike', kind, minutes, step });
  // Récupération : sous 55 % de la FTP
  assert.ok(ftp(DEFAULT_PCT.bike.i1) < 55, `décrassage à ${ftp(DEFAULT_PCT.bike.i1)} %`);
  // Endurance : zone 2 (56–75 %)
  assert.ok(ftp(DEFAULT_PCT.bike.i2) >= 56 && ftp(DEFAULT_PCT.bike.i2) <= 75);
  // Endurance haute : à la frontière endurance / tempo, pas au-dessus
  for (const e of efforts(s('sv1'), 'i2').filter((x) => x.label?.includes('Haut'))) assert.ok(ftp(e.pct) <= 78, `sv1 à ${ftp(e.pct)} %`);
  // Tempo et sweet spot : 85–95 %
  for (const kind of ['tempo', 'sweetspot']) {
    const blocks = efforts(s(kind), 'i3');
    assert.ok(blocks.length >= 2);
    for (const e of blocks) assert.ok(ftp(e.pct) >= 85 && ftp(e.pct) <= 95, `${kind} à ${ftp(e.pct)} %`);
  }
  // Seuil : 90–105 %, les blocs de 15 min et plus un peu sous la FTP
  for (let step = 0; step < 7; step++) {
    const blocks = efforts(s('seuil', step, 120), 'i4').filter((x) => x.sec >= 300);
    assert.ok(blocks.length >= 2, `seuil cran ${step}`);
    for (const e of blocks) {
      assert.ok(ftp(e.pct) >= 90 && ftp(e.pct) <= 105, `seuil à ${ftp(e.pct)} %`);
      if (e.sec >= 900) assert.ok(ftp(e.pct) < 100, 'bloc long : sous la FTP');
    }
  }
  // PMA : les efforts de 3 min et plus entre 105 et 120 %, récupération égale à l'effort
  for (let step = 0; step < 6; step++) {
    const session = s('pma', step, 120);
    const on = efforts(session, 'i5').filter((x) => x.sec >= 120);
    assert.ok(on.length >= 4, `pma cran ${step}`);
    for (const e of on) {
      if (e.sec >= 180) assert.ok(ftp(e.pct) >= 105 && ftp(e.pct) <= 120, `PMA ${e.sec / 60} min à ${ftp(e.pct)} %`);
      else assert.ok(ftp(e.pct) >= 120 && ftp(e.pct) <= 150, `PMA 2 min à ${ftp(e.pct)} %`);
    }
    const set = session.steps.find((x) => x.kind === 'intervals' && x.on.zone === 'i5' && x.on.sec >= 120);
    assert.equal(set.off.sec, set.on.sec);
  }
  // Sprints : 10 s, récupération complète
  const sprint = flatten(buildSession({ sport: 'bike', kind: 'endurance', minutes: 75, sprints: true }).steps).filter((x) => x.zone === 'i7');
  assert.ok(sprint.length >= 4 && sprint.every((x) => x.sec === 10));
});

test('livre : ravitaillement selon la durée de la sortie', () => {
  const tips = (kind, minutes) => buildSession({ sport: 'bike', kind, minutes }).tips.join(' ');
  assert.match(tips('long', 180), /60 à 90 g/);
  assert.match(tips('long', 180), /jour J/);
  assert.match(tips('long', 100), /30 à 60 g/);
  assert.doesNotMatch(tips('long', 100), /60 à 90 g/);
  assert.doesNotMatch(tips('endurance', 45), /glucides/);
  assert.match(tips('endurance', 90), /30 à 60 g/);
});

const PROFILES = {
  toi: { level: 'intermediaire', split: 0.75, hoursNow: 3, indoor: 'toujours', avail: [60, 60, 0, 120, 0, 0, 180] },
  six: { level: 'intermediaire', split: 1, hoursNow: 6, indoor: 'jamais', avail: [60, 75, 60, 75, 0, 120, 240] },
  dix: { level: 'confirme', split: 1, hoursNow: 10, indoor: 'jamais', avail: [0, 90, 120, 90, 60, 180, 300] },
  debutant: { level: 'debutant', split: 0.5, hoursNow: 3, indoor: 'jamais', avail: [0, 45, 0, 60, 0, 60, 120] },
  coureur: { level: 'intermediaire', split: 0, hoursNow: 4, indoor: 'jamais', avail: [45, 0, 60, 45, 0, 60, 120] },
};
function prep(p, raceDay = 6) {
  const sport = p.split === 0 ? 'run' : 'bike';
  const date = addDays(START, 7 * 13 + raceDay);
  const profile = { ...p, refs: {}, goals: [{ id: 'g', name: 'Course', sport, date, major: true }] };
  const weeks = previewWeeks(profile, { startDate: START, weeks: {} }, { today: START }, START, 14);
  return { profile, date, load: weeks[11], taper: weeks[12], race: weeks[13] };
}

test('livre : affûtage — moins de volume, même intensité, autant de séances', () => {
  for (const [name, p] of Object.entries(PROFILES)) {
    const { load, taper } = prep(p);
    assert.equal(taper.info.phase, 'affutage', name);
    // Volume : nettement moins que la dernière semaine de charge
    assert.ok(sumMin(taper) <= sumMin(load) * 0.7, `${name} : ${sumMin(load)} → ${sumMin(taper)} min`);
    assert.ok(sumMin(taper) >= sumMin(load) * 0.4, `${name} : affûtage trop creux (${sumMin(taper)} min)`);
    // Fréquence : au plus une séance de moins
    assert.ok(taper.sessions.length >= load.sessions.length - 1, `${name} : ${load.sessions.length} → ${taper.sessions.length} séances`);
    // Intensité : il reste au moins une séance dure (sauf volume vraiment trop petit), plus courte qu'en charge
    const keys = taper.sessions.filter(hard);
    assert.ok(keys.length >= 1, `${name} : plus d'intensité pendant l'affûtage`);
    const before = Math.max(...load.sessions.filter(hard).map((s) => s.durationMin));
    for (const k of keys) assert.ok(k.durationMin <= before, `${name} : séance dure plus longue qu'en charge`);
    // Les efforts gardent leur allure : même cible que dans la bibliothèque, simplement moins nombreux
    for (const k of keys) {
      const full = buildSession({ sport: k.sport, kind: k.kind, minutes: 120, step: 5 });
      const pct = (s) => Math.max(...flatten(s.steps).filter((x) => x.zone === s.zone).map((x) => x.pct));
      assert.ok(pct(k) >= pct(full) - 0.001, `${name} : ${k.title} moins intense qu'en charge`);
      const work = (s) => flatten(s.steps).filter((x) => x.zone === s.zone).reduce((t, x) => t + x.sec, 0);
      assert.ok(work(k) < work(full), `${name} : ${k.title} pas plus courte`);
    }
    // Jamais deux jours durs de suite, et la sortie longue raccourcit
    const days = taper.sessions.filter(hard).map((s) => dayIndex(s.date));
    for (const d of days) assert.ok(!days.includes(d + 1), name);
    const long = (w) => w.sessions.find((s) => s.role === 'long')?.durationMin ?? 0;
    assert.ok(long(taper) < long(load), `${name} : sortie longue ${long(load)} → ${long(taper)}`);
  }
});

test('livre : semaine de course — un rappel d’intensité tôt, puis du facile, sans gonfler le volume', () => {
  for (const [name, p] of Object.entries(PROFILES)) {
    const { date, race, taper } = prep(p);
    const before = race.sessions.filter((s) => s.role !== 'race');
    const sharp = before.filter(hard);
    if (p.level === 'debutant') {
      assert.equal(sharp.length, 0, `${name} : pas de rappel pour un débutant`);
    } else {
      assert.equal(sharp.length, 1, `${name} : un rappel d'intensité (${before.map((s) => s.title).join(', ')})`);
      assert.ok(diffDays(sharp[0].date, date) >= 4, `${name} : rappel trop près de la course`);
      assert.ok(sharp[0].durationMin <= 50);
      assert.match(sharp[0].why, /Rappel d’intensité/);
      // Court : une dizaine de minutes d'effort au plus
      const work = flatten(sharp[0].steps).filter((x) => x.zone === 'i5' && x.sec >= 60).reduce((t, x) => t + x.sec, 0);
      assert.ok(work > 0 && work <= 12 * 60, `${name} : ${work / 60} min d'effort`);
    }
    // Rien de dur dans les trois jours qui précèdent, rien après la course
    for (const s of before) {
      assert.ok(s.date < date);
      if (diffDays(s.date, date) <= 3) assert.ok(s.hard < 2, `${name} : ${s.title} trop près de la course`);
    }
    // Moins de volume que la semaine d'affûtage
    assert.ok(sumMin(race) <= sumMin(taper), `${name} : ${sumMin(taper)} → ${sumMin(race)} min`);
    assert.ok(sumMin(race) <= race.targetMin + 10, `${name} : ${sumMin(race)} min pour ${race.targetMin} visés`);
  }
  // Course en milieu de semaine : pas la place pour un rappel
  const { race } = prep(PROFILES.toi, 3);
  assert.equal(race.sessions.filter((s) => s.role !== 'race' && hard(s)).length, 0);
  assert.ok(race.sessions.some((s) => s.kind === 'activation'));
});

test('livre : renforcement conseillé selon la phase, et fiches du manuel', () => {
  const { profile, taper, race } = prep(PROFILES.six);
  const weeks = previewWeeks(profile, { startDate: START, weeks: {} }, { today: START }, START, 15);
  const by = (f) => weeks.find(f);
  assert.match(strengthNote(by((w) => w.info.phase === 'fondations' && !w.info.isRecovery)), /Deux séances/);
  assert.match(strengthNote(by((w) => w.info.phase === 'developpement' && !w.info.isRecovery)), /Une à deux séances/);
  assert.match(strengthNote(by((w) => w.info.phase === 'specifique' && !w.info.isRecovery)), /entretien/);
  assert.match(strengthNote(by((w) => w.info.isRecovery)), /légère/);
  assert.match(strengthNote(taper), /courte et légère/);
  assert.match(strengthNote(race), /Pas de renforcement/);
  assert.match(strengthNote(weeks[14]), /Pas de charges/);
  assert.match(strengthNote({ ...weeks[0], relief: START }), /fatigue/);
  const items = explainWeek(profile, { startDate: START, weeks: {} }, weeks[0], START);
  assert.ok(items.some((x) => x.title === 'Hors du vélo' && /squat/.test(x.text)));
  assert.match(PHASE_WHY.affutage, /ni l’intensité ni le nombre de séances/);

  assert.equal(ARTICLES.length, 15);
  const renfo = ARTICLES.find((a) => a.id === 'renfo');
  assert.ok(renfo && renfo.blocks.length >= 6);
  assert.ok(ARTICLES.every((a) => a.sources?.length >= 1 && a.title && a.tagline));
  assert.ok(ARTICLES.filter((a) => a.sources.some((s) => s.includes('Science of Cycling'))).length >= 5);
});
