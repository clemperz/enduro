// Connexion Withings (facultative) : OAuth 2.0 + lecture des nuits mesurées par
// la montre (pouls moyen et variabilité de la fréquence cardiaque, RMSSD).
// L'utilisateur crée sa propre application sur developer.withings.com ; ses
// identifiants restent sur l'appareil qui fait tourner Enduro (Mac ou téléphone).
//
// ENDURO_WITHINGS_ACCOUNT et ENDURO_WITHINGS_API remplacent les adresses de
// Withings : ils ne servent qu'aux essais (faux serveur Withings).

const ENV = globalThis.process?.env ?? {};
const ACCOUNT = ENV.ENDURO_WITHINGS_ACCOUNT ?? 'https://account.withings.com';
const API = ENV.ENDURO_WITHINGS_API ?? 'https://wbsapi.withings.net';

/** Seul droit demandé : les données d'activité, dont le sommeil. */
export const SCOPE = 'user.activity';

/** En dessous de ce nombre de mesures dans la nuit, la VFC détaillée ne sert pas de repère. */
export const MIN_SAMPLES = 5;

export class WithingsError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.auth = [100, 101, 102, 200, 401].includes(code);
    this.rateLimited = code === 601;
  }
}

export function authorizeUrl(clientId, redirectUri, state) {
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, scope: SCOPE, redirect_uri: redirectUri, state });
  return `${ACCOUNT}/oauth2_user/authorize2?${q}`;
}

/** Toutes les réponses Withings ont la forme { status, body } ; status 0 = tout va bien. */
async function call(path, params, token) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: new URLSearchParams(params),
    });
  } catch {
    throw new WithingsError('Withings ne répond pas : vérifie ta connexion Internet.', -1);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json) throw new WithingsError(`Withings a répondu ${res.status}`, res.status);
  if (json.status !== 0) {
    const err = new WithingsError('', json.status);
    err.message = err.rateLimited
      ? 'Trop de demandes envoyées à Withings : réessaie dans quelques minutes.'
      : err.auth
        ? 'Withings a refusé la connexion : reconnecte-toi.'
        : `Withings a répondu une erreur (code ${json.status}${json.error ? ` : ${json.error}` : ''}).`;
    throw err;
  }
  return json.body ?? {};
}

function keepTokens(w, body) {
  Object.assign(w, {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + Number(body.expires_in ?? 10800),
    userId: body.userid ?? w.userId ?? null,
  });
}

/** Échange le code reçu après l'autorisation (valable 30 secondes) contre des jetons. */
export async function exchangeCode(w, code, redirectUri) {
  try {
    const body = await call('/v2/oauth2', {
      action: 'requesttoken', grant_type: 'authorization_code',
      client_id: w.clientId, client_secret: w.clientSecret, code, redirect_uri: redirectUri,
    });
    keepTokens(w, body);
  } catch (err) {
    if (err.code === -1) throw err;
    throw new WithingsError('Withings a refusé la connexion : vérifie le Client ID, le Client Secret et l’adresse de retour, puis recommence (le code ne vaut que 30 secondes).', err.code);
  }
}

/** Jeton valide, renouvelé s'il expire dans moins de 5 minutes (ou si `force`). */
export async function freshToken(w, save, { force = false } = {}) {
  if (!w?.refreshToken) throw new WithingsError('Withings n’est pas connecté', 0);
  if (!force && w.accessToken && w.expiresAt - 300 > Date.now() / 1000) return w.accessToken;
  const body = await call('/v2/oauth2', {
    action: 'requesttoken', grant_type: 'refresh_token',
    client_id: w.clientId, client_secret: w.clientSecret, refresh_token: w.refreshToken,
  });
  // Le nouveau jeton de renouvellement remplace l'ancien : il faut l'enregistrer tout de suite.
  keepTokens(w, body);
  save();
  return w.accessToken;
}

/**
 * Retrouve le code et le « state » dans l'adresse collée par l'utilisateur
 * (quand la page de retour ne mène pas à Enduro).
 */
export function parsePastedUrl(text) {
  const raw = String(text ?? '').trim();
  try {
    const q = new URL(raw).searchParams;
    return { code: q.get('code'), state: q.get('state'), error: q.get('error') };
  } catch {
    const q = new URLSearchParams(raw.replace(/^[^?]*\?/, ''));
    return { code: q.get('code'), state: q.get('state'), error: q.get('error') };
  }
}

// ---------------------------------------------------------------------------
// Nuits
// ---------------------------------------------------------------------------

/** Date locale (AAAA-MM-JJ) d'un instant, dans le fuseau donné par Withings. */
export function localDate(epoch, timeZone) {
  const d = new Date(epoch * 1000);
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  }
}

const plausible = (v, lo, hi) => (Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : null);
const HR = [30, 130];
const RMSSD = [5, 300];

/**
 * Résumés de sommeil Withings → une nuit par matin. La date d'une nuit est
 * celle du réveil ; s'il y a eu une sieste le même jour, on garde le plus long sommeil.
 */
