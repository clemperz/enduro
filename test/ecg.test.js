// ECG de 30 s de la montre : battements retrouvés sur le tracé, VFC (RMSSD),
// lecture du PDF de l'appli Withings (bandes en image, ou en traits), et effet
// sur le feu du matin. Les ECG sont fabriqués ici à partir d'instants de
// battements connus : la VFC attendue se calcule sur ces instants, sans passer
// par la détection.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';

import { detectBeats, hrvFromBeats, analyzeEcg, ECG_REASONS } from '../public/engine/ecg.js';
import { readEcgPdf, readEcgFile, traceFromPixels } from '../public/engine/ecgfile.js';
import { morningStatus, nightStatus } from '../public/engine/nights.js';
import { readiness } from '../public/engine/readiness.js';
import { addDays } from '../public/engine/dates.js';
import { ARTICLES } from '../public/js/manual.js';

// --- ECG synthétique -------------------------------------------------------

/** Petit générateur pseudo-aléatoire reproductible (mulberry32) + loi normale. */
function rng(seed) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { u, gauss: () => Math.sqrt(-2 * Math.log(u() || 1e-9)) * Math.cos(2 * Math.PI * u()) };
}

/** Instants des battements : pouls moyen, arythmie respiratoire (ms), bruit, extrasystole éventuelle. */
function beatTimes({ hr = 55, rsa = 40, seed = 1, dur = 30, ectopic = null, chaos = 0 }) {
  const r = rng(seed);
  const mean = 60 / hr;
  const out = [];
  for (let t = 0.37, k = 0; t < dur; k++) {
    out.push(t);
    let rr = mean + (rsa / 1000) * Math.sin((2 * Math.PI * t) / 4.5) + 0.012 * r.gauss();
    if (chaos) rr = mean * (1 + chaos * (2 * r.u() - 1));
    if (k === ectopic) rr = mean * 0.65;
    if (ectopic != null && k === ectopic + 1) rr = mean * 1.35;
    t += rr;
  }
  return out;
}

/** Tracé : ondes P, Q, R, S, T autour de chaque battement, ligne de base qui ondule, bruit. */
function ecgSignal(beats, { fs = 300, dur = 30, invert = false, noise = 0.02, seed = 9, tallT = 1 } = {}) {
  const r = rng(seed);
  const sig = new Float64Array(Math.round(dur * fs));
  const g = (dt, c, w, a) => a * Math.exp(-(((dt - c) / w) ** 2));
  for (let i = 0; i < sig.length; i++) {
    const t = i / fs;
    let v = 0.3 * Math.sin(2 * Math.PI * 0.25 * t) + noise * r.gauss();
    for (const b of beats) {
      const dt = t - b;
      if (dt < -0.4 || dt > 0.6) continue;
      v += g(dt, -0.16, 0.025, 0.12) + g(dt, -0.025, 0.008, -0.15) + g(dt, 0, 0.01, 1) + g(dt, 0.03, 0.01, -0.25) + g(dt, 0.28, 0.05, 0.3 * tallT);
    }
    sig[i] = invert ? -v : v;
  }
  return sig;
}

/** VFC attendue, calculée sur les instants connus (même règle d'écart que l'appli). */
function expected(runs) {
  const rr = runs.map((b) => b.slice(1).map((v, i) => (v - b[i]) * 1000));
  const flat = rr.flat().sort((a, b) => a - b);
  const med = flat.length % 2 ? flat[(flat.length - 1) / 2] : (flat[flat.length / 2 - 1] + flat[flat.length / 2]) / 2;
  const ok = (v) => Math.abs(v - med) <= 0.25 * med;
  const d = rr.flatMap((r) => r.slice(1).map((v, i) => (ok(v) && ok(r[i]) ? v - r[i] : null)).filter((v) => v != null));
  const kept = flat.filter(ok);
  return { rmssd: Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length), hr: 60000 / (kept.reduce((s, v) => s + v, 0) / kept.length), rejected: flat.length - kept.length };
}

