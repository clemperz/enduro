// Connexion Strava (facultative) : OAuth + lecture des activités.
// L'utilisateur crée sa propre « application API » sur strava.com/settings/api ;
// ses identifiants restent sur l'appareil qui fait tourner Enduro (Mac ou téléphone).

const AUTHORIZE = 'https://www.strava.com/oauth/authorize';
const TOKEN = 'https://www.strava.com/oauth/token';
const API = 'https://www.strava.com/api/v3';

const BIKE = new Set(['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide', 'EBikeRide', 'EMountainBikeRide', 'Velomobile', 'Handcycle']);
const RUN = new Set(['Run', 'TrailRun', 'VirtualRun']);

export function authorizeUrl(clientId, redirectUri, state) {
  const q = new URLSearchParams({
    client_id: String(clientId),
    response_type: 'code',
    redirect_uri: redirectUri,
    approval_prompt: 'auto',
    scope: 'activity:read_all',
    state,
  });
  return `${AUTHORIZE}?${q}`;
}

async function tokenRequest(params) {
  const res = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Strava a refusé la connexion (${res.status}) : ${body.message ?? 'vérifie le Client ID et le Client Secret'}`);
  }
  return body;
}

export async function exchangeCode(secrets, code) {
  const t = await tokenRequest({
    client_id: secrets.clientId, client_secret: secrets.clientSecret, code, grant_type: 'authorization_code',
  });
  Object.assign(secrets, { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: t.expires_at });
  return t.athlete ?? null;
}

/** Renvoie un jeton valide, en le renouvelant s'il expire dans moins de 5 minutes. */
export async function freshToken(secrets, save) {
  if (!secrets.refreshToken) throw new Error('Strava n’est pas connecté');
  if (secrets.accessToken && secrets.expiresAt - 300 > Date.now() / 1000) return secrets.accessToken;
  const t = await tokenRequest({
    client_id: secrets.clientId, client_secret: secrets.clientSecret, grant_type: 'refresh_token', refresh_token: secrets.refreshToken,
  });
  Object.assign(secrets, { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: t.expires_at });
  save();
  return secrets.accessToken;
}

/** Activités depuis `afterEpoch` (au plus 10 pages de 100). */
export async function fetchActivities(token, afterEpoch) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const q = new URLSearchParams({ after: String(Math.floor(afterEpoch)), per_page: '100', page: String(page) });
    const res = await fetch(`${API}/athlete/activities?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 429) throw new Error('Limite de requêtes Strava atteinte : réessaie dans un quart d’heure.');
    if (!res.ok) throw new Error(`Strava a répondu ${res.status}`);
    const list = await res.json();
    out.push(...list);
    if (list.length < 100) break;
  }
  return out;
}

/** Activité Strava (résumé) → activité Enduro. */
export function mapStravaActivity(a) {
  const type = a.sport_type ?? a.type ?? '';
  const sport = BIKE.has(type) ? 'bike' : RUN.has(type) ? 'run' : 'other';
  const start = String(a.start_date_local ?? a.start_date ?? '').replace('Z', '').slice(0, 19);
  const hasPower = a.device_watts === true;
  const round = (v) => (v == null ? null : Math.round(v));
  return {
    id: `strava:${a.id}`,
    stravaId: a.id,
    source: 'strava',
    sport,
    indoor: !!a.trainer || type.startsWith('Virtual'),
    name: a.name ?? '',
    start,
    date: start.slice(0, 10),
    startEpoch: a.start_date ? Math.floor(Date.parse(a.start_date) / 1000) : null,
    durationSec: a.moving_time ?? a.elapsed_time ?? 0,
    distanceKm: a.distance != null ? Math.round(a.distance / 10) / 100 : null,
    elevationM: round(a.total_elevation_gain),
    avgPower: hasPower ? round(a.average_watts) : null,
    np: hasPower ? round(a.weighted_average_watts) : null,
    maxPower: hasPower ? round(a.max_watts) : null,
    avgHr: a.has_heartrate === false ? null : round(a.average_heartrate),
    maxHr: a.has_heartrate === false ? null : round(a.max_heartrate),
    avgCadence: round(a.average_cadence),
    // Activité marquée « compétition » dans Strava : un effort maximal, précieux pour les estimations.
    ...((sport === 'run' && a.workout_type === 1) || (sport === 'bike' && a.workout_type === 11) ? { race: true } : {}),
  };
}

/** Détail d'une activité (pour les meilleurs temps d'une course). null si elle n'existe plus. */
export async function fetchActivityDetail(token, id) {
  const res = await fetch(`${API}/activities/${id}?include_all_efforts=false`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) {
    const err = new Error('Limite de requêtes Strava atteinte');
    err.rateLimited = true;
    throw err;
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Strava a répondu ${res.status}`);
  return res.json();
}

/** Meilleurs temps Strava d'une course : { distance en mètres : secondes }. */
export function mapBestEfforts(list) {
  const out = {};
  for (const e of Array.isArray(list) ? list : []) {
    const meters = Math.round(Number(e.distance));
    const sec = Number(e.elapsed_time ?? e.moving_time);
    if (meters > 0 && sec > 0) out[meters] = sec;
  }
  return out;
}
