// Parcours complet Withings contre un faux serveur Withings : configuration,
// autorisation, échange du code, synchro des nuits (pages, détail, médiane),
// jeton renouvelé, limite de requêtes, adresse collée, déconnexion.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startFakeWithings } from './fake-withings.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 6100 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const CLIENT_ID = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';
const SECRET = 'f00dbabe' + 'deadbeef'.repeat(3);
let tmp;
let child;
let fake;

const api = async (method, path, body) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'enduro' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const get = (url) => fetch(url, { redirect: 'manual' });
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Enduro → faux Withings → retour : renvoie l'adresse de retour donnée par « Withings ». */
async function authorize() {
  const login = await get(`${BASE}/api/withings/login`);
  assert.equal(login.status, 302);
  const consent = await get(login.headers.get('location'));
  assert.equal(consent.status, 302);
  return consent.headers.get('location');
}

before(async () => {
  fake = await startFakeWithings();
  fake.requireSecret(SECRET);
  tmp = mkdtempSync(join(tmpdir(), 'enduro-withings-'));
  mkdirSync(join(tmp, 'zwift'), { recursive: true });
  child = spawn(process.execPath, ['server.js', '--port', String(PORT), '--data', join(tmp, 'data'), '--zwift', join(tmp, 'zwift')], {
    cwd: ROOT, env: { ...process.env, ENDURO_WITHINGS_ACCOUNT: fake.url, ENDURO_WITHINGS_API: fake.url },
  });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('Enduro est prêt')) resolve(); });
    child.stderr.on('data', (d) => { if (!/Withings, nuit/.test(String(d))) reject(new Error(String(d))); });
    child.on('exit', (code) => reject(new Error(`serveur arrêté (${code})`)));
  });
});

