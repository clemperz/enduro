// Version en ligne (téléphone) : les mêmes règles que le serveur du Mac, mais
// tout est enregistré dans le stockage du navigateur. Ici, un faux stockage et
// un faux Strava remplacent ceux du navigateur.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLocalBackend, KEYS } from '../public/js/local.js';

const APP = 'https://exemple.github.io/enduro/';

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

const open = (storage) => createLocalBackend({ storage, appUrl: APP });

/** Remplace fetch le temps d'un essai : `handler(url, init)` renvoie { status, json }. */
async function withFetch(handler, fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const { status = 200, json } = await handler(String(url), init);
    return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
  }
}

test('en ligne : état de départ, rien à propos de Zwift ni de serveur', () => {
  const { backend } = open(memoryStorage());
  const s = backend.publicState();
  assert.equal(s.profile, null);
  assert.deepEqual(s.activities, []);
  assert.deepEqual(s.zwift, { found: false });
  assert.deepEqual(s.server, { mode: 'local' });
  assert.deepEqual(s.strava, { configured: false, connected: false, athlete: null, lastSync: null });
  assert.equal(s.withings.redirectUri, APP);
});

test('en ligne : profil, activité, ressenti et ECG restent après réouverture', () => {
  const storage = memoryStorage();
  const { backend } = open(storage);
  backend.saveProfile({ name: 'Momo', refs: { ftp: 200 }, split: 0.5 });
  const { activity } = backend.addActivity({ sport: 'bike', date: '2026-11-16', durationSec: 3600, rpe: 5, name: 'Sortie' });
  assert.equal(activity.source, 'manual');
  assert.ok(activity.load > 0);
  backend.saveCheckin('2026-11-17', { feel: 2, pulse: 52 });
  backend.saveEcg('2026-11-17', { rmssd: 42.37, hr: 61.84, beats: 28 });
  assert.throws(() => backend.saveCheckin('demain', { feel: 2 }), { status: 400 });
  assert.throws(() => backend.addActivity({ sport: 'bike', date: '2026-11-16' }), { status: 400 });

  // Le navigateur est fermé puis rouvert : tout est là.
  const again = open(storage).backend.publicState();
  assert.equal(again.profile.name, 'Momo');
  assert.equal(again.activities.length, 1);
  assert.deepEqual(again.checkins['2026-11-17'], { feel: 2, sick: false, pulse: 52 });
  assert.equal(again.ecg['2026-11-17'].rmssd, 42.4);
});

test('en ligne : Zwift répond clairement qu’il passe par le Mac', () => {
  const { backend } = open(memoryStorage());
  assert.throws(() => backend.zwiftImport(), { status: 409, message: /Mac/ });
  assert.throws(() => backend.zwiftExport({ sessions: [{ sport: 'bike' }] }), { status: 409 });
  assert.deepEqual(backend.zwiftRemove('enduro-1-lun.zwo'), { removed: false });
});

test('en ligne : sauvegarde téléchargée puis restaurée sur un autre appareil', () => {
  const mac = open(memoryStorage()).backend;
  mac.saveProfile({ name: 'Momo', refs: { ftp: 200 } });
  mac.addActivity({ sport: 'run', date: '2026-11-15', durationSec: 2400, rpe: 4 });
  mac.savePlan({ startDate: '2026-11-10', weeks: {} });
  const { fileName, json } = mac.exportData();
  assert.match(fileName, /^enduro-\d{4}-\d{2}-\d{2}\.json$/);
  assert.ok(!json.includes('clientSecret'));

  const storage = memoryStorage();
  const phone = open(storage).backend;
  phone.saveProfile({ name: 'Autre carnet' });
  // Un fichier qui n'est pas une sauvegarde ne touche à rien.
  assert.throws(() => phone.restore({ backup: { hello: 'monde' } }), { status: 400 });
  assert.throws(() => phone.restore({ backup: { version: 1, profile: null, activities: [] } }), { status: 400 });
  assert.equal(phone.publicState().profile.name, 'Autre carnet');

  const restored = phone.restore({ backup: JSON.parse(json) });
  assert.equal(restored.profile.name, 'Momo');
  assert.equal(restored.activities.length, 1);
  assert.equal(restored.plan.startDate, '2026-11-10');
  assert.deepEqual(restored.server, { mode: 'local' });
  assert.equal(open(storage).backend.publicState().profile.name, 'Momo');

  // Une sauvegarde ancienne, sans les champs ajoutés depuis (nuits, ECG…), est complétée.
  const old = phone.restore({ backup: { version: 1, profile: { name: 'Vieux' }, activities: [] } });
  assert.deepEqual(old.nights, {});
  assert.deepEqual(old.ecg, {});

  phone.reset({ confirm: 'EFFACER' });
  assert.equal(open(storage).backend.publicState().profile, null);
});