test('ECG : chaque battement retrouvé, VFC à 1,5 ms près', () => {
  const cases = [
    { name: 'repos', beat: { hr: 55, rsa: 40, seed: 1 } },
    { name: 'cœur lent d’athlète', beat: { hr: 42, rsa: 110, seed: 2 } },
    { name: 'tracé à l’envers (autre poignet)', beat: { hr: 60, rsa: 30, seed: 3 }, sig: { invert: true } },
    { name: 'parasites et faible signal', beat: { hr: 65, rsa: 25, seed: 5 }, sig: { noise: 0.08 } },
    { name: 'ondes T très hautes', beat: { hr: 50, rsa: 50, seed: 6 }, sig: { tallT: 2.2 } },
    { name: 'pouls rapide', beat: { hr: 90, rsa: 12, seed: 7 } },
    { name: '500 Hz', beat: { hr: 55, rsa: 40, seed: 8 }, sig: { fs: 500 } },
  ];
  for (const c of cases) {
    const beats = beatTimes(c.beat);
    const fs = c.sig?.fs ?? 300;
    const found = detectBeats(ecgSignal(beats, c.sig), fs);
    assert.equal(found.length, beats.length, `${c.name} : nombre de battements`);
    found.forEach((t, i) => assert.ok(Math.abs(t - beats[i]) < 0.006, `${c.name} : battement ${i} à ${t} au lieu de ${beats[i]}`));
    const r = analyzeEcg(ecgSignal(beats, c.sig), fs);
    const e = expected([beats]);
    assert.equal(r.ok, true, c.name);
    assert.ok(Math.abs(r.rmssd - e.rmssd) < 1.5, `${c.name} : RMSSD ${r.rmssd} au lieu de ${e.rmssd.toFixed(1)}`);
    assert.ok(Math.abs(r.hr - e.hr) < 0.3, `${c.name} : pouls ${r.hr} au lieu de ${e.hr.toFixed(1)}`);
  }
});

test('ECG : extrasystole écartée, rythme irrégulier ou mesure trop courte refusés', () => {
  const beats = beatTimes({ hr: 58, rsa: 30, seed: 4, ectopic: 12 });
  const r = analyzeEcg(ecgSignal(beats), 300);
  const e = expected([beats]);
  assert.equal(r.ok, true);
  assert.equal(r.rejected, 2, 'le battement prématuré et le repos qui suit');
  assert.ok(Math.abs(r.rmssd - e.rmssd) < 1.5);

  // Rythme très irrégulier (comme une fibrillation) : la VFC n'a pas de sens
  const chaos = analyzeEcg(ecgSignal(beatTimes({ hr: 80, seed: 11, chaos: 0.35 })), 300);
  assert.deepEqual([chaos.ok, chaos.reason], [false, 'irregulier']);
  assert.match(ECG_REASONS.irregulier, /Refais l’ECG/);

  assert.deepEqual([analyzeEcg(new Float64Array(300 * 10), 300).ok, analyzeEcg(new Float64Array(300 * 10), 300).reason], [false, 'trop-court']);
  // Intervalles comptés à l'intérieur de chaque bande seulement
  const two = hrvFromBeats([[0, 1, 2.1], [10, 11, 12]]);
  assert.equal(two.intervals, 4);
  assert.equal(two.pairs, 2);
});

// --- PDF de l'appli Withings ----------------------------------------------

const MM = 72 / 25.4;

