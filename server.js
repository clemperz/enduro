#!/usr/bin/env node
// Enduro — serveur local. Aucune dépendance : `node server.js` suffit.
//
//   --port 5180          port d'écoute
//   --host 127.0.0.1     0.0.0.0 pour ouvrir l'app depuis le téléphone (même Wi-Fi)
//   --data ./data        dossier des données
//   --zwift ~/Documents/Zwift   dossier de Zwift
//   --open               ouvre l'app dans le navigateur une fois prête

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { homedir, networkInterfaces, hostname } from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createStore } from './server/store.js';
import { zwiftStatus, readNewRides, reanalyzeRides, writeWorkout, removeWorkout } from './server/zwift.js';
import { createBackend, ApiError } from './public/core/backend.js';
import { airdropInstalled } from './server/zwift-airdrop.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(ROOT, 'public');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const PORT = Number(arg('port', process.env.PORT ?? 5180));
const HOST = arg('host', process.env.HOST ?? '127.0.0.1');
const DATA_DIR = resolve(arg('data', join(ROOT, 'data')));
const ZWIFT_DIR = resolve(arg('zwift', join(homedir(), 'Documents', 'Zwift')).replace(/^~(?=$|\/)/, homedir()));
const OPEN = process.argv.includes('--open');

function openBrowser() {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(cmd, [`http://localhost:${PORT}`], () => {});
}

const store = createStore(DATA_DIR);
const oauthStates = new Set();

// ---------------------------------------------------------------------------
// Petits outils HTTP
// ---------------------------------------------------------------------------

const HttpError = ApiError;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function lanAddresses() {
  return Object.values(networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
}

function allowedHosts() {
  const names = ['localhost', '127.0.0.1', '[::1]'];
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    names.push(...lanAddresses(), hostname(), hostname().replace(/\.local$/, '') + '.local');
  }
  return new Set(names.flatMap((n) => [`${n}:${PORT}`, n]));
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw new HttpError(413, 'Envoi trop volumineux');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Requête illisible');
  }
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const file = resolve(PUBLIC, rel);
  if (file !== PUBLIC && !file.startsWith(PUBLIC + sep)) throw new HttpError(403, 'Interdit');
  try {
    const data = await readFile(file);
    send(res, 200, data, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  } catch {
    throw new HttpError(404, 'Page introuvable');
  }
}

// ---------------------------------------------------------------------------
// Ce que fait chaque demande : public/core/backend.js (le même code tourne
// dans le téléphone, sans serveur). Ici, on le relie au disque et au dossier Zwift.
// ---------------------------------------------------------------------------

const backend = createBackend({
  state: store.state,
  secrets: store.secrets,
  save: () => store.save(),
  saveSecrets: () => store.saveSecrets(),
  keepCopy: (reason) => store.keepCopy(reason),
  zwift: {
    status: () => zwiftStatus(ZWIFT_DIR),
    readNewRides: (known) => readNewRides(ZWIFT_DIR, known),
    reanalyze: (activities) => reanalyzeRides(ZWIFT_DIR, activities),
    write: (fileName, xml) => writeWorkout(ZWIFT_DIR, fileName, xml),
    remove: (fileName) => removeWorkout(ZWIFT_DIR, fileName),
  },
  oauth: {
    add(token, ttl) {
      oauthStates.add(token);
      setTimeout(() => oauthStates.delete(token), ttl).unref();
    },
    take: (token) => oauthStates.delete(token),
  },
  stravaRedirect: () => `http://localhost:${PORT}/api/strava/callback`,
  withingsDefaultRedirect: () => `http://localhost:${PORT}/api/withings/callback`,
  device: () => ({
    mode: 'mac', port: PORT, shared: HOST !== '127.0.0.1' && HOST !== 'localhost', addresses: lanAddresses(), airdrop: airdropInstalled(),
  }),
  log: (message) => console.error(message),
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });
const redirect = (res, location) => { res.writeHead(302, { Location: location }); res.end(); };
const DAY = '(\\d{4}-\\d{2}-\\d{2})';

route('GET', /^\/api\/state$/, () => backend.publicState());
route('PUT', /^\/api\/profile$/, ({ body }) => backend.saveProfile(body));
route('PUT', /^\/api\/plan$/, ({ body }) => backend.savePlan(body));
route('PUT', new RegExp(`^/api/checkins/${DAY}$`), ({ body, params }) => backend.saveCheckin(params[0], body));

