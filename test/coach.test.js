import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addDays, dayIndex } from '../public/engine/dates.js';
import { generateWeek, manualSession, insertSession, removeSession, lightenSession } from '../public/engine/plan.js';
import { runCoach, undoEntry, canUndo, pendingNotices, markSeen, note, isPinned } from '../public/engine/coach.js';

const MONDAY = '2026-11-16';
const day = (i) => addDays(MONDAY, i);
const profile = {
  name: 'Test', level: 'intermediaire', split: 1, hoursNow: 6, indoor: 'jamais',
  avail: [60, 75, 60, 75, 0, 90, 180], refs: {},
};

/** Un plan neuf dont la semaine en cours est générée le lundi. */
function fresh(p = profile) {
  const plan = { startDate: MONDAY, weeks: {} };
  plan.weeks[MONDAY] = generateWeek(p, plan, MONDAY, { today: MONDAY });
  return plan;
}
const env = (today, extra = {}) => ({ today, activities: [], checkins: {}, level: 'vert', reasons: [], ...extra });
const shape = (plan, ws = MONDAY) => plan.weeks[ws].sessions.map((s) => `${dayIndex(s.date)}:${s.kind}:${s.durationMin}:${s.status}`).join(' ');
const totalLoad = (plan, ws = MONDAY) => plan.weeks[ws].sessions.filter((s) => s.status !== 'skipped').reduce((t, s) => t + s.load, 0);
const noHardPair = (week) => {
  const hard = new Set(week.sessions.filter((s) => s.status !== 'skipped' && (s.hard >= 2 || s.role === 'key')).map((s) => dayIndex(s.date)));
  for (const d of hard) assert.ok(!hard.has(d + 1), `deux jours durs de suite (${d} et ${d + 1})`);
};
const act = (id, date, minutes, load, extra = {}) => ({ id, date, sport: 'bike', durationSec: minutes * 60, load, ...extra });

test('coach : sans rien de neuf, il ne touche à rien (et le redire ne change rien)', () => {
  const plan = fresh();
  const before = shape(plan);
  assert.equal(runCoach(profile, plan, env(MONDAY)), false);
  assert.equal(shape(plan), before);
  assert.equal(plan.journal.length, 0);
  // La semaine type de ce profil : de quoi tester la suite
  const week = plan.weeks[MONDAY];
  assert.ok(week.sessions.filter((s) => s.role === 'key').length >= 2, shape(plan));
  assert.ok(week.sessions.some((s) => s.role === 'easy' || s.role === 'recup'), shape(plan));
  assert.ok(week.loadPlan > 0);
});

test('coach : fatigué le jour d’une séance dure → reportée, et annulé si le ressenti est corrigé', () => {
  const plan = fresh();
  const key = plan.weeks[MONDAY].sessions.find((s) => s.role === 'key');
  const today = key.date;
  const before = shape(plan);
  const tired = env(today, { level: 'orange', reasons: ['Tu te sens fatigué.'], checkins: { [today]: { feel: 2 } } });
  assert.equal(runCoach(profile, plan, tired), true);
  const week = plan.weeks[MONDAY];
  // Aujourd'hui : plus rien de dur
  assert.ok(week.sessions.filter((s) => s.date === today).every((s) => s.hard < 2 && s.role !== 'key'), shape(plan));
  // La séance clé existe toujours, plus tard dans la semaine, loin des autres séances dures
  const moved = week.sessions.find((s) => s.kind === key.kind && s.auto?.rule === 'fatigue');
  assert.ok(moved && moved.date > today, shape(plan));
  noHardPair(week);
  const entry = plan.journal.find((e) => e.rule === 'fatigue');
  assert.ok(entry && !entry.seen && entry.why.includes('fatigué') && entry.changes.length >= 1);
  assert.equal(pendingNotices(plan).length, 1);
  // Relancer le coach ne change rien
  assert.equal(runCoach(profile, plan, tired), false);
  // Le ressenti est corrigé (« Bien ») : tout revient comme avant, et le journal oublie
  assert.equal(runCoach(profile, plan, env(today, { checkins: { [today]: { feel: 4 } } })), true);
  assert.equal(shape(plan), before);
  assert.equal(plan.journal.length, 0);
  assert.ok(plan.weeks[MONDAY].sessions.every((s) => !s.auto));
});

