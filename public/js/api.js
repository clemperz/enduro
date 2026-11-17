// Dialogue avec les données d'Enduro. Deux façons de tourner, mêmes réponses :
// - sur le Mac, un petit serveur local (server.js) garde tout dans data/ ;
// - en ligne (sur le téléphone), il n'y a pas de serveur : tout tourne dans le
//   navigateur et reste dans son stockage (local.js).

import { createLocalBackend } from './local.js';

async function call(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'enduro' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
  return json;
}

const http = {
  state: () => call('GET', 'api/state'),
  saveProfile: (profile) => call('PUT', 'api/profile', profile),
  savePlan: (plan) => call('PUT', 'api/plan', plan),
  saveCheckin: (date, checkin) => call('PUT', `api/checkins/${date}`, checkin ?? { feel: null }),
  addActivity: (activity) => call('POST', 'api/activities', activity),
  patchActivity: (id, patch) => call('PATCH', `api/activities/${encodeURIComponent(id)}`, patch),
  deleteActivity: (id) => call('DELETE', `api/activities/${encodeURIComponent(id)}`),
  importActivities: (activities) => call('POST', 'api/activities/import', { activities }),
  zwiftImport: () => call('POST', 'api/zwift/import', {}),
  zwiftExport: (sessions) => call('POST', 'api/zwift/export', { sessions }),
  zwiftRemove: (fileName) => call('DELETE', `api/zwift/workouts/${encodeURIComponent(fileName)}`),
  stravaConfig: (clientId, clientSecret) => call('POST', 'api/strava/config', { clientId, clientSecret }),
  stravaSync: () => call('POST', 'api/strava/sync', {}),
  stravaDisconnect: (forget) => call('POST', 'api/strava/disconnect', { forget }),
  withingsConfig: (clientId, clientSecret, redirectUri) => call('POST', 'api/withings/config', { clientId, clientSecret, redirectUri }),
  withingsCode: (url) => call('POST', 'api/withings/code', { url }),
  withingsSync: () => call('POST', 'api/withings/sync', {}),
  withingsDisconnect: (forget) => call('POST', 'api/withings/disconnect', { forget }),
  saveEcg: (date, m) => call('PUT', `api/ecg/${date}`, m),
  deleteEcg: (date) => call('DELETE', `api/ecg/${date}`),
  restore: (backup) => call('POST', 'api/restore', { backup }),
  reset: () => call('POST', 'api/reset', { confirm: 'EFFACER' }),
  loginUrl: (provider) => `api/${provider}/login`,
  exportBackup() {
    const a = document.createElement('a');
    a.href = 'api/export';
    a.download = '';
    document.body.append(a);
    a.click();
    a.remove();
  },
};

/** Adresse de l'application, sans « ?… » ni « #… » : c'est là que Strava et Withings renvoient. */
function appUrl() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

/** Enregistre un fichier : feuille de partage sur téléphone (AirDrop, Fichiers…), téléchargement ailleurs. */
function saveFile(fileName, text) {
  const file = new File([text], fileName, { type: 'application/json' });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    return navigator.share({ files: [file], title: 'Sauvegarde Enduro' }).catch((err) => {
      if (err.name !== 'AbortError') throw err;
    });
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return undefined;
}

function browserApi() {
  const { backend: b, oauthReturn } = createLocalBackend({ storage: localStorage, appUrl: appUrl(), log: (m) => console.warn(m) });
  // Copies à l'aller et au retour : l'interface et les données enregistrées ne partagent jamais les mêmes objets.
  const run = async (fn) => structuredClone(await fn());
  const copy = (v) => structuredClone(v ?? {});
  return {
    oauthReturn,
    state: () => run(() => b.publicState()),
    saveProfile: (profile) => run(() => b.saveProfile(copy(profile))),
    savePlan: (plan) => run(() => b.savePlan(copy(plan))),
    saveCheckin: (date, checkin) => run(() => b.saveCheckin(date, copy(checkin ?? { feel: null }))),
    addActivity: (activity) => run(() => b.addActivity(copy(activity))),
    patchActivity: (id, patch) => run(() => b.patchActivity(id, copy(patch))),
    deleteActivity: (id) => run(() => b.deleteActivity(id)),
    importActivities: (activities) => run(() => b.importActivities(copy({ activities }))),
    zwiftImport: () => run(() => b.zwiftImport()),
    zwiftExport: (sessions) => run(() => b.zwiftExport(copy({ sessions }))),
    zwiftRemove: (fileName) => run(() => b.zwiftRemove(fileName)),
    stravaConfig: (clientId, clientSecret) => run(() => b.stravaConfig({ clientId, clientSecret })),
    stravaSync: () => run(() => b.stravaSync()),
    stravaDisconnect: (forget) => run(() => b.stravaDisconnect({ forget })),
    withingsConfig: (clientId, clientSecret, redirectUri) => run(() => b.withingsConfig({ clientId, clientSecret, redirectUri })),
    withingsCode: (url) => run(() => b.withingsCode({ url })),
    withingsSync: () => run(() => b.withingsSync()),
    withingsDisconnect: (forget) => run(() => b.withingsDisconnect({ forget })),
    saveEcg: (date, m) => run(() => b.saveEcg(date, copy(m))),
    deleteEcg: (date) => run(() => b.deleteEcg(date)),
    restore: (backup) => run(() => b.restore({ backup: copy(backup) })),
    reset: () => run(() => b.reset({ confirm: 'EFFACER' })),
    loginUrl: (provider) => (provider === 'strava' ? b.stravaLoginUrl() : b.withingsLoginUrl()),
    exportBackup() {
      const { fileName, json } = b.exportData();
      return saveFile(fileName, json);
    },
  };
}

let impl = http;

/**
 * Y a-t-il un serveur Enduro derrière cette page ? Non sur GitHub Pages : la
 * page est seule (réponse qui n'est pas du JSON, ou pas de réseau). Un serveur
 * qui répond une erreur, lui, reste une erreur : on ne bascule pas en douce sur
 * un carnet vide.
 */
async function serverState() {
  let res;
  try {
    res = await fetch('api/state', { headers: { 'X-Requested-With': 'enduro' }, cache: 'no-store' });
  } catch {
    return null;
  }
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
  return json;
}

export const api = {
  /** Vrai quand Enduro tourne sans serveur, dans le navigateur. */
  local: false,

  /**
   * Premier appel : choisit où vivent les données et renvoie l'état. Au retour
   * de Strava ou de Withings (version en ligne), finit la connexion et
   * remplace l'adresse par #/profil?strava=… (ou withings=…).
   */
  async start() {
    const fromServer = await serverState();
    if (fromServer) return fromServer;
    impl = browserApi();
    api.local = true;
    const back = await impl.oauthReturn(location.search);
    if (back) history.replaceState(null, '', `${appUrl()}#/profil?${back.provider}=${back.result}`);
    return impl.state();
  },
};

for (const name of Object.keys(http)) api[name] = (...args) => impl[name](...args);
