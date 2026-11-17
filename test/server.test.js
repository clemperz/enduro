import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeFit } from './helpers.js';
import { mapStravaActivity, authorizeUrl } from '../server/strava.js';
import { upsertActivity, sanitizeActivity, upgradeLoads } from '../server/activities.js';
import { buildSession } from '../public/engine/workouts.js';
import { resolveRefs } from '../public/engine/zones.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 5600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
let tmp;
let child;

const api = async (method, path, body, headers = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'enduro', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'enduro-test-'));
  mkdirSync(join(tmp, 'zwift', 'Workouts', '424242'), { recursive: true });
  mkdirSync(join(tmp, 'zwift', 'Activities'), { recursive: true });
  // Une sortie de 20 min à 200 W, une trop courte, et l'activité en cours (à ignorer).
  const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 86400 - 631065600; // horloge FIT : secondes depuis le 31/12/1989
  const ride = makeFit(Array.from({ length: 1200 }, () => ({ power: 200, hr: 150 })), { start: twoDaysAgo });
  writeFileSync(join(tmp, 'zwift', 'Activities', '2026-11-14-10-00-00.fit'), ride);
  writeFileSync(join(tmp, 'zwift', 'Activities', '2026-11-14-11-00-00.fit'), makeFit(Array.from({ length: 30 }, () => ({ power: 100 }))));
  writeFileSync(join(tmp, 'zwift', 'Activities', 'inProgressActivity.fit'), ride);
  writeFileSync(join(tmp, 'zwift', 'Activities', 'casse.fit'), Buffer.from('pas un fichier fit, vraiment pas'));
  child = spawn(process.execPath, ['server.js', '--port', String(PORT), '--data', join(tmp, 'data'), '--zwift', join(tmp, 'zwift')], { cwd: ROOT });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('Enduro est prêt')) resolve(); });
    child.stderr.on('data', (d) => reject(new Error(String(d))));
    child.on('exit', (code) => reject(new Error(`serveur arrêté (${code})`)));
  });
});

