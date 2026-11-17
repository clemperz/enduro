// Stockage local : un fichier JSON pour les données, un autre (privé) pour
// les identifiants Strava et Withings. Écriture atomique + une sauvegarde par jour.

import {
  mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, copyFileSync, readdirSync, unlinkSync, chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { defaultState, normalizeState } from '../public/core/state.js';

export { defaultState };

const KEEP_BACKUPS = 14;

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    // Fichier illisible : on le met de côté plutôt que de l'écraser.
    const aside = `${file}.illisible-${Date.now()}`;
    renameSync(file, aside);
    console.error(`Fichier illisible mis de côté : ${aside} (${err.message})`);
    return fallback;
  }
}

function writeJson(file, value, mode) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1), mode ? { mode } : undefined);
  renameSync(tmp, file);
  if (mode) chmodSync(file, mode);
}

export function createStore(dir) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'enduro.json');
  const secretsFile = join(dir, 'secrets.json');
  const backupDir = join(dir, 'sauvegardes');
  const state = normalizeState(readJson(file, {}));
  const secrets = readJson(secretsFile, {});

  function backup() {
    if (!existsSync(file)) return;
    mkdirSync(backupDir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const target = join(backupDir, `enduro-${day}.json`);
    if (existsSync(target)) return;
    copyFileSync(file, target);
    const old = readdirSync(backupDir).filter((f) => f.startsWith('enduro-')).sort();
    for (const f of old.slice(0, Math.max(0, old.length - KEEP_BACKUPS))) unlinkSync(join(backupDir, f));
  }

  return {
    state,
    secrets,
    dir,
    save() {
      backup();
      writeJson(file, state);
    },
    saveSecrets() {
      writeJson(secretsFile, secrets, 0o600);
    },
    /** Avant de tout remplacer (effacement, restauration) : une copie de l'état actuel, en plus de celle du jour. */
    keepCopy(reason) {
      backup();
      if (!existsSync(file)) return;
      mkdirSync(backupDir, { recursive: true });
      copyFileSync(file, join(backupDir, `${reason}-${Date.now()}.json`));
    },
  };
}
