// Lire le tracé d'un ECG dans le PDF que l'appli Withings prépare pour le
// médecin (fil → l'ECG → « Partager le PDF avec mon médecin »).
//
// L'appli de l'iPhone met chaque bande de 10 s en image (≈ 450 pixels par
// seconde) : on relit le trait noir colonne par colonne, sur le quadrillage
// rose. Si un PDF dessine au contraire le tracé en traits, on relit ces traits.
// Dans les deux cas, l'échelle du papier ECG (25 mm par seconde) donne le temps.
//
// Aucune bibliothèque : on ne lit du PDF que ce qu'il faut (flux compressés,
// déplacements, traits, images).

export const PAPER_SPEED_MM_S = 25;
const PT_PER_MM = 72 / 25.4;
/** Fréquence à laquelle on rééchantillonne le tracé relu (Hz). */
export const RESAMPLE_HZ = 500;

const latin1 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return s;
};

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  // Les erreurs remontent par la lecture : on évite qu'elles s'échappent aussi par l'écriture.
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

/** Les flux du PDF : { num, dict, raw, image } (contenu brut, encore compressé). */
function pdfStreams(bytes) {
  const text = latin1(bytes);
  const out = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(text))) {
    if (text.slice(m.index - 3, m.index) === 'end') continue; // « endstream », pas un début de flux
    const dictStart = text.lastIndexOf('obj', m.index);
    if (dictStart < 0 || text.slice(dictStart, m.index).includes('endobj')) continue;
    const dict = text.slice(dictStart, m.index);
    const num = Number(/(\d+)\s+\d+\s*$/.exec(text.slice(Math.max(0, dictStart - 20), dictStart))?.[1]);
    const start = m.index + m[0].length;
    const lenMatch = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
    let end = lenMatch ? start + Number(lenMatch[1]) : -1;
    if (end < 0 || text.slice(end, end + 30).indexOf('endstream') < 0) {
      end = text.indexOf('endstream', start);
      if (end < 0) break;
      while (end > start && (text[end - 1] === '\n' || text[end - 1] === '\r')) end -= 1;
    }
    re.lastIndex = end;
    if (/\/Type\s*\/(XRef|ObjStm|Metadata)|\/Length1|\/FontFile/.test(dict)) continue;
    out.push({ num, dict, raw: bytes.subarray(start, end), image: /\/Subtype\s*\/Image/.test(dict) });
  }
  return { text, streams: out };
}

async function decode(stream) {
  if (/\/FlateDecode/.test(stream.dict)) return inflate(stream.raw);
  if (/\/Filter/.test(stream.dict)) return null;
  return stream.raw;
}

/** Découpe un flux de dessin en opérandes / opérateurs. */
function* tokens(src) {
  const n = src.length;
  let i = 0;
  while (i < n) {
    const ch = src[i];
    if (ch === '%') { while (i < n && src[i] !== '\n' && src[i] !== '\r') i++; continue; }
    if (' \t\r\n\f\0'.includes(ch)) { i++; continue; }
    if (ch === '(') {
      let depth = 1;
      i++;
      while (i < n && depth) { if (src[i] === '\\') i++; else if (src[i] === '(') depth++; else if (src[i] === ')') depth--; i++; }
      yield { str: true };
      continue;
    }
    if (ch === '<' && src[i + 1] === '<') { i += 2; yield { op: '<<' }; continue; }
    if (ch === '>' && src[i + 1] === '>') { i += 2; yield { op: '>>' }; continue; }
    if (ch === '<') { const j = src.indexOf('>', i); i = j < 0 ? n : j + 1; yield { str: true }; continue; }
    if (ch === '[' || ch === ']' || ch === '{' || ch === '}') { i++; yield { op: ch }; continue; }
    if (ch === '/') { let j = i + 1; while (j < n && !/[\s/[\]()<>{}%]/.test(src[j])) j++; yield { name: src.slice(i + 1, j) }; i = j; continue; }
    const num = /^[+-]?(\d+\.?\d*|\.\d+)/.exec(src.slice(i, i + 32));
    if (num) { yield { num: Number(num[0]) }; i += num[0].length; continue; }
    let j = i;
    while (j < n && !/[\s/[\]()<>{}%]/.test(src[j])) j++;
    if (j === i) { i++; continue; }
    const op = src.slice(i, j);
    i = j;
    if (op === 'BI') { // image en ligne : on saute jusqu'à EI
      const k = src.indexOf('EI', src.indexOf('ID', i));
      i = k < 0 ? n : k + 2;
      continue;
    }
    yield { op };
  }
}

const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];

/**
 * Ce qui est dessiné dans un flux, en points PDF :
 *  - lines  : traits [{ color, width, points: [[x, y], …] }]
 *  - images : images posées [{ name, x, y, w, h }]
 */