after(() => {
  child?.kill();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test('serveur : pages et état initial', async () => {
  const page = await fetch(BASE + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const js = await fetch(BASE + '/engine/plan.js');
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(BASE + '/../server.js')).status, 404);
  // Tentative de sortie du dossier public (le « / » encodé échappe à la normalisation du navigateur)
  assert.equal((await fetch(BASE + '/..%2Fserver.js')).status, 403);
  assert.equal((await fetch(BASE + '/js/..%2F..%2Fdata%2Fsecrets.json')).status, 403);
  const { status, json } = await api('GET', '/api/state');
  assert.equal(status, 200);
  assert.equal(json.profile, null);
  assert.deepEqual(json.activities, []);
  assert.deepEqual(json.zwift, { found: true, canExport: true, userId: '424242', activityFiles: 3 });
  assert.deepEqual(json.strava, { configured: false, connected: false, athlete: null, lastSync: null });
});

test('serveur : refuse les requêtes venues d’ailleurs', async () => {
  const noHeader = await fetch(BASE + '/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(noHeader.status, 403);
  const foreign = await api('PUT', '/api/profile', { a: 1 }, { Origin: 'https://exemple.com' });
  assert.equal(foreign.status, 403);
  // Nom d'hôte inattendu (attaque par « DNS rebinding »)
  const viaLocalhost = await fetch(`http://localhost:${PORT}/api/state`).catch(() => null);
  if (viaLocalhost) assert.equal(viaLocalhost.status, 200);
  assert.equal((await api('POST', '/api/inconnu', {})).status, 404);
  assert.equal((await api('POST', '/api/reset', {})).status, 400);
});

test('serveur : profil, activités, ressenti, import Zwift, export Zwift', async () => {
  const profile = { name: 'Test', level: 'intermediaire', split: 0.6, avail: [60, 0, 60, 0, 60, 120, 180], refs: {}, goal: { type: 'forme' } };
  assert.equal((await api('PUT', '/api/profile', profile)).status, 200);
  assert.equal((await api('PUT', '/api/profile', [1])).status, 400);

  // Import Zwift avant de connaître la FTP : charge par défaut
  const imp = await api('POST', '/api/zwift/import');
  assert.equal(imp.json.added, 1);
  assert.equal(imp.json.errors.length, 1);
  assert.equal(imp.json.errors[0].file, 'casse.fit');
  const ride = imp.json.activities[0];
  assert.equal(ride.id, 'zwift:2026-11-14-10-00-00');
  assert.equal(ride.durationSec, 1200);
  assert.equal(ride.np, 200);
  assert.equal(ride.best[300], 200);
  // Aucun repère saisi : la FTP est estimée d'après la sortie elle-même (95 % des 20 min à 200 W = 190 W)
  assert.equal(ride.loadMethod, 'power');
  assert.equal(ride.loadEst, true);
  assert.equal(ride.load, 37);
  // Second import : rien de nouveau (la sortie trop courte reste ignorée)
  const again = await api('POST', '/api/zwift/import');
  assert.equal(again.json.added + again.json.updated + again.json.merged, 0);

  // On renseigne la FTP : la charge passe en « puissance » (20 min à la FTP = 33 points)
  const up = await api('PUT', '/api/profile', { ...profile, refs: { ftp: 200 } });
  const upgraded = up.json.activities[0];
  assert.equal(upgraded.loadMethod, 'power');
  assert.equal(upgraded.load, 33);
  assert.equal(upgraded.loadEst, undefined); // la vraie valeur a remplacé l'estimation

  // Saisie manuelle + ressenti
  const manual = await api('POST', '/api/activities', { sport: 'run', date: '2026-11-15', durationSec: 2700, rpe: 3, name: 'Footing' });
  assert.equal(manual.status, 200);
  assert.equal(manual.json.activity.load, 30);
  assert.equal(manual.json.activity.loadMethod, 'rpe');
  assert.equal(manual.json.activity.source, 'manual');
  const id = encodeURIComponent(manual.json.activity.id);
  const patched = await api('PATCH', `/api/activities/${id}`, { rpe: 6, note: 'Dur dur' });
  assert.equal(patched.json.activity.load, 53);
  assert.equal(patched.json.activity.note, 'Dur dur');
  assert.equal((await api('POST', '/api/activities', { sport: 'run', date: 'hier', durationSec: 10 })).status, 400);
  assert.equal((await api('PATCH', '/api/activities/inconnue', { rpe: 2 })).status, 404);

  // Ressenti du matin
  const ck = await api('PUT', '/api/checkins/2026-11-15', { feel: 4 });
  assert.deepEqual(ck.json.checkins['2026-11-15'], { feel: 4, sick: false });
  assert.equal((await api('PUT', '/api/checkins/2026-11-15', { feel: 9 })).status, 400);

  // Export vers Zwift
  const session = { ...buildSession({ sport: 'bike', kind: 'seuil', minutes: 60, step: 1 }), id: 's1', date: '2026-11-17' };
  const exp = await api('POST', '/api/zwift/export', { sessions: [session] });
  assert.equal(exp.status, 200);
  assert.deepEqual(exp.json.files, [{ sessionId: 's1', fileName: 'enduro-2-mar.zwo' }]);
  const written = readFileSync(join(tmp, 'zwift', 'Workouts', '424242', 'enduro-2-mar.zwo'), 'utf8');
  assert.match(written, /<name>Enduro Mar 17-11 Seuil 3 x 8 min<\/name>/);
  assert.deepEqual(readdirSync(join(tmp, 'zwift', 'Workouts', '424242')), ['enduro-2-mar.zwo']);
  // Deuxième séance vélo ajoutée à la main le même jour : son propre fichier, le premier reste intact
  const extra = { ...buildSession({ sport: 'bike', kind: 'recup', minutes: 30 }), id: 's3', date: '2026-11-17', zwoSlot: 2 };
  assert.deepEqual((await api('POST', '/api/zwift/export', { sessions: [extra] })).json.files, [{ sessionId: 's3', fileName: 'enduro-2-mar-2.zwo' }]);
  assert.deepEqual(readdirSync(join(tmp, 'zwift', 'Workouts', '424242')).sort(), ['enduro-2-mar-2.zwo', 'enduro-2-mar.zwo']);
  // Un numéro farfelu ne permet pas d'écrire n'importe quel fichier
  assert.deepEqual((await api('POST', '/api/zwift/export', { sessions: [{ ...extra, zwoSlot: '../x' }] })).json.files, [{ sessionId: 's3', fileName: 'enduro-2-mar.zwo' }]);
  assert.match(readFileSync(join(tmp, 'zwift', 'Workouts', '424242', 'enduro-2-mar.zwo'), 'utf8'), /Decrassage/);
  // Retrait d'une séance supplémentaire : seul son fichier part, et seulement les fichiers « -2 / -3 »
  assert.deepEqual((await api('DELETE', '/api/zwift/workouts/enduro-2-mar-2.zwo')).json, { removed: true });
  assert.deepEqual(readdirSync(join(tmp, 'zwift', 'Workouts', '424242')), ['enduro-2-mar.zwo']);
  assert.equal((await api('DELETE', '/api/zwift/workouts/enduro-2-mar.zwo')).status, 400);
  assert.equal((await api('DELETE', '/api/zwift/workouts/workouts.files')).status, 400);
  assert.equal((await api('DELETE', '/api/zwift/workouts/..%2F..%2Fdata')).status, 404);
  const run = { ...buildSession({ sport: 'run', kind: 'endurance', minutes: 40 }), id: 's2', date: '2026-11-18' };
  assert.equal((await api('POST', '/api/zwift/export', { sessions: [run] })).status, 400);

  // Suppression : la sortie Zwift ne revient pas à l'import suivant
  assert.equal((await api('DELETE', `/api/activities/${encodeURIComponent(ride.id)}`)).status, 200);
  const third = await api('POST', '/api/zwift/import');
  assert.equal(third.json.added, 0);
  assert.equal(third.json.activities.length, 1);

  // Tout est bien enregistré sur disque, et les secrets sont à part
  const saved = JSON.parse(readFileSync(join(tmp, 'data', 'enduro.json'), 'utf8'));
  assert.equal(saved.profile.refs.ftp, 200);
  assert.equal(saved.activities.length, 1);
  assert.equal(existsSync(join(tmp, 'data', 'secrets.json')), false);
});

test('serveur : Strava se configure sans jamais renvoyer le secret', async () => {
  assert.equal((await api('POST', '/api/strava/config', { clientId: 'abc', clientSecret: 'x' })).status, 400);
  const ok = await api('POST', '/api/strava/config', { clientId: '12345', clientSecret: 'a'.repeat(40) });
  assert.deepEqual(ok.json.strava, { configured: true, connected: false, athlete: null, lastSync: null });
  const state = await api('GET', '/api/state');
  assert.ok(!JSON.stringify(state.json).includes('a'.repeat(40)));
  const login = await fetch(BASE + '/api/strava/login', { redirect: 'manual' });
  assert.equal(login.status, 302);
  const loc = new URL(login.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://www.strava.com/oauth/authorize');
  assert.equal(loc.searchParams.get('scope'), 'activity:read_all');
  assert.equal(loc.searchParams.get('redirect_uri'), `http://localhost:${PORT}/api/strava/callback`);
  // Retour avec un « state » inconnu : refusé
  const cb = await fetch(BASE + '/api/strava/callback?code=x&state=faux&scope=activity:read_all', { redirect: 'manual' });
  assert.equal(cb.headers.get('location'), '/#/profil?strava=expire');
  assert.equal((await api('POST', '/api/strava/sync')).status, 409);
  const off = await api('POST', '/api/strava/disconnect', { forget: true });
  assert.equal(off.json.strava.configured, false);
});

test('Strava : conversion d’une activité', () => {
  const a = mapStravaActivity({
    id: 99, name: 'Sortie du dimanche', sport_type: 'Ride', start_date: '2026-11-15T08:30:00Z', start_date_local: '2026-11-15T09:30:00Z',
    moving_time: 7200, elapsed_time: 7500, distance: 56780, total_elevation_gain: 812.4, average_watts: 165.3,
    weighted_average_watts: 182, device_watts: true, max_watts: 640, average_heartrate: 141.6, max_heartrate: 176, has_heartrate: true, trainer: false,
  });
  assert.deepEqual(a, {
    id: 'strava:99', stravaId: 99, source: 'strava', sport: 'bike', indoor: false, name: 'Sortie du dimanche',
    start: '2026-11-15T09:30:00', date: '2026-11-15', startEpoch: 1794731400, durationSec: 7200, distanceKm: 56.78,
    elevationM: 812, avgPower: 165, np: 182, maxPower: 640, avgHr: 142, maxHr: 176, avgCadence: null,
  });
  // Puissance estimée par Strava (sans capteur) : ignorée
  const est = mapStravaActivity({ id: 1, sport_type: 'TrailRun', start_date_local: '2026-11-14T18:00:00Z', moving_time: 3000, average_watts: 250, device_watts: false });
  assert.equal(est.sport, 'run');
  assert.equal(est.avgPower, null);
  assert.equal(mapStravaActivity({ id: 2, sport_type: 'VirtualRide', start_date_local: '2026-11-14T18:00:00Z', moving_time: 3000 }).indoor, true);
  assert.equal(mapStravaActivity({ id: 3, sport_type: 'Swim', start_date_local: '2026-11-14T18:00:00Z', moving_time: 3000 }).sport, 'other');
  assert.match(authorizeUrl('123', 'http://localhost:5180/api/strava/callback', 'abc'), /client_id=123&response_type=code/);
});

test('activités : fusion des doublons Zwift / Strava / saisie manuelle', () => {
  const profile = resolveRefs({ refs: { ftp: 200 } }, 2026);
  const list = [];
  const zwift = sanitizeActivity({
    id: 'zwift:2026-11-13-13-50-01', source: 'zwift', sport: 'bike', date: '2026-11-13', start: '2026-11-13T13:50:24',
    startEpoch: 1794574224, durationSec: 3244, np: 213, avgPower: 180, best: { 300: 224 },
  });
  assert.equal(upsertActivity(list, zwift, profile), 'added');
  assert.equal(list[0].loadMethod, 'power');
  list[0].rpe = 6;
  // La même sortie arrive par Strava 30 s plus tard : fusion, on garde le détail Zwift et le nom Strava
  const strava = mapStravaActivity({
    id: 77, name: 'Watopia', sport_type: 'VirtualRide', start_date: new Date((1794574224 + 30) * 1000).toISOString(),
    start_date_local: '2026-11-13T13:50:54Z', moving_time: 3240, average_watts: 181, weighted_average_watts: 212, device_watts: true,
  });
  assert.equal(upsertActivity(list, strava, profile), 'merged');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'zwift:2026-11-13-13-50-01');
  assert.equal(list[0].name, 'Watopia');
  assert.equal(list[0].stravaId, 77);
  assert.equal(list[0].np, 213);
  assert.equal(list[0].rpe, 6);
  assert.deepEqual(list[0].best, { 300: 224 });
  // Nouvelle synchro Strava : simple mise à jour, toujours une seule activité
  assert.equal(upsertActivity(list, { ...strava, name: 'Watopia (renommée)' }, profile), 'updated');
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Watopia (renommée)');
  assert.equal(list[0].np, 213);
  assert.equal(list[0].rpe, 6);

  // « C'est fait » saisi à la main, puis la vraie activité arrive : elle remplace la saisie en gardant le ressenti
  list.push({ ...sanitizeActivity({ source: 'manual', sport: 'run', date: '2026-11-14', durationSec: 2400, rpe: 4, note: 'Bien' }), load: 33, loadMethod: 'rpe' });
  const run = mapStravaActivity({ id: 78, name: 'Footing', sport_type: 'Run', start_date: '2026-11-14T17:00:00Z', start_date_local: '2026-11-14T18:00:00Z', moving_time: 2520, distance: 7000 });
  assert.equal(upsertActivity(list, run, profile), 'added');
  assert.equal(list.length, 2);
  assert.equal(list[1].id, 'strava:78');
  assert.equal(list[1].rpe, 4);
  assert.equal(list[1].note, 'Bien');
  assert.equal(list[1].loadMethod, 'rpe');
  assert.equal(list[1].load, 35);

  // Deux sorties Zwift courtes et rapprochées (8 min d'écart) restent deux sorties distinctes
  const a1 = sanitizeActivity({ id: 'zwift:a1', source: 'zwift', sport: 'bike', date: '2026-11-12', startEpoch: 1794495389, durationSec: 421, np: 142 });
  const a2 = sanitizeActivity({ id: 'zwift:a2', source: 'zwift', sport: 'bike', date: '2026-11-12', startEpoch: 1794495888, durationSec: 978, np: 109 });
  assert.equal(upsertActivity(list, a1, profile), 'added');
  assert.equal(upsertActivity(list, a2, profile), 'added');
  assert.equal(list.length, 4);
  // Une autre activité Strava ne peut pas se fondre dans une sortie qui a déjà sa version Strava
  const other = mapStravaActivity({ id: 80, name: 'Autre', sport_type: 'Ride', start_date: new Date(1794574224 * 1000).toISOString(), start_date_local: '2026-11-13T13:50:24Z', moving_time: 600 });
  assert.equal(upsertActivity(list, other, profile), 'added');
  assert.equal(list.length, 5);
  list.pop();

  // Changement de FTP : les charges déjà mesurées à la puissance ne sont pas réécrites
  const before = list[0].load;
  assert.equal(upgradeLoads(list, resolveRefs({ refs: { ftp: 300 } }, 2026)), 0);
  assert.equal(list[0].load, before);
  assert.equal(sanitizeActivity({ sport: 'bike', date: '2026-11-14' }), null);
  assert.equal(sanitizeActivity({ sport: 'vélo', date: '2026-11-14', durationSec: 60 }).sport, 'other');
});

test('serveur : sauvegarde téléchargée puis restaurée (aller-retour avec le téléphone)', async () => {
  const exported = await fetch(BASE + '/api/export');
  assert.match(exported.headers.get('content-disposition'), /attachment; filename="enduro-\d{4}-\d{2}-\d{2}\.json"/);
  const backup = await exported.json();
  assert.equal((await api('POST', '/api/restore', { backup: { pas: 'une sauvegarde' } })).status, 400);
  const phone = { ...backup, profile: { ...backup.profile, name: 'Depuis le téléphone' }, checkins: { '2026-11-17': { feel: 2, sick: false } } };
  const restored = await api('POST', '/api/restore', { backup: phone });
  assert.equal(restored.status, 200);
  assert.equal(restored.json.profile.name, 'Depuis le téléphone');
  assert.equal(restored.json.server.mode, 'mac');
  // L'ancien carnet est gardé de côté avant d'être remplacé.
  assert.ok(readdirSync(join(tmp, 'data', 'sauvegardes')).some((f) => f.startsWith('avant-restauration-')));
  assert.equal(JSON.parse(readFileSync(join(tmp, 'data', 'enduro.json'), 'utf8')).profile.name, 'Depuis le téléphone');
  await api('POST', '/api/restore', { backup });
});

test('serveur : ECG du matin enregistré, contrôlé, retiré', async () => {
  const day = '2026-11-17';
  assert.equal((await api('PUT', `/api/ecg/${day}`, { rmssd: 'beaucoup', hr: 56 })).status, 400);
  assert.equal((await api('PUT', `/api/ecg/${day}`, { rmssd: 42.4, hr: 300 })).status, 400);
  const saved = await api('PUT', `/api/ecg/${day}`, {
    rmssd: 42.37, hr: 61.84, beats: 28, pairs: 22, rejected: 0, seconds: 30, at: null, file: 'ecg.pdf', extra: 'ignoré',
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.ecg[day], { rmssd: 42.4, hr: 61.8, beats: 28, pairs: 22, rejected: 0, seconds: 30, at: null, file: 'ecg.pdf' });
  assert.deepEqual((await api('GET', '/api/state')).json.ecg[day].rmssd, 42.4);
  const gone = await api('DELETE', `/api/ecg/${day}`);
  assert.deepEqual(gone.json.ecg, {});
});