test('en ligne : connexion Strava complète, sans serveur', async () => {
  const storage = memoryStorage();
  const local = open(storage);
  const { backend } = local;
  assert.throws(() => backend.stravaLoginUrl(), { status: 400 });
  backend.stravaConfig({ clientId: '12345', clientSecret: 's'.repeat(40) });
  // Les identifiants restent à part, jamais dans l'état montré à l'interface ni dans la sauvegarde.
  assert.ok(storage.getItem(KEYS.secrets).includes('s'.repeat(40)));
  assert.ok(!JSON.stringify(backend.publicState()).includes('s'.repeat(40)));
  assert.ok(!backend.exportData().json.includes('s'.repeat(40)));

  const url = new URL(backend.stravaLoginUrl());
  assert.equal(url.origin + url.pathname, 'https://www.strava.com/oauth/authorize');
  assert.equal(url.searchParams.get('redirect_uri'), APP);
  const st = url.searchParams.get('state');

  // Ce qui n'est pas un retour de connexion est ignoré.
  assert.equal(await local.oauthReturn('?today=2026-12-01'), null);
  // Un « state » inconnu est refusé, même avec un code.
  assert.deepEqual(await local.oauthReturn('?state=sfaux&code=x&scope=read,activity:read_all'), { provider: 'strava', result: 'expire' });

  const now = Math.floor(Date.now() / 1000);
  await withFetch((u, init) => {
    if (u === 'https://www.strava.com/oauth/token') {
      const body = new URLSearchParams(init.body);
      assert.equal(body.get('client_secret'), 's'.repeat(40));
      assert.equal(body.get('code'), 'le-code');
      return { json: { access_token: 'acc', refresh_token: 'ref', expires_at: now + 6 * 3600, athlete: { firstname: 'Momo', lastname: 'Marmotte' } } };
    }
    if (u.startsWith('https://www.strava.com/api/v3/athlete/activities')) {
      assert.equal(init.headers.Authorization, 'Bearer acc');
      return { json: [{ id: 501, name: 'Watopia', sport_type: 'VirtualRide', start_date: '2026-11-16T17:00:00Z', start_date_local: '2026-11-16T18:00:00Z', moving_time: 3600, average_watts: 180, weighted_average_watts: 190, device_watts: true }] };
    }
    throw new Error(`appel inattendu : ${u}`);
  }, async () => {
    // Un retour de Strava rejoué deux fois ne sert qu'une fois.
    const back = await local.oauthReturn(`?state=${st}&code=le-code&scope=read,activity:read_all`);
    assert.deepEqual(back, { provider: 'strava', result: 'ok' });
    assert.deepEqual(await local.oauthReturn(`?state=${st}&code=le-code&scope=read,activity:read_all`), { provider: 'strava', result: 'expire' });
    const s = backend.publicState().strava;
    assert.equal(s.connected, true);
    assert.equal(s.athlete.name, 'Momo Marmotte');
    const sync = await backend.stravaSync();
    assert.equal(sync.added, 1);
    assert.equal(sync.activities[0].id, 'strava:501');
  });

  // Le téléphone est rouvert : toujours connecté, l'activité est là.
  const again = open(storage).backend.publicState();
  assert.equal(again.strava.connected, true);
  assert.equal(again.activities.length, 1);

  // Accès aux activités non coché chez Strava
  const url2 = new URL(backend.stravaLoginUrl());
  assert.deepEqual(await local.oauthReturn(`?state=${url2.searchParams.get('state')}&code=x&scope=read`), { provider: 'strava', result: 'droits' });
});

test('en ligne : Withings renvoie vers l’appli elle-même', async () => {
  const local = open(memoryStorage());
  const { backend } = local;
  backend.withingsConfig({ clientId: 'a1b2c3d4e5f6a7b8c9d0', clientSecret: 'f00dbabedeadbeefdeadbeef' });
  const url = new URL(backend.withingsLoginUrl());
  assert.equal(url.searchParams.get('redirect_uri'), APP);
  const st = url.searchParams.get('state');
  assert.ok(st.startsWith('w'));
  // Retour sans code (refus côté Withings)
  assert.deepEqual(await local.oauthReturn(`?state=${st}&error=access_denied`), { provider: 'withings', result: 'refus' });
});