function drawing(src) {
  let ctm = [1, 0, 0, 1, 0, 0];
  let color = '0';
  let width = 1;
  const stack = [];
  let ops = [];
  let path = [];
  let cur = null;
  const out = [];
  const images = [];
  const at = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
  for (const t of tokens(src)) {
    if (t.num != null) { ops.push(t.num); continue; }
    if (t.name != null) { ops.push({ name: t.name }); continue; }
    if (!t.op) { ops.push(null); continue; }
    const a = ops;
    ops = [];
    switch (t.op) {
      case 'q': stack.push({ ctm, color, width }); break;
      case 'Q': ({ ctm, color, width } = stack.pop() ?? { ctm, color, width }); break;
      case 'cm': if (a.length >= 6) ctm = mul(a.slice(-6), ctm); break;
      case 'w': if (typeof a[a.length - 1] === 'number') width = a[a.length - 1]; break;
      case 'RG': case 'G': case 'K': case 'SC': case 'SCN': color = a.filter((v) => typeof v === 'number').map((v) => v.toFixed(3)).join(','); break;
      case 'Do': if (a[a.length - 1]?.name) images.push({ name: a[a.length - 1].name, x: ctm[4], y: ctm[5], w: ctm[0], h: ctm[3] }); break;
      case 'm': cur = [at(a[a.length - 2], a[a.length - 1])]; path.push(cur); break;
      case 'l': if (cur) cur.push(at(a[a.length - 2], a[a.length - 1])); break;
      case 'c': case 'v': case 'y': if (cur) cur.push(at(a[a.length - 2], a[a.length - 1])); break;
      case 're': path.push(null); cur = null; break; // rectangles : quadrillage ou cadre, jamais le tracé
      case 'h': break;
      case 'S': case 's': case 'B': case 'B*': case 'b': case 'b*':
        for (const p of path) if (p && p.length > 1) out.push({ color, width, points: p });
        path = []; cur = null; break;
      case 'f': case 'F': case 'f*': case 'n': path = []; cur = null; break;
      default: break;
    }
  }
  return { lines: out, images };
}

/** Remet bout à bout les morceaux d'un même trait (certains PDF dessinent segment par segment). */
function chain(list) {
  const out = [];
  for (const s of list) {
    const last = out[out.length - 1];
    const end = last?.points[last.points.length - 1];
    const [x, y] = s.points[0];
    if (last && last.color === s.color && Math.abs(end[0] - x) < 0.05 && Math.abs(end[1] - y) < 0.05) last.points.push(...s.points.slice(1));
    else out.push({ ...s, points: [...s.points] });
  }
  return out;
}

/** Un trait qui ressemble à un ECG : beaucoup de points, qui avancent de gauche à droite. */
function ecgLike(s) {
  const p = s.points;
  if (p.length < 150) return false;
  let forward = 0;
  for (let i = 1; i < p.length; i++) if (p[i][0] >= p[i - 1][0] - 1e-6) forward++;
  const ys = p.map((q) => q[1]);
  return forward / (p.length - 1) > 0.97 && Math.max(...ys) - Math.min(...ys) > 3;
}

/** Bandes du tracé, de haut en bas : chaque bande = points [x, y] de gauche à droite. */
export function traceRows(allStrokes) {
  const traces = chain(allStrokes).filter(ecgLike);
  if (!traces.length) return [];
  // La couleur qui porte le plus de points est celle du tracé.
  const byColor = new Map();
  for (const t of traces) byColor.set(t.color, (byColor.get(t.color) ?? 0) + t.points.length);
  const color = [...byColor].sort((a, b) => b[1] - a[1])[0][0];
  const pieces = traces.filter((t) => t.color === color).map((t) => {
    const ys = t.points.map((q) => q[1]).sort((a, b) => a - b);
    return { points: t.points, mid: ys[Math.floor(ys.length / 2)], x0: t.points[0][0] };
  });
  // Les morceaux à la même hauteur forment une bande.
  pieces.sort((a, b) => b.mid - a.mid || a.x0 - b.x0);
  const rows = [];
  for (const p of pieces) {
    const row = rows.find((r) => Math.abs(r.mid - p.mid) < 15);
    if (row) row.parts.push(p);
    else rows.push({ mid: p.mid, parts: [p] });
  }
  return rows.map((r) => r.parts.sort((a, b) => a.x0 - b.x0).flatMap((p) => p.points));
}