test('coach : feu rouge → décrassage ; malade → repos complet ; « Rétablir » remet la séance et le coach n’insiste pas', () => {
  const plan = fresh();
  const long = plan.weeks[MONDAY].sessions.find((s) => s.role === 'long');
  const today = long.date;
  const red = env(today, { level: 'rouge', reasons: ['Tu te sens cuit ce matin.'], checkins: { [today]: { feel: 1 } } });
  runCoach(profile, plan, red);
  let s = plan.weeks[MONDAY].sessions.find((x) => x.date === today);
  assert.equal(s.kind, 'recup');
  assert.ok(s.durationMin <= 40);
  assert.equal(s.auto.prev.kind, 'long');
  // Malade : la séance est annulée
  const sick = env(today, { level: 'rouge', reasons: ['Malade ou blessé.'], checkins: { [today]: { feel: 2, sick: true } } });
  runCoach(profile, plan, sick);
  s = plan.weeks[MONDAY].sessions.find((x) => x.date === today);
  assert.equal(s.status, 'skipped');
  const entry = plan.journal.find((e) => e.rule === 'fatigue');
  assert.match(entry.title, /malade/);
  // Rétablir
  assert.equal(canUndo(plan, entry, today), true);
  assert.equal(undoEntry(plan, entry.key, today), true);
  s = plan.weeks[MONDAY].sessions.find((x) => x.date === today);
  assert.equal(s.kind, 'long');
  assert.equal(s.status, 'planned');
  assert.equal(s.keepAsIs, true);
  assert.equal(entry.undone, true);
  // Le coach ne refait pas ce qu'on vient d'annuler
  assert.equal(runCoach(profile, plan, sick), false);
  assert.equal(plan.weeks[MONDAY].sessions.find((x) => x.date === today).kind, 'long');
});

test('coach : une séance réglée à la main ou ajoutée par l’utilisateur n’est jamais modifiée', () => {
  const plan = fresh();
  const week = plan.weeks[MONDAY];
  const key = week.sessions.find((s) => s.role === 'key');
  key.keepAsIs = true;
  const today = key.date;
  assert.equal(isPinned(key), true);
  runCoach(profile, plan, env(today, { level: 'rouge', reasons: ['Cuit.'], checkins: { [today]: { feel: 1 } } }));
  assert.equal(plan.weeks[MONDAY].sessions.find((s) => s.date === today).kind, key.kind);
  assert.ok(!plan.journal.some((e) => e.rule === 'fatigue'));
});

test('coach : fatigue deux jours de suite → la fin de semaine devient allégée, et la suivante repart en douceur', () => {
  const plan = fresh();
  const tue = day(1);
  const wed = day(2);
  runCoach(profile, plan, env(tue, { level: 'orange', reasons: ['Tu te sens fatigué.'], checkins: { [tue]: { feel: 2 } } }));
  assert.ok(!plan.weeks[MONDAY].relief);
  const checkins = { [tue]: { feel: 2 }, [wed]: { feel: 2 } };
  runCoach(profile, plan, env(wed, { level: 'orange', reasons: ['Tu te sens fatigué.'], checkins }));
  const week = plan.weeks[MONDAY];
  assert.equal(week.relief, wed);
  const rest = week.sessions.filter((s) => s.date > wed && s.status === 'planned');
  assert.ok(rest.length > 0);
  assert.ok(rest.every((s) => s.hard < 2 && s.role !== 'key'), shape(plan));
  const long = rest.find((s) => s.role === 'long');
  assert.ok(long.durationMin < long.auto.prev.durationMin);
  const entry = plan.journal.find((e) => e.rule === 'relief');
  assert.ok(entry && entry.why.includes('2 jours'));
  // Stable
  assert.equal(runCoach(profile, plan, env(wed, { level: 'orange', reasons: ['Tu te sens fatigué.'], checkins })), false);
  // Semaine suivante : pas de montée en charge (multiplicateur de base), et c'est dit
  const next = generateWeek(profile, plan, day(7), { today: day(7) });
  assert.equal(next.eased, 'fatigue');
  assert.equal(next.targetMin, Math.round(next.refMin / 5) * 5);
  // Ressenti corrigé le jour même : la semaine redevient normale
  runCoach(profile, plan, env(wed, { checkins: { [tue]: { feel: 2 }, [wed]: { feel: 4 } } }));
  assert.ok(!plan.weeks[MONDAY].relief);
  assert.ok(!plan.journal.some((e) => e.rule === 'relief'));
});