export function pickNights(series) {
  const byDate = {};
  for (const s of Array.isArray(series) ? series : []) {
    if (!(s?.startdate > 0) || !(s?.enddate > s.startdate)) continue;
    const d = s.data ?? {};
    const sleepSec = Number(d.total_sleep_time ?? d.asleepduration ?? (s.enddate - s.startdate));
    const date = localDate(s.enddate, s.timezone);
    const rmssdStart = plausible(d.rmssd_start_avg, ...RMSSD);
    const rmssdEnd = plausible(d.rmssd_end_avg, ...RMSSD);
    const night = {
      date,
      start: s.startdate,
      end: s.enddate,
      modified: s.modified ?? null,
      sleepMin: Number.isFinite(sleepSec) ? Math.round(sleepSec / 60) : null,
      hrAvg: plausible(d.hr_average, ...HR),
      hrMin: plausible(d.hr_min, ...HR),
      rmssdStart,
      rmssdEnd,
      model: s.model_id ?? null,
    };
    if (!byDate[date] || (night.sleepMin ?? 0) > (byDate[date].sleepMin ?? 0)) byDate[date] = night;
  }
  return Object.values(byDate).sort((a, b) => (a.date < b.date ? -1 : 1));
}

const median = (list) => {
  const v = [...list].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};

/**
 * Détail d'une nuit (Sleep v2 - Get) → VFC de la nuit : la médiane des mesures,
 * moins sensible qu'une moyenne aux mesures ratées. Accepte la forme documentée
 * (un objet) comme la forme réelle (une liste de tranches de sommeil).
 */
export function nightFromSeries(series) {
  const parts = Array.isArray(series) ? series : series ? [series] : [];
  const rmssd = [];
  const hr = [];
  for (const p of parts) {
    for (const v of Object.values(p?.rmssd ?? {})) { const x = plausible(v, ...RMSSD); if (x != null) rmssd.push(x); }
    for (const v of Object.values(p?.hr ?? {})) { const x = plausible(v, ...HR); if (x != null) hr.push(x); }
  }
  return {
    rmssd: rmssd.length >= MIN_SAMPLES ? Math.round(median(rmssd) * 10) / 10 : null,
    samples: rmssd.length,
    hrMedian: hr.length >= MIN_SAMPLES ? Math.round(median(hr)) : null,
  };
}

/** VFC retenue pour la nuit : le détail s'il est assez fourni, sinon les moyennes du résumé. */
export function nightHrv(night) {
  if (night.samples >= MIN_SAMPLES && night.rmssdSeries) return { rmssd: night.rmssdSeries, hrvFrom: 'detail' };
  const both = [night.rmssdStart, night.rmssdEnd].filter((v) => v != null);
  if (both.length) return { rmssd: Math.round((both.reduce((s, v) => s + v, 0) / both.length) * 10) / 10, hrvFrom: 'resume' };
  return { rmssd: null, hrvFrom: null };
}

const SUMMARY_FIELDS = 'total_sleep_time,asleepduration,hr_average,hr_min,rmssd_start_avg,rmssd_end_avg';

/** Résumés de sommeil entre deux dates (AAAA-MM-JJ), toutes pages confondues. */
export async function fetchSummaries(token, fromYmd, toYmd) {
  const out = [];
  let offset = 0;
  for (let page = 0; page < 20; page++) {
    const body = await call('/v2/sleep', {
      action: 'getsummary', startdateymd: fromYmd, enddateymd: toYmd, data_fields: SUMMARY_FIELDS, ...(offset ? { offset: String(offset) } : {}),
    }, token);
    out.push(...(Array.isArray(body.series) ? body.series : []));
    if (!body.more) break;
    offset = body.offset;
  }
  return out;
}

export async function fetchNightDetail(token, start, end) {
  const body = await call('/v2/sleep', {
    action: 'get', startdate: String(start), enddate: String(Math.min(end, start + 86400)), data_fields: 'hr,rmssd',
  }, token);
  return nightFromSeries(body.series);
}

/**
 * Met à jour `nights` (objet date → nuit) avec ce que Withings connaît entre
 * deux dates. Le détail (VFC minute par minute) n'est demandé qu'une fois par
 * nuit ; en cas de limite de requêtes, on reprendra à la synchro suivante.
 */
export async function syncNights(token, nights, { from, to, maxDetails = 80 }) {
  const counts = { added: 0, updated: 0, pending: 0 };
  for (const n of pickNights(await fetchSummaries(token, from, to))) {
    const old = nights[n.date];
    const same = old && old.start === n.start && old.modified === n.modified;
    if (same) continue;
    // Nuit nouvelle ou modifiée (synchro tardive de la montre) : on redemandera son détail.
    nights[n.date] = { ...n, samples: 0, rmssdSeries: null, detail: false, source: 'withings', ...nightHrv({ ...n, samples: 0 }) };
    counts[old ? 'updated' : 'added'] += 1;
  }
  // Les plus récentes d'abord : ce sont elles qui comptent pour le feu du matin.
  const todo = Object.values(nights).filter((n) => n.source === 'withings' && !n.detail)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  let done = 0;
  for (const n of todo) {
    if (done >= maxDetails) break;
    try {
      const d = await fetchNightDetail(token, n.start, n.end);
      Object.assign(n, { samples: d.samples, rmssdSeries: d.rmssd, detail: true });
      if (n.hrAvg == null && d.hrMedian != null) n.hrAvg = d.hrMedian;
      Object.assign(n, nightHrv(n));
      done += 1;
    } catch (err) {
      if (err.rateLimited || err.auth || err.code === -1) throw Object.assign(err, { counts });
      // Une nuit illisible ne bloque pas les autres.
      n.detail = true;
      console.error(`Withings, nuit du ${n.date} : ${err.message}`);
    }
  }
  counts.pending = todo.length - done;
  return counts;
}