/** Rééchantillonne une bande à pas régulier (interpolation linéaire). */
function resample(points, ptPerSecond, fs) {
  const x0 = points[0][0];
  const seconds = (points[points.length - 1][0] - x0) / ptPerSecond;
  const n = Math.floor(seconds * fs);
  const out = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const x = x0 + (i / fs) * ptPerSecond;
    while (j < points.length - 2 && points[j + 1][0] < x) j++;
    const [xa, ya] = points[j];
    const [xb, yb] = points[j + 1];
    out[i] = xb > xa ? ya + ((yb - ya) * (x - xa)) / (xb - xa) : yb;
  }
  return out;
}

/**
 * Le trait noir d'une bande d'ECG en image, colonne par colonne.
 * Renvoie le signal (en pixels, vers le haut) sur la plus longue portion
 * continue du trait : le créneau d'étalonnage du début, séparé du tracé, est laissé de côté.
 */
export function traceFromPixels(rgb, alpha, width, height, channels = 3) {
  const px = (i, c) => {
    const v = rgb[i * channels + (channels === 1 ? 0 : c)];
    const a = alpha ? alpha[i] / 255 : 1;
    return v * a + 255 * (1 - a);
  };
  // Le quadrillage rose : ses lignes horizontales bornent la zone du tracé (les graduations sont dessous).
  const gridRows = [];
  for (let y = 0; y < height; y++) {
    let pink = 0;
    for (let x = 0; x < width; x += 3) {
      const i = y * width + x;
      const r = px(i, 0);
      if (r > 150 && r - px(i, 1) > 18) pink++;
    }
    if (pink > width / 3 / 2) gridRows.push(y);
  }
  const top = gridRows.length ? gridRows[0] : 0;
  const bottom = gridRows.length ? gridRows[gridRows.length - 1] : height - 1;
  // Pour chaque colonne : le haut et le bas du trait noir.
  const hi = new Float64Array(width).fill(NaN);
  const lo = new Float64Array(width).fill(NaN);
  for (let x = 0; x < width; x++) {
    for (let y = top; y <= bottom; y++) {
      const i = y * width + x;
      if (Math.max(px(i, 0), px(i, 1), px(i, 2)) < 128) {
        if (Number.isNaN(hi[x])) hi[x] = y;
        lo[x] = y;
      }
    }
  }
  // La plus longue suite de colonnes où le trait est présent (trous de 6 pixels au plus).
  let best = [0, -1];
  let start = -1;
  let gap = 0;
  for (let x = 0; x <= width; x++) {
    const on = x < width && !Number.isNaN(hi[x]);
    if (on) { if (start < 0) start = x; gap = 0; } else if (start >= 0 && (++gap > 6 || x === width)) {
      const end = x - gap;
      if (end - start > best[1] - best[0]) best = [start, end];
      start = -1;
    }
  }
  const [x0, x1] = best;
  if (x1 - x0 < width * 0.3) return null;
  // Valeur de la colonne : le point du trait le plus éloigné de la ligne de base,
  // pour garder le sommet des pics (vers le haut comme vers le bas).
  const mid = [];
  for (let x = x0; x <= x1; x++) mid.push(Number.isNaN(hi[x]) ? null : (hi[x] + lo[x]) / 2);
  for (let i = 0; i < mid.length; i++) if (mid[i] == null) { // trous : on relie les deux bords
    let j = i;
    while (j < mid.length && mid[j] == null) j++;
    const a = mid[i - 1] ?? mid[j];
    const b = mid[j] ?? a;
    for (let k = i; k < j; k++) mid[k] = a + ((b - a) * (k - i + 1)) / (j - i + 1);
    i = j;
  }
  const w = 151;
  const signal = new Float64Array(mid.length);
  let sum = 0;
  const pre = [0];
  for (const v of mid) pre.push((sum += v));
  for (let i = 0; i < mid.length; i++) {
    const a = Math.max(0, i - w);
    const b = Math.min(mid.length, i + w + 1);
    const base = (pre[b] - pre[a]) / (b - a);
    const x = x0 + i;
    if (Number.isNaN(hi[x])) { signal[i] = -mid[i]; continue; }
    signal[i] = base - hi[x] > lo[x] - base ? -hi[x] : -lo[x];
  }
  return { signal, x0, x1 };
}

const PT_PER_SECOND = PAPER_SPEED_MM_S * PT_PER_MM;