/** Écrit un PDF minimal : objets numérotés à partir de 1, page n° 3, contenu n° 4. */
function writePdf(objects, { creationDate = null } = {}) {
  const parts = ['%PDF-1.3\n'];
  let size = parts[0].length;
  const offsets = [];
  const chunks = [Buffer.from(parts[0], 'latin1')];
  objects.forEach((o, i) => {
    offsets.push(size);
    const head = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
    const body = Buffer.isBuffer(o) ? o : Buffer.from(o, 'latin1');
    const tail = Buffer.from('\nendobj\n', 'latin1');
    chunks.push(head, body, tail);
    size += head.length + body.length + tail.length;
  });
  const info = objects.length + 1;
  const infoObj = Buffer.from(`${info} 0 obj\n<< /Producer (essai) ${creationDate ? `/CreationDate (D:${creationDate})` : ''} >>\nendobj\n`, 'latin1');
  offsets.push(size);
  chunks.push(infoObj);
  size += infoObj.length;
  const xref = `xref\n0 ${info + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${info + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${size}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));
  return new Uint8Array(Buffer.concat(chunks));
}

const streamObj = (dict, data) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]);

/** Trois bandes de 10 s : le tracé en image (comme l'appli de l'iPhone), avec quadrillage, créneau et graduations. */
function rasterPdf(signal, fs) {
  const W = 2000; // 200 pixels par seconde
  const H = 240;
  const images = [];
  for (let row = 0; row < 3; row++) {
    const rgb = Buffer.alloc(W * H * 3); // pixels transparents : noirs dans l'image, effacés par le masque
    const alpha = Buffer.alloc(W * H);
    const put = (x, y, r, g, b) => { const i = y * W + x; rgb[3 * i] = r; rgb[3 * i + 1] = g; rgb[3 * i + 2] = b; alpha[i] = 255; };
    for (let y = 0; y < 200; y++) for (let x = 0; x < W; x++) if (x % 8 === 0 || y % 8 === 0) put(x, y, 225, 190, 190);
    for (let y = 208; y < 222; y++) for (let x = 190; x < W; x += 200) for (let k = 0; k < 6; k++) put(x + k, y, 60, 60, 60); // graduations
    const ys = [];
    for (let x = 0; x < W; x++) {
      const t = row * 10 + x / 200;
      ys.push(Math.round(110 - 80 * (signal[Math.min(signal.length - 1, Math.round(t * fs))] - 0)));
    }
    const first = row === 0 ? 90 : 0;
    if (row === 0) { // créneau d'étalonnage de 1 mV, séparé du tracé
      for (let x = 0; x < 56; x++) put(x, x > 6 && x < 50 ? 30 : 110, 20, 20, 20);
      for (let y = 30; y <= 110; y++) { put(6, y, 20, 20, 20); put(50, y, 20, 20, 20); }
    }
    for (let x = first; x < W; x++) {
      const a = ys[x];
      const b = x > first ? ys[x - 1] : a;
      for (let y = Math.min(a, b) - 1; y <= Math.max(a, b) + 1; y++) if (y >= 0 && y < 200) put(x, y, 20, 20, 20);
    }
    images.push({ rgb: deflateSync(rgb), alpha: deflateSync(alpha) });
  }
  const content = ['q 1 0.97 0.96 rg 0 0 842 595 re f Q'];
  images.forEach((_, i) => content.push(`q 708.6667 0 0 85.65786 66.66667 ${308.5377 - i * 97.6666} cm /Im${12 + i} Do Q`));
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 841.6667 595.2] /Contents 4 0 R /Resources << /XObject << ${images.map((_, i) => `/Im${12 + i} ${5 + 2 * i} 0 R`).join(' ')} >> >> >>`,
    streamObj('/Filter /FlateDecode', deflateSync(Buffer.from(content.join('\n'), 'latin1'))),
  ];
  images.forEach((im, i) => {
    objs.push(streamObj(`/Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /SMask ${6 + 2 * i} 0 R /BitsPerComponent 8 /Filter /FlateDecode`, im.rgb));
    objs.push(streamObj(`/Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, im.alpha));
  });
  return writePdf(objs, { creationDate: "20261117081144Z00'00'" });
}

/** Trois bandes de 10 s dessinées en traits, dans un repère retourné (origine en haut). */
function vectorPdf(signal, fs, { segments = false } = {}) {
  const ops = ['q 1 0 0 -1 0 595 cm', '1 0.8 0.8 RG 0.3 w'];
  for (let k = 0; k < 250; k++) ops.push(`${(30 + k * MM).toFixed(2)} 60 m ${(30 + k * MM).toFixed(2)} 560 l S`);
  ops.push('0 0 0 RG 0.8 w');
  for (let row = 0; row < 3; row++) {
    const pts = [];
    for (let i = row * 10 * fs; i < (row + 1) * 10 * fs; i++) pts.push([30 + ((i - row * 10 * fs) / fs) * 25 * MM, 150 + row * 150 - signal[i] * 10 * MM]);
    if (segments) pts.slice(1).forEach((p, i) => ops.push(`${pts[i][0].toFixed(3)} ${pts[i][1].toFixed(3)} m ${p[0].toFixed(3)} ${p[1].toFixed(3)} l S`));
    else ops.push(`${pts[0][0].toFixed(3)} ${pts[0][1].toFixed(3)} m ${pts.slice(1).map((p) => `${p[0].toFixed(3)} ${p[1].toFixed(3)} l`).join(' ')} S`);
  }
  ops.push('Q');
  return writePdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R >>',
    streamObj('/Filter /FlateDecode', deflateSync(Buffer.from(ops.join('\n'), 'latin1'))),
  ]);
}

/** Les battements de chaque bande de 10 s, en secondes depuis le début de la bande. */
const perStrip = (beats, margin = 0.02) => [0, 1, 2].map((r) => beats.filter((b) => b > r * 10 + margin && b < (r + 1) * 10 - margin).map((b) => b - r * 10));

test('PDF Withings (bandes en image) : tracé relu, créneau ignoré, VFC juste', async () => {
  const beats = beatTimes({ hr: 56, rsa: 35, seed: 21 });
  const sig = ecgSignal(beats, { fs: 1000, noise: 0.01 });
  const rec = await readEcgPdf(rasterPdf(sig, 1000));
  assert.equal(rec.kind, 'image');
  assert.equal(rec.segments.length, 3);
  assert.ok(Math.abs(rec.fs - 200) < 0.5, `pixels par seconde : ${rec.fs}`);
  assert.equal(rec.seconds, 30);
  // Le créneau d'étalonnage (≈ 0,45 s au début de la 1re bande) n'est pas dans le tracé
  assert.ok(rec.segments[0].length < rec.segments[1].length - 80);
  const t = new Date(Date.UTC(2026, 10, 17, 8, 11, 44));
  assert.equal(rec.date, `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`);

  const r = analyzeEcg(rec.segments, rec.fs);
  // La 1re bande commence après le créneau : ses battements avant 0,45 s ne sont pas lisibles.
  const strips = perStrip(beats, 0.012);
  strips[0] = strips[0].filter((b) => b > 0.47);
  const e = expected(strips);
  assert.equal(r.ok, true);
  assert.equal(r.intervals, strips.reduce((s, b) => s + b.length - 1, 0));
  assert.ok(Math.abs(r.rmssd - e.rmssd) < 2, `RMSSD ${r.rmssd} au lieu de ${e.rmssd.toFixed(1)}`);
  assert.ok(Math.abs(r.hr - e.hr) < 0.5);
});

test('PDF dessiné en traits (d’un seul tenant ou segment par segment) : même VFC', async () => {
  const beats = beatTimes({ hr: 55, rsa: 40, seed: 1 });
  const sig = ecgSignal(beats, { fs: 300 });
  const e = expected(perStrip(beats, 0.012));
  for (const segments of [false, true]) {
    const rec = await readEcgFile(vectorPdf(sig, 300, { segments }), 'ecg.pdf');
    assert.equal(rec.kind, 'traits');
    assert.deepEqual([rec.segments.length, rec.seconds, rec.scale], [3, 30, 'papier']);
    const r = analyzeEcg(rec.segments, rec.fs);
    assert.equal(r.ok, true);
    assert.ok(Math.abs(r.rmssd - e.rmssd) < 1.5, `RMSSD ${r.rmssd} au lieu de ${e.rmssd.toFixed(1)}`);
  }
});

test('PDF : fichier qui n’est pas un ECG refusé clairement', async () => {
  await assert.rejects(readEcgFile(new TextEncoder().encode('bonjour'), 'notes.txt'), /Format non reconnu/);
  const empty = writePdf(['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>', streamObj('', Buffer.from('BT (Bonjour) Tj ET', 'latin1'))]);
  await assert.rejects(readEcgFile(empty, 'vide.pdf'), /Pas de tracé d’ECG/);
  // Une image sans trait noir : rien à lire
  assert.equal(traceFromPixels(new Uint8Array(300 * 50 * 3).fill(255), null, 300, 50), null);
});

// --- Feu du matin --------------------------------------------------------

const TODAY = '2026-11-17';
const fresh = { ratio: 0.1, ratioNow: 0.1, monotony: null, weekLoad: 0 };

/** 28 ECG d'habitude : 40 ms les jours impairs, 50 ms les jours pairs ; pouls 55. */
function ecgHistory(overrides = {}) {
  const ecg = {};
  for (let i = 1; i <= 28; i++) ecg[addDays(TODAY, -i)] = { rmssd: i % 2 ? 40 : 50, hr: 55 };
  for (const [i, m] of Object.entries(overrides)) ecg[addDays(TODAY, -Number(i))] = { hr: 55, ...m };
  return ecg;
}

test('feu du matin : l’ECG du matin compte comme la nuit, avec sa propre habitude', () => {
  const at = (today, overrides) => morningStatus({ ...ecgHistory(overrides), [TODAY]: { hr: 55, ...today } }, TODAY);
  assert.equal(morningStatus(ecgHistory(), TODAY), null, 'pas d’ECG ce matin');
  // Même habitude que les nuits de test/nights.test.js (40/50 ms) : normale 42 à 47 ms
  const normal = at({ rmssd: 45 });
  assert.deepEqual([normal.hrv.base.ms, normal.hrv.base.low, normal.hrv.base.high], [45, 42, 47]);
  assert.equal(normal.hr.base, 55);
  assert.equal(readiness(fresh, { feel: 4 }, { ecg: normal }).level, 'bleu');

  const lowWeek = at({ rmssd: 36 }, { 1: { rmssd: 36 }, 2: { rmssd: 36 }, 3: { rmssd: 36 } });
  const alone = readiness(fresh, { feel: 4 }, { ecg: lowWeek });
  assert.equal(alone.level, 'vert');
  assert.ok(alone.reasons.some((r) => /Ta VFC du matin est sous ton habitude/.test(r)));
  const meh = readiness(fresh, { feel: 3 }, { ecg: lowWeek });
  assert.equal(meh.level, 'orange');
  assert.ok(meh.reasons.some((r) => /Ta VFC du matin baisse depuis plusieurs jours et tu te sens moyen/.test(r)));

  const single = readiness(fresh, { feel: 4 }, { ecg: at({ rmssd: 36 }) });
  assert.equal(single.level, 'vert');
  assert.ok(single.reasons.some((r) => /mesure isolée ne veut rien dire/.test(r)));

  // Pouls pendant l'ECG : même règle que le pouls du matin
  const fast = readiness(fresh, { feel: 4 }, { ecg: at({ rmssd: 45, hr: 62 }) });
  assert.equal(fast.level, 'orange');
  assert.ok(fast.reasons.some((r) => /pouls pendant l’ECG de ce matin est 7 battements au-dessus/.test(r)));

  // ECG et nuit le même matin : c'est l'ECG qui compte pour la VFC
  const nights = {};
  for (let i = 1; i <= 28; i++) nights[addDays(TODAY, -i)] = { rmssd: 80, hrAvg: 50 };
  nights[TODAY] = { rmssd: 50, hrAvg: 50 }; // nuit nettement basse
  const both = readiness(fresh, { feel: 4 }, { night: nightStatus(nights, TODAY), ecg: normal });
  assert.ok(!both.reasons.some((r) => /nuit/.test(r)), both.reasons.join(' | '));
  assert.equal(both.level, 'bleu');
});

test('manuel : comment mesurer la VFC avec l’ECG de la montre', () => {
  const recup = ARTICLES.find((a) => a.id === 'recup');
  const text = JSON.stringify(recup.blocks);
  assert.match(text, /La VFC du matin, avec l’ECG de la montre/);
  assert.match(text, /Partager le PDF avec mon médecin/);
  assert.ok(recup.sources.some((s) => /Esco M\. et Flatt A\. \(2014\)/.test(s)));
  assert.ok(recup.sources.some((s) => /Pan J\. et Tompkins W\. \(1985\)/.test(s)));
});
