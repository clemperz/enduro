// Lecture des fichiers .fit (ceux que Zwift enregistre dans
// Documents/Zwift/Activities, ou exportés depuis Strava / un compteur).
// Décodeur minimal : on ne lit que ce qui sert à résumer une activité.

import { normalizedPower, bestEfforts, detectRamp } from './power.js';

const FIT_EPOCH = 631065600; // 31/12/1989 00:00 UTC, en secondes Unix

// Taille en octets de chaque type de base (indexé par les 5 bits de poids faible).
const SIZES = [1, 1, 1, 2, 2, 4, 4, 1, 4, 8, 1, 2, 4, 1, 8, 8, 8];

function readValue(view, pos, base, size, little) {
  const t = base & 0x1f;
  if (size < (SIZES[t] ?? 1)) return null;
  switch (t) {
    case 0: case 2: case 10: case 13: { const v = view.getUint8(pos); return v === 0xff && t !== 10 ? null : v; }
    case 1: { const v = view.getInt8(pos); return v === 0x7f ? null : v; }
    case 3: { const v = view.getInt16(pos, little); return v === 0x7fff ? null : v; }
    case 4: case 11: { const v = view.getUint16(pos, little); return v === 0xffff && t === 4 ? null : v; }
    case 5: { const v = view.getInt32(pos, little); return v === 0x7fffffff ? null : v; }
    case 6: case 12: { const v = view.getUint32(pos, little); return v === 0xffffffff && t === 6 ? null : v; }
    case 8: { const v = view.getFloat32(pos, little); return Number.isFinite(v) ? v : null; }
    case 9: { const v = view.getFloat64(pos, little); return Number.isFinite(v) ? v : null; }
    default: return null; // chaînes et entiers 64 bits : inutiles ici
  }
}

// Numéros de messages et de champs utiles (profil FIT).
const MSG = { SESSION: 18, RECORD: 20, ZONES_TARGET: 7 };
const WANTED = {
  [MSG.RECORD]: { 253: 'ts', 2: 'alt', 3: 'hr', 4: 'cad', 5: 'dist', 6: 'speed', 7: 'power', 73: 'speedE', 78: 'altE' },
  [MSG.SESSION]: {
    253: 'ts', 2: 'start', 5: 'sport', 6: 'subSport', 7: 'elapsed', 8: 'timer', 9: 'dist', 16: 'avgHr',
    17: 'maxHr', 18: 'avgCad', 20: 'avgPower', 21: 'maxPower', 22: 'ascent',
  },
  [MSG.ZONES_TARGET]: { 1: 'maxHr', 2: 'thresholdHr', 3: 'ftp' },
};

/**
 * Décode un fichier FIT.
 * @param {ArrayBuffer|Uint8Array} input
 * @returns {{records: object[], sessions: object[], zones: object|null}}
 */
export function decodeFit(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 14) throw new Error('Fichier FIT trop court');
  const headerSize = view.getUint8(0);
  const tag = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (tag !== '.FIT') throw new Error('Ce fichier n’est pas un fichier FIT');
  const dataSize = view.getUint32(4, true);
  const end = Math.min(view.byteLength, headerSize + dataSize);

  const defs = {};
  const records = [];
  const sessions = [];
  let zones = null;
  let lastTs = 0;
  let pos = headerSize;

  const readMessage = (def) => {
    const wanted = WANTED[def.global];
    const msg = wanted ? {} : null;
    for (const f of def.fields) {
      if (pos + f.size > end) throw new Error('Fichier FIT tronqué');
      if (msg && wanted[f.num]) {
        const v = readValue(view, pos, f.base, f.size, def.little);
        if (v != null) msg[wanted[f.num]] = v;
      }
      pos += f.size;
    }
    pos += def.devSize;
    return msg;
  };

  const store = (def, msg) => {
    if (!msg) return;
    if (msg.ts != null) lastTs = msg.ts;
    if (def.global === MSG.RECORD) records.push(msg);
    else if (def.global === MSG.SESSION) sessions.push(msg);
    else if (def.global === MSG.ZONES_TARGET) zones = msg;
  };

  while (pos < end) {
    const header = view.getUint8(pos++);
    if (header & 0x80) {
      // En-tête compressé : type local sur 2 bits + décalage de temps sur 5 bits.
      const def = defs[(header >> 5) & 0x3];
      if (!def) throw new Error('Fichier FIT invalide (définition manquante)');
      const offset = header & 0x1f;
      let ts = (lastTs & ~0x1f) + offset;
      if (offset < (lastTs & 0x1f)) ts += 0x20;
      const msg = readMessage(def);
      if (msg) msg.ts = ts;
      lastTs = ts;
      store(def, msg);
    } else if (header & 0x40) {
      const local = header & 0x0f;
      const hasDev = (header & 0x20) !== 0;
      pos += 1; // réservé
      const little = view.getUint8(pos++) === 0;
      const global = view.getUint16(pos, little);
      pos += 2;
      const count = view.getUint8(pos++);
      const fields = [];
      for (let i = 0; i < count; i++) {
        fields.push({ num: view.getUint8(pos), size: view.getUint8(pos + 1), base: view.getUint8(pos + 2) });
        pos += 3;
      }
      let devSize = 0;
      if (hasDev) {
        const devCount = view.getUint8(pos++);
        for (let i = 0; i < devCount; i++) {
          devSize += view.getUint8(pos + 1);
          pos += 3;
        }
      }
      defs[local] = { global, little, fields, devSize };
    } else {
      const def = defs[header & 0x0f];
      if (!def) throw new Error('Fichier FIT invalide (définition manquante)');
      store(def, readMessage(def));
    }
  }
  return { records, sessions, zones };
}