test('coach : séance clé manquée → déplacée à la place d’une séance facile, une seule fois', () => {
  const plan = fresh();
  const week = plan.weeks[MONDAY];
  const key = week.sessions.find((s) => s.role === 'key');
  const today = addDays(key.date, 1);
  assert.equal(runCoach(profile, plan, env(today)), true);
  const w = plan.weeks[MONDAY];
  const moved = w.sessions.find((s) => s.auto?.rule === 'missed' && s.kind === key.kind);
  assert.ok(moved && moved.date >= today && moved.status === 'planned', shape(plan));
  assert.equal(w.sessions.filter((s) => s.date === key.date && s.status === 'planned').length, 0);
  noHardPair(w);
  const entry = plan.journal.find((e) => e.rule === 'missed');
  assert.ok(entry.why.includes('séance clé'));
  assert.equal(canUndo(plan, entry, today), false);
  assert.equal(runCoach(profile, plan, env(today)), false);
  // Manquée une seconde fois : on ne court pas après
  const later = addDays(moved.date, 1);
  if (dayIndex(later) > dayIndex(moved.date)) {
    runCoach(profile, plan, env(later));
    assert.equal(plan.journal.filter((e) => e.rule === 'missed' && e.key.includes(key.kind)).length, 1);
  }
});

test('coach : séance dure ajoutée la veille d’une séance clé → la séance clé change de jour ; retirée → retour en arrière', () => {
  const plan = fresh();
  const week = plan.weeks[MONDAY];
  const keys = week.sessions.filter((s) => s.role === 'key');
  const key = keys[keys.length - 1];
  const before = shape(plan);
  const eve = addDays(key.date, -1);
  const others = week.sessions.filter((s) => s.date === eve);
  const mine = manualSession(profile, week, { date: eve, sport: 'bike', kind: 'seuil', minutes: 60 }, others);
  plan.weeks[MONDAY] = insertSession(week, mine, others[0]?.id ?? null);
  const shapeWithMine = shape(plan);
  assert.equal(runCoach(profile, plan, env(MONDAY)), true);
  const w = plan.weeks[MONDAY];
  // La séance ajoutée n'a pas bougé
  const kept = w.sessions.find((s) => s.id === mine.id);
  assert.equal(kept.date, eve);
  assert.ok(!kept.auto);
  noHardPair(w);
  const entry = plan.journal.find((e) => e.rule === 'clash');
  assert.ok(entry, shape(plan));
  assert.ok(entry.why.includes('Tu as ajouté'));
  assert.equal(runCoach(profile, plan, env(MONDAY)), false);
  // On retire la séance ajoutée : la séance clé retrouve sa place
  plan.weeks[MONDAY] = removeSession(plan.weeks[MONDAY], mine.id);
  runCoach(profile, plan, env(MONDAY));
  assert.ok(!plan.journal.some((e) => e.rule === 'clash'));
  assert.ok(plan.weeks[MONDAY].sessions.every((s) => !s.auto), shape(plan));
  assert.notEqual(shape(plan), shapeWithMine);
  if (!others.length) assert.equal(shape(plan), before);
});

