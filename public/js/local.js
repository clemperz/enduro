// Enduro sans serveur : tout tourne dans le navigateur (le téléphone), et les
// données restent dans son stockage. Les règles sont les mêmes que sur le Mac
// (core/backend.js) ; seul l'endroit où l'on enregistre change.

import { createBackend, ApiError } from '../core/backend.js';
import { normalizeState } from '../core/state.js';

export const KEYS = { state: 'enduro.state', secrets: 'enduro.secrets', oauth: 'enduro.oauth' };

/**
 * `storage` : localStorage (ou un équivalent pour les essais).
 * `appUrl` : adresse de l'application, où Strava et Withings renvoient après l'autorisation.
 */
export function createLocalBackend({ storage, appUrl, log = () => {} }) {
  const read = (key, fallback) => {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch {
      throw new ApiError(507, 'Plus de place pour enregistrer Enduro dans ce navigateur : télécharge une sauvegarde, puis libère de l’espace.');
    }
  };

  const state = normalizeState(read(KEYS.state, {}));
  const secrets = read(KEYS.secrets, {});

  // Demandes de connexion en cours (Strava, Withings) : gardées pendant l'aller-retour vers leur site.
  const pending = () => {
    const now = Date.now();
    return Object.fromEntries(Object.entries(read(KEYS.oauth, {})).filter(([, until]) => until > now));
  };

  const backend = createBackend({
    state,
    secrets,
    save: () => write(KEYS.state, state),
    saveSecrets: () => write(KEYS.secrets, secrets),
    zwift: null,
    oauth: {
      add(token, ttl) { write(KEYS.oauth, { ...pending(), [token]: Date.now() + ttl }); },
      take(token) {
        const list = pending();
        const known = token in list;
        delete list[token];
        write(KEYS.oauth, list);
        return known;
      },
    },
    stravaRedirect: () => appUrl,
    withingsDefaultRedirect: () => appUrl,
    device: () => ({ mode: 'local' }),
    log,
  });

  /**
   * Retour de Strava ou de Withings : l'adresse de l'application porte alors
   * ?code=…&state=…. Renvoie { provider, result } ou null.
   */
  async function oauthReturn(search) {
    const q = new URLSearchParams(search);
    const st = q.get('state');
    if (!st || (!q.get('code') && !q.get('error'))) return null;
    const params = { code: q.get('code'), state: st, error: q.get('error'), scope: q.get('scope') };
    if (st.startsWith('w')) return { provider: 'withings', result: await backend.withingsAuthorized(params) };
    return { provider: 'strava', result: await backend.stravaCallback(params) };
  }

  return { backend, oauthReturn };
}