const SPORTS = { 1: 'run', 2: 'bike' };
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/** FC max tenue au moins 3 points de suite : un pic isolé est un artefact de capteur. */
function heartPeak(hrs) {
  if (hrs.length < 3) return hrs.reduce((m, x) => (x > m ? x : m), 0);
  let peak = 0;
  for (let i = 2; i < hrs.length; i++) {
    const low = Math.min(hrs[i], hrs[i - 1], hrs[i - 2]);
    if (low > peak) peak = low;
  }
  return peak;
}

/**
 * Résume un fichier FIT en une activité prête à enregistrer.
 * Renvoie null si le fichier ne contient aucun point.
 */
export function summarizeFit(input) {
  const { records, sessions, zones } = decodeFit(input);
  const pts = records.filter((r) => r.ts != null).sort((a, b) => a.ts - b.ts);
  if (!pts.length) return null;
  const session = sessions[0] ?? {};
  const first = pts[0].ts;
  const last = pts[pts.length - 1].ts;
  const startTs = session.start ?? first;

  // Série de puissance à 1 Hz (les trous sont comptés à zéro).
  const hasPower = pts.some((p) => p.power != null);
  let np = null;
  let avgPower = null;
  let maxPower = null;
  let best = null;
  let ramp = null;
  if (hasPower) {
    const series = new Array(last - first + 1).fill(0);
    for (const p of pts) series[p.ts - first] = p.power ?? 0;
    np = Math.round(normalizedPower(series));
    avgPower = Math.round(avg(series));
    maxPower = series.reduce((m, x) => (x > m ? x : m), 0);
    best = bestEfforts(series);
    ramp = detectRamp(series);
  }
  const hrs = pts.map((p) => p.hr).filter((v) => v > 0);
  const cads = pts.map((p) => p.cad).filter((v) => v > 0);

  // Dénivelé positif : somme des montées, avec un seuil pour ignorer le bruit.
  let ascent = session.ascent ?? null;
  if (ascent == null) {
    const alts = pts.map((p) => p.altE ?? p.alt).filter((v) => v != null).map((v) => v / 5 - 500);
    if (alts.length > 1) {
      let ref = alts[0];
      let up = 0;
      for (const a of alts) {
        if (a - ref >= 2) { up += a - ref; ref = a; } else if (a < ref) ref = a;
      }
      ascent = Math.round(up);
    }
  }
  const lastDist = [...pts].reverse().find((p) => p.dist != null)?.dist;
  const distanceM = session.dist != null ? session.dist / 100 : lastDist != null ? lastDist / 100 : 0;
  const durationSec = Math.round(session.timer != null ? session.timer / 1000 : last - first);

  return {
    sport: SPORTS[session.sport] ?? (hasPower ? 'bike' : 'other'),
    startEpoch: startTs + FIT_EPOCH,
    durationSec,
    elapsedSec: Math.round(session.elapsed != null ? session.elapsed / 1000 : last - first),
    distanceKm: Math.round(distanceM / 10) / 100,
    elevationM: ascent ?? 0,
    avgPower: avgPower ?? session.avgPower ?? null,
    np,
    maxPower: maxPower ?? session.maxPower ?? null,
    avgHr: hrs.length ? Math.round(avg(hrs)) : session.avgHr || null,
    maxHr: hrs.length ? heartPeak(hrs) : session.maxHr || null,
    avgCadence: cads.length ? Math.round(avg(cads)) : session.avgCad || null,
    best,
    ramp,
    ftp: zones?.ftp ?? null,
    points: pts.length,
  };
}
