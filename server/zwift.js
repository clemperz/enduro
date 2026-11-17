// Lien direct avec Zwift, sans passer par Internet :
// - lecture des sorties enregistrées dans Documents/Zwift/Activities (*.fit) ;
// - dépôt des séances dans Documents/Zwift/Workouts/<identifiant>/ (*.zwo),
//   où Zwift les affiche dans « Entraînements personnalisés ».

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { summarizeFit } from '../public/engine/fit.js';
import { localStamp } from '../public/engine/dates.js';

const MIN_SECONDS = 180;
/** À augmenter quand l'analyse des fichiers s'enrichit : les sorties déjà importées sont alors relues. */
const FIT_VERSION = 2;
const OWN_FILE = /^enduro-[1-7]-(lun|mar|mer|jeu|ven|sam|dim)(-[23])?\.zwo$/;

/** Dossier d'entraînements de l'utilisateur Zwift (le plus récent s'il y en a plusieurs). */
function workoutsDir(zwiftDir) {
  const root = join(zwiftDir, 'Workouts');
  if (!existsSync(root)) return null;
  const ids = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+$/.test(d.name))
    .map((d) => ({ id: d.name, mtime: statSync(join(root, d.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return ids.length ? { id: ids[0].id, dir: join(root, ids[0].id) } : null;
}

function fitFiles(zwiftDir) {
  const dir = join(zwiftDir, 'Activities');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.fit') && f !== 'inProgressActivity.fit')
    .sort()
    .map((f) => join(dir, f));
}

export function zwiftStatus(zwiftDir) {
  const found = existsSync(zwiftDir);
  const w = found ? workoutsDir(zwiftDir) : null;
  return {
    found,
    canExport: !!w,
    userId: w?.id ?? null,
    activityFiles: found ? fitFiles(zwiftDir).length : 0,
  };
}

/**
 * Lit les sorties Zwift pas encore connues.
 * @param {Set<string>} known  identifiants déjà importés ou ignorés
 */
export function readNewRides(zwiftDir, known) {
  const rides = [];
  const ignored = [];
  const errors = [];
  for (const file of fitFiles(zwiftDir)) {
    const id = `zwift:${basename(file, '.fit')}`;
    if (known.has(id)) continue;
    try {
      const s = summarizeFit(new Uint8Array(readFileSync(file)));
      if (!s || s.durationSec < MIN_SECONDS) { ignored.push(id); continue; }
      const start = localStamp(s.startEpoch);
      rides.push({
        id,
        source: 'zwift',
        sport: s.sport,
        indoor: true,
        name: s.sport === 'run' ? 'Course sur tapis (Zwift)' : 'Home trainer (Zwift)',
        start,
        date: start.slice(0, 10),
        startEpoch: s.startEpoch,
        durationSec: s.durationSec,
        distanceKm: s.distanceKm,
        elevationM: s.elevationM,
        avgPower: s.avgPower,
        np: s.np,
        maxPower: s.maxPower,
        avgHr: s.avgHr,
        maxHr: s.maxHr,
        avgCadence: s.avgCadence,
        best: s.best,
        ramp: s.ramp,
        fitV: FIT_VERSION,
      });
    } catch (err) {
      errors.push({ file: basename(file), message: err.message });
    }
  }
  return { rides, ignored, errors };
}

/**
 * Relit les fichiers des sorties déjà importées quand l'analyse a évolué
 * (détection du test rampe, FC max filtrée). Renvoie le nombre de sorties mises à jour.
 */
export function reanalyzeRides(zwiftDir, activities) {
  let updated = 0;
  for (const a of activities) {
    if (!a.id?.startsWith('zwift:') || (a.fitV ?? 1) >= FIT_VERSION) continue;
    const file = join(zwiftDir, 'Activities', `${a.id.slice(6)}.fit`);
    a.fitV = FIT_VERSION; // même si le fichier a disparu : inutile de réessayer à chaque fois
    if (!existsSync(file)) continue;
    try {
      const s = summarizeFit(new Uint8Array(readFileSync(file)));
      if (!s) continue;
      a.ramp = s.ramp;
      a.best = s.best ?? a.best;
      if (s.maxHr) a.maxHr = s.maxHr;
      if (s.avgHr) a.avgHr = s.avgHr;
      updated += 1;
    } catch {
      // fichier illisible : on garde ce qu'on avait
    }
  }
  return updated;
}

/**
 * Dépose une séance dans le dossier d'entraînements de Zwift.
 * N'écrit que ses propres fichiers « enduro-<jour>.zwo » (un par jour de la
 * semaine, réécrit chaque semaine) et ne touche à rien d'autre.
 */
/**
 * Retire de Zwift une séance supplémentaire (« enduro-<jour>-2.zwo ») qui n'est plus au plan.
 * Les fichiers principaux d'un jour ne sont pas supprimés : ils sont réécrits la semaine suivante.
 */
export function removeWorkout(zwiftDir, fileName) {
  if (!OWN_FILE.test(fileName) || !/-[23]\.zwo$/.test(fileName)) throw new Error('Nom de fichier invalide');
  const w = workoutsDir(zwiftDir);
  const path = w ? join(w.dir, fileName) : null;
  if (path && existsSync(path)) { unlinkSync(path); return true; }
  return false;
}

export function writeWorkout(zwiftDir, fileName, xml) {
  const w = workoutsDir(zwiftDir);
  if (!w) throw new Error('Dossier d’entraînements Zwift introuvable. Lance Zwift une première fois, puis réessaie.');
  if (!OWN_FILE.test(fileName)) throw new Error('Nom de fichier invalide');
  writeFileSync(join(w.dir, fileName), xml, 'utf8');
  return { fileName, userId: w.id };
}