test('coach : séance ajoutée en plus → du volume facile est retiré pour garder la charge de la semaine', () => {
  const plan = fresh();
  const week = plan.weeks[MONDAY];
  const planned = week.loadPlan;
  const before = shape(plan);
  // Un jour sans séance, loin des séances clés si possible
  const taken = new Set(week.sessions.map((s) => dayIndex(s.date)));
  const hard = new Set(week.sessions.filter((s) => s.role === 'key' || s.role === 'long').map((s) => dayIndex(s.date)));
  const free = [0, 1, 2, 3, 4, 5, 6].filter((d) => !taken.has(d));
  const d = free.find((x) => !hard.has(x - 1) && !hard.has(x + 1)) ?? free[0];
  const mine = manualSession(profile, week, { date: day(d), sport: 'bike', kind: 'endurance', minutes: 120 }, []);
  plan.weeks[MONDAY] = insertSession(week, mine);
  const withMine = totalLoad(plan);
  assert.ok(withMine > planned * 1.3, `la séance ajoutée doit peser (${planned} → ${withMine})`);
  assert.equal(runCoach(profile, plan, env(MONDAY)), true);
  const entry = plan.journal.find((e) => e.rule === 'balance');
  assert.ok(entry, shape(plan));
  assert.match(entry.title, /rééquilibrée/);
  assert.ok(entry.changes.length >= 1);
  const after = totalLoad(plan);
  assert.ok(after < withMine, `${withMine} → ${after}`);
  // Les séances clés ne sont pas touchées par un simple ajout d'endurance
  const w = plan.weeks[MONDAY];
  assert.equal(w.sessions.filter((s) => s.role === 'key').length, week.sessions.filter((s) => s.role === 'key').length);
  assert.ok(!w.sessions.find((s) => s.id === mine.id).auto);
  // Stable d'un jour à l'autre tant que rien de neuf n'arrive
  assert.equal(runCoach(profile, plan, env(MONDAY)), false);
  // Le lendemain, la séance du lundi faite comme prévu : la décision d'hier ne bouge plus
  const monday = w.sessions.filter((s) => s.date === MONDAY && s.status === 'planned');
  const doneActs = monday.map((s, i) => {
    s.status = 'done';
    s.activityId = `m${i}`;
    return act(`m${i}`, s.date, s.durationMin, s.load + 8);
  });
  const settled = shape(plan);
  assert.equal(runCoach(profile, plan, env(day(1), { activities: doneActs })), false);
  assert.equal(shape(plan), settled);
  // « Rétablir » : tout revient, et le coach ne recommence pas
  assert.equal(undoEntry(plan, entry.key, MONDAY), true);
  assert.equal(totalLoad(plan), withMine);
  runCoach(profile, plan, env(MONDAY));
  assert.equal(totalLoad(plan), withMine);
  // La séance ajoutée est retirée : plus rien à rééquilibrer
  const plan2 = fresh();
  plan2.weeks[MONDAY] = insertSession(plan2.weeks[MONDAY], mine);
  runCoach(profile, plan2, env(MONDAY));
  plan2.weeks[MONDAY] = removeSession(plan2.weeks[MONDAY], mine.id);
  runCoach(profile, plan2, env(MONDAY));
  assert.equal(shape(plan2), before);
  assert.equal(plan2.journal.length, 0);
});

test('coach : grosse sortie imprévue → la séance clé du lendemain bouge et le reste s’allège ; une séance manquée compense', () => {
  const plan = fresh();
  const week = plan.weeks[MONDAY];
  const key = week.sessions.filter((s) => s.role === 'key').pop();
  const eve = addDays(key.date, -1);
  const planned = week.loadPlan;
  // La veille de la séance clé : 2 h soutenues en sortie libre, dans l'autre sport (donc non reliée au plan)
  const ride = act('strava:1', eve, 120, 170, { sport: 'run', name: 'Sortie trail' });
  const done = week.sessions.filter((s) => s.date < eve).map((s, i) => {
    s.status = 'done';
    s.activityId = `a${i}`;
    return act(`a${i}`, s.date, s.durationMin, s.load);
  });
  assert.equal(runCoach(profile, plan, env(eve, { activities: [...done, ride] })), true);
  const w = plan.weeks[MONDAY];
  noHardPair(w);
  const clash = plan.journal.find((e) => e.rule === 'clash');
  assert.ok(clash && clash.why.includes('imprévue'), JSON.stringify(plan.journal.map((e) => e.title)));
  const bal = plan.journal.find((e) => e.rule === 'balance');
  assert.ok(bal, 'la semaine doit être rééquilibrée');
  const projected = [...done, ride].reduce((t, a) => t + a.load, 0) + w.sessions.filter((s) => s.status === 'planned' && s.date >= eve).reduce((t, s) => t + s.load, 0);
  assert.ok(projected < planned + 170, `charge projetée ${projected} pour ${planned} prévus`);

  // Même sortie, mais la séance prévue ce jour-là et une autre ont été sautées : rien à retirer
  const plan2 = fresh();
  const w2 = plan2.weeks[MONDAY];
  const small = act('strava:2', day(6), 60, 55, { sport: 'run', name: 'Footing' });
  const all = w2.sessions.filter((s) => s.date < day(6)).slice(1).map((s, i) => {
    s.status = 'done';
    s.activityId = `b${i}`;
    return act(`b${i}`, s.date, s.durationMin, s.load);
  });
  runCoach(profile, plan2, env(day(6), { activities: [...all, small] }));
  assert.ok(!plan2.journal.some((e) => e.rule === 'balance'));
});

