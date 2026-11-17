// Séances envoyées du téléphone vers Zwift : fichiers fabriqués par la version
// en ligne, puis rangés sur le Mac depuis Téléchargements (AirDrop).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { inboxName, collectInbox } from '../server/zwift.js';
import { createLocalBackend } from '../public/js/local.js';
import { buildSession } from '../public/engine/workouts.js';
import { sessionToZwo } from '../public/engine/zwo.js';
import { resolveRefs } from '../public/engine/zones.js';

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
}

const bikeSession = (date) => ({ id: `s-${date}`, date, sport: 'bike', ...buildSession({ sport: 'bike', kind: 'sv1', minutes: 60 }) });

test('noms reçus par AirDrop : reconnus, renommages du Mac compris', () => {
  assert.equal(inboxName('enduro-1-lun.zwo'), 'enduro-1-lun.zwo');
  assert.equal(inboxName('enduro-3-mer-2.zwo'), 'enduro-3-mer-2.zwo');
  assert.equal(inboxName('enduro-1-lun 2.zwo'), 'enduro-1-lun.zwo');
  assert.equal(inboxName('enduro-1-lun (1).zwo'), 'enduro-1-lun.zwo');
  assert.equal(inboxName('enduro-6-sam.zwo.txt'), 'enduro-6-sam.zwo');
  assert.equal(inboxName('Enduro-7-DIM.zwo'), 'enduro-7-dim.zwo');
  for (const other of ['enduro-8-lun.zwo', 'enduro-1-lun.fit', 'facture.zwo', 'enduro-2026-11-17.json', '../enduro-1-lun.zwo']) {
    assert.equal(inboxName(other), null, other);
  }
});

test('la version en ligne fabrique les mêmes fichiers que le Mac', () => {
  const { backend } = createLocalBackend({ storage: memoryStorage(), appUrl: 'https://exemple.github.io/enduro/' });
  backend.saveProfile({ refs: { ftp: 240, pma: 320 } });
  const s = bikeSession('2026-11-17');
  const res = backend.zwiftFiles({ sessions: [s] });
  assert.equal(res.files.length, 1);
  assert.equal(res.files[0].fileName, 'enduro-2-mar.zwo');
  assert.equal(res.ftp, 240);
  assert.equal(res.files[0].xml, sessionToZwo(s, resolveRefs({ refs: { ftp: 240, pma: 320 } }, 2026)));
  assert.throws(() => backend.zwiftFiles({ sessions: [{ ...s, sport: 'run' }] }), { status: 400 });
  assert.throws(() => backend.zwiftFiles({ sessions: [] }), { status: 400 });
});

test('Téléchargements → Zwift : rangées, la plus récente gagne, le reste n’est pas touché', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'enduro-airdrop-'));
  try {
    const inbox = join(tmp, 'Downloads');
    const zwift = join(tmp, 'Zwift');
    mkdirSync(inbox, { recursive: true });
    mkdirSync(join(zwift, 'Workouts', '424242'), { recursive: true });
    const xml = (label) => sessionToZwo({ ...bikeSession('2026-11-17'), title: label }, {});
    writeFileSync(join(inbox, 'enduro-2-mar.zwo'), xml('ancienne'));
    utimesSync(join(inbox, 'enduro-2-mar.zwo'), new Date('2026-11-16T10:00:00'), new Date('2026-11-16T10:00:00'));
    writeFileSync(join(inbox, 'enduro-2-mar 2.zwo'), xml('nouvelle'));
    writeFileSync(join(inbox, 'enduro-6-sam.zwo.txt'), xml('samedi'));
    writeFileSync(join(inbox, 'enduro-4-jeu.zwo'), '<workout_file><name>coupé'); // encore en cours de réception
    writeFileSync(join(inbox, 'photo.jpg'), 'pas une séance');
    writeFileSync(join(inbox, 'mes-notes.zwo'), xml('pas à Enduro'));

    const res = collectInbox(inbox, zwift);
    assert.deepEqual(res.moved, ['enduro-2-mar.zwo', 'enduro-6-sam.zwo']);
    assert.equal(res.waiting, 1);
    const inZwift = readdirSync(join(zwift, 'Workouts', '424242')).sort();
    assert.deepEqual(inZwift, ['enduro-2-mar.zwo', 'enduro-6-sam.zwo']);
    assert.match(readFileSync(join(zwift, 'Workouts', '424242', 'enduro-2-mar.zwo'), 'utf8'), /<workout_file>/);
    assert.deepEqual(readdirSync(inbox).sort(), ['enduro-4-jeu.zwo', 'mes-notes.zwo', 'photo.jpg']);

    // Zwift jamais lancé : on le dit, sans rien perdre.
    const noZwift = join(tmp, 'PasDeZwift');
    writeFileSync(join(inbox, 'enduro-1-lun.zwo'), xml('lundi'));
    assert.throws(() => collectInbox(inbox, noZwift), /Lance Zwift une première fois/);
    assert.ok(readdirSync(inbox).includes('enduro-1-lun.zwo'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
