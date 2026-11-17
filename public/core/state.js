// Forme des données d'Enduro, la même sur le Mac (data/enduro.json) et dans le
// téléphone (stockage du navigateur).

export function defaultState() {
  return {
    version: 1,
    profile: null,
    plan: null,
    checkins: {},
    activities: [],
    zwift: { ignored: [] },
    strava: { athlete: null, lastSync: null },
    // Nuits mesurées par la montre (Withings) : date du réveil → pouls et VFC.
    nights: {},
    withings: { lastSync: null },
    // ECG de 30 s faits avec la montre, importés à la main : date → VFC et pouls.
    ecg: {},
  };
}

const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/** Complète un état lu (fichier, stockage, sauvegarde) avec ce qui lui manque. */
export function normalizeState(raw) {
  const base = defaultState();
  const state = { ...base, ...(isObject(raw) ? raw : {}) };
  for (const k of ['zwift', 'strava', 'withings']) state[k] = { ...base[k], ...(isObject(state[k]) ? state[k] : {}) };
  for (const k of ['checkins', 'nights', 'ecg']) if (!isObject(state[k])) state[k] = {};
  if (!Array.isArray(state.activities)) state.activities = [];
  if (!Array.isArray(state.zwift.ignored)) state.zwift.ignored = [];
  return state;
}

/**
 * Vérifie qu'un fichier est bien une sauvegarde d'Enduro (« Télécharger une
 * sauvegarde »). Renvoie l'état complété, ou null.
 */
export function readBackup(raw) {
  if (!isObject(raw) || raw.version !== 1) return null;
  if (raw.profile != null && !isObject(raw.profile)) return null;
  if (raw.plan != null && !isObject(raw.plan)) return null;
  if (raw.activities != null && !Array.isArray(raw.activities)) return null;
  if (!raw.profile && !raw.activities?.length) return null;
  return normalizeState(raw);
}