after(async () => {
  child?.kill();
  await fake?.close();
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

test('Withings : configuration, autorisation, première synchro', async () => {
  let { json } = await api('GET', '/api/state');
  assert.deepEqual(json.withings, {
    configured: false, connected: false, lastSync: null,
    redirectUri: `http://localhost:${PORT}/api/withings/callback`, customRedirect: false,
  });
  assert.deepEqual(json.nights, {});
  assert.equal((await api('POST', '/api/withings/sync', {})).status, 409);

  // Identifiants invalides refusés ; valides enregistrés, jamais renvoyés
  assert.equal((await api('POST', '/api/withings/config', { clientId: '12', clientSecret: SECRET })).status, 400);
  assert.equal((await api('POST', '/api/withings/config', { clientId: CLIENT_ID, clientSecret: SECRET, redirectUri: 'pas une adresse' })).status, 400);
  const saved = await api('POST', '/api/withings/config', { clientId: CLIENT_ID, clientSecret: SECRET });
  assert.equal(saved.json.withings.configured, true);
  assert.equal(saved.json.withings.connected, false);

  // Autorisation : le retour arrive sur Enduro (localhost), qui échange le code
  const back = await authorize();
  const cb = new URL(back);
  assert.equal(`${cb.origin}${cb.pathname}`, `http://localhost:${PORT}/api/withings/callback`);
  assert.match(cb.searchParams.get('state'), /^w[0-9a-f]{32}$/);
  const done = await get(back.replace('localhost', '127.0.0.1'));
  assert.equal(done.headers.get('location'), '/#/profil?withings=ok');
  // Le même retour rejoué ne passe plus
  assert.equal((await get(back.replace('localhost', '127.0.0.1'))).headers.get('location'), '/#/profil?withings=expire');
  // Un « state » inventé non plus
  const forged = new URL(back.replace('localhost', '127.0.0.1'));
  forged.searchParams.set('state', 'w' + '0'.repeat(32));
  assert.equal((await get(forged)).headers.get('location'), '/#/profil?withings=expire');

  ({ json } = await api('GET', '/api/state'));
  assert.equal(json.withings.connected, true);
  const raw = JSON.stringify(json);
  assert.ok(!raw.includes(SECRET), 'le secret ne doit jamais partir vers le navigateur');
  const secrets = JSON.parse(readFileSync(join(tmp, 'data', 'secrets.json'), 'utf8'));
  assert.ok(secrets.withings.refreshToken && !raw.includes(secrets.withings.refreshToken) && !raw.includes(secrets.withings.accessToken));
  assert.equal(statSync(join(tmp, 'data', 'secrets.json')).mode & 0o777, 0o600);

  // Première synchro : deux mois de nuits, en plusieurs pages, avec le détail de chacune
  const sync = await api('POST', '/api/withings/sync', {});
  assert.equal(sync.status, 200, JSON.stringify(sync.json));
  assert.equal(sync.json.added, 60);
  assert.equal(sync.json.pending, 0);
  assert.equal(sync.json.warning, null);
  assert.ok(fake.calls.summary >= 3, `pages de résumés : ${fake.calls.summary}`);
  assert.equal(fake.calls.detail, 60);
  const n0 = sync.json.nights[today()];
  // Médiane du détail (pas la moyenne du résumé, pas la mesure aberrante à 250)
  assert.deepEqual({ rmssd: n0.rmssd, hrvFrom: n0.hrvFrom, samples: n0.samples, hrAvg: n0.hrAvg }, { rmssd: 45, hrvFrom: 'detail', samples: 7, hrAvg: 50 });
  assert.equal(sync.json.nights[daysAgo(1)].rmssd, 40);
  assert.equal(sync.json.nights[daysAgo(2)].rmssd, 50);
  assert.ok(sync.json.withings.lastSync > 0);
});

test('Withings : synchro suivante, jeton renouvelé, limite de requêtes', async () => {
  // Rien de nouveau : ni nuit ajoutée, ni détail redemandé
  const before = fake.calls.detail;
  let sync = await api('POST', '/api/withings/sync', {});
  assert.deepEqual([sync.json.added, sync.json.updated, fake.calls.detail - before], [0, 0, 0]);

  // Jeton d'accès refusé : Enduro le renouvelle une fois, et garde le nouveau jeton de renouvellement
  const oldRefresh = JSON.parse(readFileSync(join(tmp, 'data', 'secrets.json'), 'utf8')).withings.refreshToken;
  fake.expireAccessTokens();
  const refreshes = fake.calls.refresh;
  sync = await api('POST', '/api/withings/sync', {});
  assert.equal(sync.status, 200, JSON.stringify(sync.json));
  assert.equal(fake.calls.refresh, refreshes + 1);
  assert.notEqual(JSON.parse(readFileSync(join(tmp, 'data', 'secrets.json'), 'utf8')).withings.refreshToken, oldRefresh);

  // Trois nuits récentes modifiées chez Withings, et limite de requêtes après un détail
  for (const n of fake.nights.slice(0, 3)) n.modified = 2;
  fake.rateLimitAfter(1);
  sync = await api('POST', '/api/withings/sync', {});
  assert.equal(sync.status, 200);
  assert.equal(sync.json.updated, 3);
  assert.match(sync.json.warning, /Trop de demandes/);
  // Ce qui est arrivé est gardé ; la synchro n'est pas marquée complète
  const state = (await api('GET', '/api/state')).json;
  assert.equal(state.nights[today()].rmssd, 45);
  assert.equal(state.nights[daysAgo(1)].detail, false);
  // La limite levée, la synchro suivante termine le travail
  fake.rateLimitAfter(null);
  sync = await api('POST', '/api/withings/sync', {});
  assert.deepEqual([sync.json.warning, sync.json.pending], [null, 0]);
  assert.equal(sync.json.nights[daysAgo(1)].rmssd, 40);
  assert.equal(sync.json.nights[daysAgo(2)].detail, true);
});

test('Withings : adresse de retour à coller, puis déconnexion', async () => {
  const set = await api('POST', '/api/withings/config', { clientId: CLIENT_ID, clientSecret: SECRET, redirectUri: 'https://exemple.fr/retour' });
  assert.equal(set.json.withings.customRedirect, true);
  assert.equal(set.json.withings.redirectUri, 'https://exemple.fr/retour');
  // Même application : la connexion existante est gardée
  assert.equal(set.json.withings.connected, true);

  const back = await authorize();
  assert.match(back, /^https:\/\/exemple\.fr\/retour\?code=/);
  assert.equal((await api('POST', '/api/withings/code', { url: 'https://exemple.fr/retour' })).status, 400);
  const pasted = await api('POST', '/api/withings/code', { url: ` ${back} ` });
  assert.equal(pasted.status, 200, JSON.stringify(pasted.json));
  assert.equal(pasted.json.withings.connected, true);
  // Coller deux fois la même adresse : refusé
  assert.equal((await api('POST', '/api/withings/code', { url: back })).status, 400);

  const off = await api('POST', '/api/withings/disconnect', {});
  assert.equal(off.json.withings.connected, false);
  assert.equal(off.json.withings.configured, true);
  const state = (await api('GET', '/api/state')).json;
  assert.equal(Object.keys(state.nights).length, 60, 'les nuits déjà reçues restent');
  assert.equal((await api('POST', '/api/withings/sync', {})).status, 409);

  // Autre application : identifiants remplacés, rien de l'ancienne connexion ne reste
  await api('POST', '/api/withings/config', { clientId: 'zzzzzzzzzzzzzzzzzzzz', clientSecret: SECRET });
  const secrets = JSON.parse(readFileSync(join(tmp, 'data', 'secrets.json'), 'utf8')).withings;
  assert.deepEqual(Object.keys(secrets).sort(), ['clientId', 'clientSecret', 'redirectUri']);
});