route('POST', /^\/api\/activities$/, ({ body }) => backend.addActivity(body));
route('POST', /^\/api\/activities\/import$/, ({ body }) => backend.importActivities(body));
route('PATCH', /^\/api\/activities\/(.+)$/, ({ body, params }) => backend.patchActivity(decodeURIComponent(params[0]), body));
route('DELETE', /^\/api\/activities\/(.+)$/, ({ params }) => backend.deleteActivity(decodeURIComponent(params[0])));

route('POST', /^\/api\/zwift\/import$/, () => backend.zwiftImport());
route('POST', /^\/api\/zwift\/export$/, ({ body }) => backend.zwiftExport(body));
route('DELETE', /^\/api\/zwift\/workouts\/([\w.-]+)$/, ({ params }) => backend.zwiftRemove(params[0]));

route('POST', /^\/api\/strava\/config$/, ({ body }) => backend.stravaConfig(body));
route('GET', /^\/api\/strava\/login$/, ({ res }) => { redirect(res, backend.stravaLoginUrl()); return undefined; });
route('GET', /^\/api\/strava\/callback$/, async ({ res, query }) => {
  const result = await backend.stravaCallback({
    code: query.get('code'), state: query.get('state'), error: query.get('error'), scope: query.get('scope'),
  });
  redirect(res, `/#/profil?strava=${result}`);
  return undefined;
});
route('POST', /^\/api\/strava\/sync$/, () => backend.stravaSync());
route('POST', /^\/api\/strava\/disconnect$/, ({ body }) => backend.stravaDisconnect(body));

route('POST', /^\/api\/withings\/config$/, ({ body }) => backend.withingsConfig(body));
route('GET', /^\/api\/withings\/login$/, ({ res }) => { redirect(res, backend.withingsLoginUrl()); return undefined; });
route('GET', /^\/api\/withings\/callback$/, async ({ res, query }) => {
  const result = await backend.withingsAuthorized({ code: query.get('code'), state: query.get('state'), error: query.get('error') });
  redirect(res, `/#/profil?withings=${result}`);
  return undefined;
});
route('POST', /^\/api\/withings\/code$/, ({ body }) => backend.withingsCode(body));
route('POST', /^\/api\/withings\/sync$/, () => backend.withingsSync());
route('POST', /^\/api\/withings\/disconnect$/, ({ body }) => backend.withingsDisconnect(body));

route('PUT', new RegExp(`^/api/ecg/${DAY}$`), ({ body, params }) => backend.saveEcg(params[0], body));
route('DELETE', new RegExp(`^/api/ecg/${DAY}$`), ({ params }) => backend.deleteEcg(params[0]));

route('GET', /^\/api\/export$/, ({ res }) => {
  const { fileName, json } = backend.exportData();
  send(res, 200, json, { 'Content-Disposition': `attachment; filename="${fileName}"` });
  return undefined;
});
route('POST', /^\/api\/restore$/, ({ body }) => backend.restore(body));
route('POST', /^\/api\/reset$/, ({ body }) => backend.reset(body));

// ---------------------------------------------------------------------------
// Serveur
// ---------------------------------------------------------------------------

const hosts = allowedHosts();

const server = createServer(async (req, res) => {
  try {
    // Protection contre les sites tiers : seul un navigateur ouvert sur l'app peut parler à l'API.
    if (!hosts.has(req.headers.host ?? '')) throw new HttpError(403, 'Adresse non autorisée');
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Méthode non autorisée');
      await serveStatic(req, res, url.pathname);
      return;
    }
    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Origine non autorisée');
      if (req.headers['x-requested-with'] !== 'enduro') throw new HttpError(403, 'Requête non autorisée');
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.pattern);
      if (!m) continue;
      const body = req.method === 'GET' ? {} : await readBody(req);
      const result = await r.handler({ req, res, body, params: m.slice(1), query: url.searchParams });
      if (result !== undefined) send(res, 200, result);
      return;
    }
    throw new HttpError(404, 'Route inconnue');
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Erreur interne du serveur' : err.message });
    else res.end();
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Le port ${PORT} est déjà utilisé : Enduro tourne sans doute déjà. Ouvre http://localhost:${PORT}`);
    if (OPEN) openBrowser();
    setTimeout(() => process.exit(1), 300);
    return;
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Enduro est prêt  →  http://localhost:${PORT}\n`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    for (const ip of lanAddresses()) console.log(`  Depuis ton téléphone (même Wi-Fi)  →  http://${ip}:${PORT}`);
  }
  console.log(`  Données : ${DATA_DIR}`);
  console.log(`  Zwift   : ${zwiftStatus(ZWIFT_DIR).found ? ZWIFT_DIR : 'non trouvé'}\n`);
  console.log('  Pour arrêter : Ctrl + C (ou ferme cette fenêtre).\n');
  if (OPEN) openBrowser();
});
