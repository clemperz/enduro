// Ce qu'Enduro fait de chaque demande de l'interface, qu'il tourne sur le Mac
// (server.js la reçoit par HTTP) ou entièrement dans le téléphone (js/local.js).
// Une seule version des règles pour les deux.

import { sanitizeActivity, upsertActivity, upgradeLoads, withLoad } from './activities.js';
import * as strava from './strava.js';
import * as withings from './withings.js';
import { defaultState, readBackup } from './state.js';
import { sessionToZwo, zwoFileName } from '../engine/zwo.js';
import { resolveRefs } from '../engine/zones.js';
import { estimateRefs, testActivityIds } from '../engine/estimate.js';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function randomToken() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * ctx :
 *  state, secrets               les données et les identifiants (modifiés sur place)
 *  save(), saveSecrets()        les enregistrent
 *  keepCopy(raison)             met de côté l'état actuel avant de tout remplacer (facultatif)
 *  zwift                        accès au dossier Zwift du Mac, ou null (téléphone)
 *  oauth                        { add(jeton, duréeMs), take(jeton) → vrai s'il était attendu }
 *  stravaRedirect()             adresse où Strava renvoie après l'autorisation
 *  withingsDefaultRedirect()    adresse où Withings renvoie, si l'utilisateur n'en a pas déclaré d'autre
 *  device()                     ce que l'interface doit savoir de l'appareil (Mac ou téléphone)
 *  log(message)                 erreurs sans conséquence
 */
export function createBackend(ctx) {
  const { state, secrets } = ctx;
  const log = ctx.log ?? (() => {});

  function withingsRedirect() {
    return secrets.withings?.redirectUri || ctx.withingsDefaultRedirect();
  }

  function stravaPublic() {
    return {
      configured: !!(secrets.clientId && secrets.clientSecret),
      connected: !!secrets.refreshToken,
      athlete: state.strava.athlete,
      lastSync: state.strava.lastSync,
    };
  }

  function withingsPublic() {
    return {
      configured: !!(secrets.withings?.clientId && secrets.withings?.clientSecret),
      connected: !!secrets.withings?.refreshToken,
      lastSync: state.withings.lastSync,
      redirectUri: withingsRedirect(),
      customRedirect: !!secrets.withings?.redirectUri,
    };
  }

  /** État envoyé à l'interface (sans les identifiants Strava ni Withings). */
  function publicState() {
    return {
      profile: state.profile,
      plan: state.plan,
      checkins: state.checkins,
      activities: state.activities,
      zwift: ctx.zwift ? ctx.zwift.status() : { found: false },
      strava: stravaPublic(),
      nights: state.nights,
      ecg: state.ecg,
      withings: withingsPublic(),
      server: ctx.device(),
    };
  }

  /** Repères en vigueur : ce qui est saisi, complété par ce qu'on estime d'après les activités. */
  function currentRefs() {
    const today = todayLocal();
    const estimates = estimateRefs(state.activities, state.profile, today, testActivityIds(state.plan));
    return resolveRefs(state.profile, Number(today.slice(0, 4)), estimates);
  }

  function replaceAll(next, reason) {
    ctx.keepCopy?.(reason);
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, next);
    ctx.save();
  }

  function needZwift() {
    if (!ctx.zwift) throw new ApiError(409, 'Zwift se relie depuis Enduro sur le Mac : sur le téléphone, tes sorties Zwift arrivent par Strava.');
    return ctx.zwift;
  }

  /** Vérifie le retour de Withings puis échange le code (valable 30 secondes) contre des jetons. */
  async function withingsAuthorized({ code, state: st, error }) {
    if (!st || !st.startsWith('w') || !ctx.oauth.take(st)) return 'expire';
    if (error || !code) return 'refus';
    try {
      await withings.exchangeCode(secrets.withings, code, withingsRedirect());
    } catch (err) {
      log(err.message);
      return 'erreur';
    }
    ctx.saveSecrets();
    state.withings = { lastSync: null };
    ctx.save();
    return 'ok';
  }

  /**
   * Les fichiers Zwift (.zwo) de séances vélo, sans les déposer nulle part :
   * le téléphone les partage (AirDrop vers le Mac), le Mac les écrit lui-même.
   */
  function zwiftFiles(body) {
    const sessions = Array.isArray(body.sessions) ? body.sessions : [];
    if (!sessions.length) throw new ApiError(400, 'Aucune séance à envoyer');
    const refs = currentRefs();
    const files = sessions.map((s) => {
      if (s?.sport !== 'bike' || !Array.isArray(s.steps) || !s.steps.length || !DATE.test(s.date ?? '')) {
        throw new ApiError(400, 'Seules les séances vélo structurées s’envoient vers Zwift');
      }
      return { sessionId: s.id, fileName: zwoFileName(s), xml: sessionToZwo(s, refs) };
    });
    return { files, ftp: refs.ftp, ftpEstimated: !!refs.est.ftp };
  }

  return {
    publicState,

    saveProfile(body) {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Profil invalide');
      state.profile = body;
      upgradeLoads(state.activities, currentRefs(), todayLocal());
      ctx.save();
      return { profile: state.profile, activities: state.activities };
    },

    savePlan(body) {
      if (!body || typeof body !== 'object' || typeof body.startDate !== 'string') throw new ApiError(400, 'Plan invalide');
      state.plan = body;
      ctx.save();
      return { ok: true };
    },

    saveCheckin(date, body) {
      if (!DATE.test(date ?? '')) throw new ApiError(400, 'Date invalide');
      const feel = Number(body.feel);
      if (body.feel == null) delete state.checkins[date];
      else if (feel >= 1 && feel <= 5) {
        // Pouls de repos (facultatif) : gardé seulement s'il est plausible.
        const pulse = Math.round(Number(body.pulse));
        state.checkins[date] = { feel, sick: !!body.sick, ...(pulse >= 30 && pulse <= 120 ? { pulse } : {}) };
      }
      else throw new ApiError(400, 'Ressenti invalide');
      ctx.save();
      return { checkins: state.checkins };
    },

    addActivity(body) {
      const clean = sanitizeActivity({ ...body, source: 'manual', id: undefined });
      if (!clean) throw new ApiError(400, 'Activité invalide : il faut une date et une durée');
      const activity = withLoad(clean, currentRefs());
      state.activities.push(activity);
      ctx.save();
      return { activity, activities: state.activities };
    },

    importActivities(body) {
      const list = Array.isArray(body.activities) ? body.activities : [];
      const counts = { added: 0, updated: 0, merged: 0, rejected: 0 };
      const refs = currentRefs();
      for (const raw of list) {
        const clean = sanitizeActivity(raw, 'file');
        if (!clean || clean.source === 'manual') { counts.rejected += 1; continue; }
        counts[upsertActivity(state.activities, clean, refs)] += 1;
      }
      // Les nouvelles activités peuvent préciser les repères estimés (VMA, PMA…) : on en fait profiter les charges.
      upgradeLoads(state.activities, currentRefs(), todayLocal());
      ctx.save();
      return { ...counts, activities: state.activities };
    },

    patchActivity(id, body) {
      const i = state.activities.findIndex((a) => a.id === id);
      if (i < 0) throw new ApiError(404, 'Activité introuvable');
      const next = { ...state.activities[i] };
      if ('rpe' in body) next.rpe = body.rpe == null ? null : Math.min(10, Math.max(1, Number(body.rpe)));
      if ('note' in body) next.note = String(body.note ?? '').slice(0, 500);
      if ('durationSec' in body && Number(body.durationSec) > 0) next.durationSec = Math.round(Number(body.durationSec));
      if ('sport' in body && ['bike', 'run', 'other'].includes(body.sport)) next.sport = body.sport;
      state.activities[i] = withLoad(next, currentRefs());
      ctx.save();
      return { activity: state.activities[i], activities: state.activities };
    },

    deleteActivity(id) {
      const before = state.activities.length;
      state.activities = state.activities.filter((a) => a.id !== id);
      if (state.activities.length === before) throw new ApiError(404, 'Activité introuvable');
      // Une sortie Zwift supprimée ne doit pas revenir au prochain import.
      if (id.startsWith('zwift:') && !state.zwift.ignored.includes(id)) state.zwift.ignored.push(id);
      ctx.save();
      return { activities: state.activities };
    },

    // -----------------------------------------------------------------------
    // Zwift (Mac seulement : Enduro lit et écrit directement dans son dossier)
    // -----------------------------------------------------------------------

    zwiftImport() {
      const zwift = needZwift();
      const known = new Set([...state.activities.map((a) => a.id), ...state.zwift.ignored]);
      const { rides, ignored, errors } = zwift.readNewRides(known);
      const counts = { added: 0, updated: 0, merged: 0 };
      const refs = currentRefs();
      for (const ride of rides) counts[upsertActivity(state.activities, ride, refs)] += 1;
      state.zwift.ignored.push(...ignored);
      const reread = zwift.reanalyze(state.activities);
      const upgraded = upgradeLoads(state.activities, currentRefs(), todayLocal());
      if (rides.length || ignored.length || reread || upgraded) ctx.save();
      return { ...counts, errors, activities: state.activities, zwift: zwift.status() };
    },

    zwiftFiles,

    zwiftExport(body) {
      const zwift = needZwift();
      const { files, ftp, ftpEstimated } = zwiftFiles(body);
      for (const f of files) {
        try {
          zwift.write(f.fileName, f.xml);
        } catch (err) {
          throw new ApiError(409, err.message);
        }
      }
      return { files: files.map(({ sessionId, fileName }) => ({ sessionId, fileName })), ftp, ftpEstimated };
    },

    zwiftRemove(fileName) {
      if (!ctx.zwift) return { removed: false };
      if (!/^[\w.-]+$/.test(fileName ?? '')) throw new ApiError(400, 'Nom de fichier invalide');
      try {
        return { removed: ctx.zwift.remove(fileName) };
      } catch (err) {
        throw new ApiError(400, err.message);
      }
    },

    // -----------------------------------------------------------------------
    // Strava (facultatif)
    // -----------------------------------------------------------------------

    stravaConfig(body) {
      const clientId = String(body.clientId ?? '').trim();
      const clientSecret = String(body.clientSecret ?? '').trim();
      if (!/^\d+$/.test(clientId) || clientSecret.length < 20) {
        throw new ApiError(400, 'Le Client ID est un nombre et le Client Secret une longue suite de caractères.');
      }
      Object.assign(secrets, { clientId, clientSecret });
      ctx.saveSecrets();
      return { strava: stravaPublic() };
    },

    stravaLoginUrl() {
      if (!secrets.clientId || !secrets.clientSecret) throw new ApiError(400, 'Renseigne d’abord le Client ID et le Client Secret.');
      const token = `s${randomToken()}`;
      ctx.oauth.add(token, 60 * 60 * 1000);
      return strava.authorizeUrl(secrets.clientId, ctx.stravaRedirect(), token);
    },

    /** Retour de Strava après l'autorisation. Renvoie 'ok' | 'expire' | 'refus' | 'droits' | 'erreur'. */
    async stravaCallback({ code, state: st, error, scope }) {
      if (!st || !ctx.oauth.take(st)) return 'expire';
      if (error || !code) return 'refus';
      if (!String(scope ?? '').includes('activity:read')) return 'droits';
      try {
        const athlete = await strava.exchangeCode(secrets, code);
        ctx.saveSecrets();
        state.strava.athlete = athlete ? { name: [athlete.firstname, athlete.lastname].filter(Boolean).join(' ') } : { name: '' };
        ctx.save();
        return 'ok';
      } catch (err) {
        log(err.message);
        return 'erreur';
      }
    },

    async stravaSync() {
      let token;
      try {
        token = await strava.freshToken(secrets, () => ctx.saveSecrets());
      } catch (err) {
        throw new ApiError(409, err.message);
      }
      // Première fois : 120 jours d'historique. Ensuite : depuis la dernière synchro, avec 3 jours de marge.
      const now = Math.floor(Date.now() / 1000);
      const after = state.strava.lastSync ? state.strava.lastSync - 3 * 86400 : now - 120 * 86400;
      let list;
      try {
        list = await strava.fetchActivities(token, after);
      } catch (err) {
        throw new ApiError(502, err.message);
      }
      const counts = { added: 0, updated: 0, merged: 0 };
      const refs = currentRefs();
      for (const a of list) {
        const mapped = strava.mapStravaActivity(a);
        if (!mapped.date || !mapped.durationSec) continue;
        counts[upsertActivity(state.activities, mapped, refs)] += 1;
      }
      // Meilleurs temps (1 km, 5 km…) des courses à pied : une requête par course, une seule fois.
      const pending = state.activities.filter((a) => a.sport === 'run' && a.stravaId && !a.stravaDetail).slice(0, 40);
      for (const a of pending) {
        try {
          const detail = await strava.fetchActivityDetail(token, a.stravaId);
          a.runBest = strava.mapBestEfforts(detail?.best_efforts);
          a.stravaDetail = 1;
        } catch (err) {
          if (err.rateLimited) break; // on reprendra à la prochaine synchro
          log(`Détail Strava ${a.stravaId} : ${err.message}`);
        }
      }
      upgradeLoads(state.activities, currentRefs(), todayLocal());
      state.strava.lastSync = now;
      ctx.save();
      return { ...counts, activities: state.activities, strava: stravaPublic() };
    },

    stravaDisconnect(body) {
      for (const k of ['accessToken', 'refreshToken', 'expiresAt']) delete secrets[k];
      if (body.forget) { delete secrets.clientId; delete secrets.clientSecret; }
      ctx.saveSecrets();
      state.strava = { athlete: null, lastSync: null };
      ctx.save();
      return { strava: stravaPublic() };
    },

    // -----------------------------------------------------------------------
    // Withings (facultatif) : les nuits de la montre — pouls et VFC
    // -----------------------------------------------------------------------

    withingsConfig(body) {
      const clientId = String(body.clientId ?? '').trim();
      const clientSecret = String(body.clientSecret ?? '').trim();
      const redirectUri = String(body.redirectUri ?? '').trim();
      if (!/^[\w-]{16,}$/.test(clientId) || !/^[\w-]{16,}$/.test(clientSecret)) {
        throw new ApiError(400, 'Le Client ID et le Client Secret sont deux longues suites de lettres et de chiffres, sans espace.');
      }
      if (redirectUri && !/^https?:\/\/[^\s/]+[^\s]*$/.test(redirectUri)) {
        throw new ApiError(400, 'L’adresse de retour doit commencer par https:// (ou http://).');
      }
      const prev = secrets.withings ?? {};
      // Autre application Withings : les anciens jetons ne valent plus rien.
      const same = prev.clientId === clientId;
      secrets.withings = { ...(same ? prev : {}), clientId, clientSecret, redirectUri: redirectUri || null };
      ctx.saveSecrets();
      return { withings: withingsPublic() };
    },

    withingsLoginUrl() {
      const w = secrets.withings;
      if (!w?.clientId || !w?.clientSecret) throw new ApiError(400, 'Renseigne d’abord le Client ID et le Client Secret.');
      const token = `w${randomToken()}`;
      // L'autorisation doit être faite dans le quart d'heure.
      ctx.oauth.add(token, 15 * 60 * 1000);
      return withings.authorizeUrl(w.clientId, withingsRedirect(), token);
    },

    withingsAuthorized,

    // Quand la page de retour ne mène pas à Enduro : l'utilisateur colle l'adresse affichée par son navigateur.
    async withingsCode(body) {
      const result = await withingsAuthorized(withings.parsePastedUrl(body.url));
      const messages = {
        expire: 'Cette adresse ne correspond pas à la dernière demande de connexion : clique à nouveau sur « Connecter Withings ».',
        refus: 'Connexion annulée côté Withings (l’adresse collée ne contient pas de code).',
        erreur: 'Withings a refusé le code : il ne vaut que 30 secondes. Clique à nouveau sur « Connecter Withings » et colle l’adresse plus vite.',
      };
      if (result !== 'ok') throw new ApiError(400, messages[result]);
      return { withings: withingsPublic() };
    },

    async withingsSync() {
      const w = secrets.withings;
      if (!w?.refreshToken) throw new ApiError(409, 'Withings n’est pas connecté.');
      const today = todayLocal();
      const day = (offset) => new Date(Date.parse(`${today}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
      // Première fois : deux mois de nuits, pour connaître tout de suite ton habitude. Ensuite : les derniers jours.
      const since = state.withings.lastSync ? new Date(state.withings.lastSync * 1000 - 3 * 86400000).toISOString().slice(0, 10) : day(-60);
      const from = since < day(-60) ? day(-60) : since > day(-3) ? day(-3) : since;
      const run = async (force) => withings.syncNights(
        await withings.freshToken(w, () => ctx.saveSecrets(), { force }), state.nights, { from, to: day(1) },
      );
      let counts;
      let warning = null;
      try {
        try {
          counts = await run(false);
        } catch (err) {
          if (!err.auth) throw err;
          counts = await run(true); // jeton refusé : on le renouvelle une fois
        }
      } catch (err) {
        if (err.auth) throw new ApiError(409, 'Withings a refusé l’accès : reconnecte-toi (Profil → Connexions).');
        if (!err.counts) throw new ApiError(502, err.message);
        // Limite de requêtes ou coupure en cours de route : on garde ce qui est arrivé, la suite viendra à la prochaine synchro.
        counts = err.counts;
        warning = err.message;
      }
      // On ne garde qu'un peu plus d'un an de nuits.
      for (const d of Object.keys(state.nights)) if (d < day(-400)) delete state.nights[d];
      if (!warning) state.withings.lastSync = Math.floor(Date.now() / 1000);
      ctx.save();
      return { ...counts, warning, nights: state.nights, withings: withingsPublic() };
    },

    withingsDisconnect(body) {
      const w = secrets.withings ?? {};
      for (const k of ['accessToken', 'refreshToken', 'expiresAt', 'userId']) delete w[k];
      secrets.withings = body.forget ? {} : w;
      ctx.saveSecrets();
      state.withings = { lastSync: null };
      // Les nuits déjà reçues restent : elles font partie de ton historique.
      ctx.save();
      return { withings: withingsPublic() };
    },

    // ECG de 30 s importé à la main : le navigateur lit le PDF et calcule la VFC,
    // on garde le résultat (un par jour : le dernier importé remplace l'autre).
    saveEcg(date, body) {
      if (!DATE.test(date ?? '')) throw new ApiError(400, 'Date invalide');
      const num = (v, lo, hi) => (Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : null);
      const rmssd = num(body.rmssd, 3, 300);
      const hr = num(body.hr, 30, 150);
      if (rmssd == null || hr == null) throw new ApiError(400, 'Mesure invalide');
      const int = (v, hi) => { const n = num(v, 0, hi); return n == null ? null : Math.round(n); };
      state.ecg[date] = {
        rmssd: Math.round(rmssd * 10) / 10,
        hr: Math.round(hr * 10) / 10,
        beats: int(body.beats, 400),
        pairs: int(body.pairs, 400),
        rejected: int(body.rejected, 400),
        seconds: num(body.seconds, 0, 600),
        at: typeof body.at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(body.at) ? body.at.slice(0, 16) : null,
        file: typeof body.file === 'string' ? body.file.slice(0, 120) : null,
      };
      const oldest = new Date(Date.parse(`${todayLocal()}T12:00:00Z`) - 400 * 86400000).toISOString().slice(0, 10);
      for (const d of Object.keys(state.ecg)) if (d < oldest) delete state.ecg[d];
      ctx.save();
      return { ecg: state.ecg };
    },

    deleteEcg(date) {
      delete state.ecg[date];
      ctx.save();
      return { ecg: state.ecg };
    },

    // -----------------------------------------------------------------------
    // Sauvegarde, restauration, effacement
    // -----------------------------------------------------------------------

    /** La sauvegarde à télécharger : toutes les données, sans les identifiants. */
    exportData() {
      return { fileName: `enduro-${todayLocal()}.json`, json: JSON.stringify(state, null, 1) };
    },

    /** Remplace tout le carnet par une sauvegarde (passage du Mac au téléphone, ou l'inverse). */
    restore(body) {
      const next = readBackup(body?.backup);
      if (!next) throw new ApiError(400, 'Ce fichier n’est pas une sauvegarde d’Enduro (« Télécharger une sauvegarde » dans Profil → Mes données).');
      replaceAll(next, 'avant-restauration');
      return publicState();
    },

    reset(body) {
      if (body.confirm !== 'EFFACER') throw new ApiError(400, 'Confirmation manquante');
      replaceAll(defaultState(), 'avant-effacement');
      return publicState();
    },
  };
}