test('coach : en début de semaine, la semaine préparée à l’avance est recalculée d’après le réel', () => {
  const plan = fresh();
  const next = day(7);
  // Semaine suivante regardée (donc enregistrée) le samedi, en supposant que tout serait fait
  plan.weeks[next] = generateWeek(profile, plan, next, { today: day(5) });
  const before = plan.weeks[next].targetMin;
  assert.ok(before > plan.weeks[MONDAY].targetMin);
  // En réalité, la semaine a été presque blanche
  const ctx = { today: next, weekActual: (ws) => (ws === MONDAY ? { min: 40, load: 30, count: 1 } : null) };
  assert.equal(runCoach(profile, plan, env(next, { ctx })), true);
  const week = plan.weeks[next];
  assert.equal(week.eased, true);
  assert.ok(week.targetMin < before);
  assert.equal(week.madeOn, next);
  const entry = plan.journal.find((e) => e.rule === 'refresh');
  assert.ok(entry.why.includes('presque blanche'));
  assert.equal(runCoach(profile, plan, env(next, { ctx })), false);

  // Si tout a été fait comme prévu, rien ne bouge et rien n'est signalé
  const plan2 = fresh();
  plan2.weeks[next] = generateWeek(profile, plan2, next, { today: day(5) });
  const same = shape(plan2, next);
  const ok = { today: next, weekActual: (ws) => (ws === MONDAY ? { min: plan2.weeks[MONDAY].targetMin, load: 300, count: 5 } : null) };
  runCoach(profile, plan2, env(next, { ctx: ok }));
  assert.equal(shape(plan2, next), same);
  assert.equal(plan2.journal.length, 0);

  // Une semaine déjà réglée à la main n'est pas recalculée
  const plan3 = fresh();
  plan3.weeks[next] = generateWeek(profile, plan3, next, { today: day(5) });
  const k = plan3.weeks[next].sessions.find((s) => s.role === 'key');
  plan3.weeks[next].sessions = plan3.weeks[next].sessions.map((s) => (s === k ? lightenSession(s, 'facile') : s));
  const tuned = shape(plan3, next);
  runCoach(profile, plan3, env(next, { ctx }));
  assert.equal(shape(plan3, next), tuned);
});

test('journal : notes, « vu », et taille bornée', () => {
  const plan = fresh();
  note(plan, MONDAY, { rule: 'profil', title: 'Objectifs modifiés', why: 'Parce que.', changes: ['a'] });
  assert.equal(plan.journal.length, 1);
  assert.equal(pendingNotices(plan).length, 0);
  plan.journal[0].seen = false;
  assert.equal(pendingNotices(plan).length, 1);
  assert.equal(markSeen(plan), true);
  assert.equal(markSeen(plan), false);
  for (let i = 0; i < 100; i++) note(plan, MONDAY, { rule: 'replan', title: `n${i}`, why: '' });
  assert.ok(plan.journal.length <= 60);
  // Les vieilles entrées finissent par disparaître
  runCoach(profile, plan, env(addDays(MONDAY, 120)));
  assert.equal(plan.journal.length, 0);
});
