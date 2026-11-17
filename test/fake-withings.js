// Faux serveur Withings, pour essayer la connexion sans compte ni montre.
// Il imite ce qu'Enduro utilise : autorisation OAuth, jetons, résumés de sommeil
// et détail des nuits (VFC minute par minute).
//
// Dans les tests : const fake = await startFakeWithings(); … fake.close();
// À la main :     node test/fake-withings.js --port 6500 [--scenario semaine-basse]
//   puis lancer Enduro avec ENDURO_WITHINGS_ACCOUNT=http://127.0.0.1:6500 ENDURO_WITHINGS_API=http://127.0.0.1:6500

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Nuits des 60 derniers jours. VFC d'habitude : 40 ms un jour sur deux, 50 ms l'autre ;
 * ce matin 45 ms. Scénario « semaine-basse » : les 4 dernières nuits à 36 ms.
 * Le résumé donne d'autres valeurs (base − 10) : c'est le détail qui doit être retenu.
 */
export function makeNights({ days = 60, scenario = 'normal', now = new Date() } = {}) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const out = [];
  for (let i = 0; i < days; i++) {
    const wake = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 7, 0, 0);
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i - 1, 23, 0, 0);
    let b = i === 0 ? 45 : i % 2 ? 40 : 50;
    if (scenario === 'semaine-basse' && i <= 3) b = 36;
    const s = Math.floor(start / 1000);
    const e = Math.floor(wake / 1000);
    out.push({
      date: ymd(wake), startdate: s, enddate: e, timezone: tz, model_id: 94, modified: 1, id: 1000 + i,
      data: { total_sleep_time: e - s - 1800, hr_average: 50, hr_min: 44, rmssd_start_avg: b - 10, rmssd_end_avg: b - 10 },
      // Deux tranches de sommeil ; une mesure aberrante (250) que la médiane doit ignorer.
      parts: [
        { startdate: s, enddate: s + 10800, rmssd: { [s + 600]: b - 6, [s + 1200]: b - 4, [s + 1800]: b - 2 }, hr: { [s + 600]: 51, [s + 1200]: 50 } },
        { startdate: s + 10800, enddate: e, rmssd: { [s + 11400]: b, [s + 12000]: b + 2, [s + 12600]: b + 4, [s + 13200]: 250 }, hr: { [s + 11400]: 49 } },
      ],
    });
  }
  return out;
}

export function startFakeWithings({ port = 0, scenario = 'normal', pageSize = 25, log = false } = {}) {
  const nights = makeNights({ scenario });
  const codes = new Map(); // code → { clientId, redirectUri, at }
  const access = new Set();
  const refresh = new Map(); // jeton de renouvellement → clientId
  const calls = { authorize: 0, token: 0, refresh: 0, summary: 0, detail: 0 };
  let rateLimitAfter = null; // nombre de détails servis avant de répondre 601
  let clientSecret = null;

  const reply = (res, body) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const tokens = (clientId) => {
    const a = randomBytes(10).toString('hex');
    const r = randomBytes(10).toString('hex');
    access.add(a);
    refresh.set(r, clientId);
    return { status: 0, body: { userid: 4242, access_token: a, refresh_token: r, expires_in: 10800, scope: 'user.activity', token_type: 'Bearer' } };
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake');
    if (log) console.log(req.method, url.pathname, url.search.slice(0, 80));
    if (req.method === 'GET' && url.pathname === '/oauth2_user/authorize2') {
      calls.authorize += 1;
      const q = url.searchParams;
      if (q.get('response_type') !== 'code' || !q.get('client_id') || !q.get('redirect_uri') || !q.get('state') || q.get('scope') !== 'user.activity') {
        res.writeHead(400); res.end('paramètres invalides'); return;
      }
      // L'utilisateur accepte tout de suite.
      const code = randomBytes(8).toString('hex');
      codes.set(code, { clientId: q.get('client_id'), redirectUri: q.get('redirect_uri'), at: Date.now() });
      const back = new URL(q.get('redirect_uri'));
      back.searchParams.set('code', code);
      back.searchParams.set('state', q.get('state'));
      res.writeHead(302, { Location: back.toString() }); res.end(); return;
    }
    if (req.method !== 'POST') { res.writeHead(404); res.end(); return; }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const p = new URLSearchParams(raw);
    if (url.pathname === '/v2/oauth2' && p.get('action') === 'requesttoken') {
      if (clientSecret && p.get('client_secret') !== clientSecret) return reply(res, { status: 503, error: 'Invalid client' });
      if (p.get('grant_type') === 'authorization_code') {
        calls.token += 1;
        const c = codes.get(p.get('code'));
        codes.delete(p.get('code'));
        if (!c || Date.now() - c.at > 30000 || c.clientId !== p.get('client_id') || c.redirectUri !== p.get('redirect_uri')) {
          return reply(res, { status: 503, error: 'Invalid Params: invalid code' });
        }
        return reply(res, tokens(c.clientId));
      }
      if (p.get('grant_type') === 'refresh_token') {
        calls.refresh += 1;
        const clientId = refresh.get(p.get('refresh_token'));
        if (!clientId) return reply(res, { status: 401, error: 'invalid refresh token' });
        refresh.delete(p.get('refresh_token'));
        return reply(res, tokens(clientId));
      }
    }
    if (url.pathname === '/v2/sleep') {
      const token = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (!access.has(token)) return reply(res, { status: 401, error: 'invalid_token' });
      if (p.get('action') === 'getsummary') {
        calls.summary += 1;
        const from = p.get('startdateymd');
        const to = p.get('enddateymd');
        const list = nights.filter((n) => n.date >= from && n.date <= to).sort((a, b) => a.startdate - b.startdate);
        const offset = Number(p.get('offset') ?? 0);
        const page = list.slice(offset, offset + pageSize).map(({ parts, ...n }) => n);
        return reply(res, { status: 0, body: { series: page, more: offset + pageSize < list.length, offset: offset + pageSize } });
      }
      if (p.get('action') === 'get') {
        if (rateLimitAfter != null && rateLimitAfter <= 0) return reply(res, { status: 601, error: 'Too many requests' });
        if (rateLimitAfter != null) rateLimitAfter -= 1;
        calls.detail += 1;
        const n = nights.find((x) => x.startdate === Number(p.get('startdate')));
        return reply(res, { status: 0, body: { series: n ? n.parts : [] } });
      }
    }
    reply(res, { status: 2554, error: 'Unknown action' });
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        nights,
        calls,
        expireAccessTokens: () => access.clear(),
        rateLimitAfter: (n) => { rateLimitAfter = n; },
        requireSecret: (s) => { clientSecret = s; },
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : fallback;
  };
  const fake = await startFakeWithings({ port: Number(arg('port', 6500)), scenario: arg('scenario', 'normal'), log: true });
  console.log(`Faux Withings prêt → ${fake.url} (scénario ${arg('scenario', 'normal')})`);
}