/** Les bandes d'ECG posées en image : larges (≥ 150 mm), très allongées. */
async function rasterSegments(pdf, images) {
  const strips = images.filter((im) => im.w >= 150 * PT_PER_MM && Math.abs(im.h) >= 15 * PT_PER_MM && im.w / Math.abs(im.h) > 4).sort((a, b) => b.y - a.y);
  if (!strips.length) return null;
  const objOf = (name) => {
    const m = new RegExp(`/${name}\\s+(\\d+)\\s+0\\s+R`).exec(pdf.text);
    return m ? pdf.streams.find((s) => s.num === Number(m[1]) && s.image) : null;
  };
  const segments = [];
  let fs = null;
  for (const im of strips) {
    const obj = objOf(im.name);
    if (!obj) continue;
    const width = Number(/\/Width\s+(\d+)/.exec(obj.dict)?.[1]);
    const height = Number(/\/Height\s+(\d+)/.exec(obj.dict)?.[1]);
    if (!/\/BitsPerComponent\s+8/.test(obj.dict)) continue;
    const data = await decode(obj);
    if (!data) throw new Error('Image du tracé dans un format que je ne sais pas lire.');
    const channels = data.length >= width * height * 3 ? 3 : 1;
    const maskNum = /\/SMask\s+(\d+)\s+0\s+R/.exec(obj.dict)?.[1];
    const mask = maskNum ? pdf.streams.find((s) => s.num === Number(maskNum)) : null;
    const alpha = mask ? await decode(mask) : null;
    const t = traceFromPixels(data, alpha, width, height, channels);
    if (!t) continue;
    // Pixels par seconde : largeur de l'image / durée de la bande sur le papier (25 mm/s).
    const rate = width / (im.w / PT_PER_SECOND);
    fs ??= rate;
    segments.push(t.signal);
  }
  return segments.length ? { segments, fs, seconds: Math.round((strips.reduce((s, im) => s + im.w, 0) / PT_PER_SECOND) * 10) / 10, scale: 'papier', kind: 'image' } : null;
}

/** Date du PDF (jour où il a été créé sur le téléphone), en date locale. */
function pdfDate(text) {
  const m = /\/CreationDate\s*\(D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?\d{2}'?)?/.exec(text);
  if (!m) return null;
  const [, y, mo, d, h = '12', mi = '00', s = '00', tz] = m;
  let iso = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  if (tz === 'Z') iso += 'Z';
  else if (tz) iso += `${tz.slice(0, 3)}:${tz.replace(/'/g, '').slice(3, 5) || '00'}`;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
}

/**
 * Le tracé d'un ECG en PDF → { segments: [Float64Array…], fs, seconds, scale, kind, date }.
 * Une bande = un segment : les intervalles entre battements ne sont mesurés
 * qu'à l'intérieur d'une bande (le passage d'une ligne à l'autre n'est pas fiable).
 */
export async function readEcgPdf(bytes, { expectedSeconds = 30 } = {}) {
  if (latin1(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('Ce fichier n’est pas un PDF.');
  const pdf = pdfStreams(bytes);
  const lines = [];
  const images = [];
  for (const s of pdf.streams) {
    if (s.image) continue;
    let data;
    try { data = await decode(s); } catch { continue; }
    if (!data) continue;
    const src = latin1(data);
    if (!/\b(l|c|Do)\b/.test(src)) continue;
    const d = drawing(src);
    lines.push(...d.lines);
    images.push(...d.images);
  }
  const date = pdfDate(pdf.text);
  const raster = await rasterSegments(pdf, images);
  if (raster) return { ...raster, date };
  const rows = traceRows(lines);
  if (!rows.length) throw new Error('Pas de tracé d’ECG trouvé dans ce PDF. Exporte-le depuis l’appli Withings : ton ECG → « Partager le PDF avec mon médecin ».');
  const width = rows.reduce((s, r) => s + (r[r.length - 1][0] - r[0][0]), 0);
  // Échelle du papier ECG : 25 mm par seconde. Si la page a été réduite, on se cale sur la durée de l'ECG.
  let ptPerSecond = PT_PER_SECOND;
  let scale = 'papier';
  const seconds = width / ptPerSecond;
  if (seconds < expectedSeconds * 0.6 || seconds > expectedSeconds * 1.4) {
    ptPerSecond = width / expectedSeconds;
    scale = 'durée';
  }
  const segments = rows.map((r) => resample(r, ptPerSecond, RESAMPLE_HZ));
  return { segments, fs: RESAMPLE_HZ, seconds: Math.round((width / ptPerSecond) * 10) / 10, scale, kind: 'traits', date };
}

/** Point d'entrée : un fichier exporté de l'appli Withings → { segments, fs, seconds, date, at, hr }. */
export async function readEcgFile(bytes, name = '') {
  if (!/\.pdf$/i.test(name) && latin1(bytes.subarray(0, 5)) !== '%PDF-') {
    throw new Error('Format non reconnu : Enduro lit le PDF de l’ECG exporté depuis l’appli Withings.');
  }
  const rec = await readEcgPdf(bytes);
  // L'heure et le pouls affichés par Withings sont écrits en image dans le PDF : on ne les lit pas.
  return { ...rec, at: null, hr: null };
}
