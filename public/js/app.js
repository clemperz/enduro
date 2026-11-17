// Chef d'orchestre : démarrage, navigation, rendu et actions de l'utilisateur.

import {
  S, absorb, ensurePlan, savePlan, replan, findSession, replaceSession, activityById, weekFor, plannableDays,
} from './store.js';
import { api } from './api.js';
import { momo, icon } from './art.js';
import { todayView } from './views/today.js';
import { observeView } from './views/observe.js';
import { learnView } from './views/learn.js';
import { onboardingView, profileView, defaultProfile, obError, goalsError } from './views/forms.js';
import { sheetHtml, plannedOn } from './views/sheets.js';
import {
  resizeSession, lightenSession, moveKeySession, MANUAL_KINDS, defaultMinutes, manualSession, insertSession, removeSession,
  goalsOf, MAX_GOALS, PHASES,
} from '../engine/plan.js';
import { undoEntry, markSeen, note } from '../engine/coach.js';
import { formatOf } from '../engine/formats.js';
import { planStages } from '../engine/explain.js';
import { summarizeFit } from '../engine/fit.js';
import { summarizeGpx } from './gpx.js';
import { analyzeEcg, ECG_REASONS } from '../engine/ecg.js';
import { readEcgFile } from '../engine/ecgfile.js';
import { fmtDate, fmtDuration, localStamp, mondayOf, addDays } from '../engine/dates.js';

const $ = (sel) => document.querySelector(sel);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------
// Navigation et rendu
// ---------------------------------------------------------------------------

const VIEWS = { '': todayView, observer: observeView, comprendre: learnView, profil: profileView };

function currentRoute() {
  const name = location.hash.replace(/^#\/?/, '').split('?')[0];
  return name in VIEWS ? name : '';
}

function profileDraft() {
  const draft = structuredClone(S.profile);
  // Les objectifs, au nouveau format (un ancien profil n'en avait qu'un).
  draft.goals = goalsOf(S.profile).map((g) => ({ ...g }));
  delete draft.goal;
  draft.refs = { pma: null, ftp: null, fcmax: null, fcrest: null, vma: null, ...(draft.refs ?? {}) };
  // Le volume affiché est la référence actuelle du plan (elle évolue au fil des semaines).
  const ref = S.plan?.weeks?.[mondayOf(S.today)]?.refMin;
  if (ref) draft.hoursNow = clamp(Math.round(ref / 30) / 2, 1, 25);
  return { draft, initialHours: draft.hoursNow };
}

function shell(content, route) {
  const tab = (to, label, ico) => `<a href="#/${to}" class="tab ${route === to ? 'on' : ''}" ${route === to ? 'aria-current="page"' : ''}>${icon(ico, 23)}<span>${label}</span></a>`;
  return `<header class="top"><div class="top-in">
      <a class="brand" href="#/" aria-label="Enduro, accueil"><span class="brand-logo">${momo('happy', 46)}</span><span class="brand-name">Enduro</span></a>
      <nav class="tabs" aria-label="Navigation">${tab('', 'S’entraîner', 'bike')}${tab('observer', 'Observer', 'eye')}${tab('comprendre', 'Comprendre', 'book')}${tab('profil', 'Profil', 'gear')}</nav>
    </div></header>
    <main class="view">${content}</main>`;
}

/** Espaces insécables avant ? ! : ; » et après « (les valeurs et attributs n'en souffrent pas). */
const typo = (html) => html.replace(/ ([?!:;»])/g, '\u00A0$1').replace(/« /g, '«\u00A0');

function render() {
  const app = $('#app');
  if (!S.ready) {
    app.innerHTML = `<div class="splash">${momo('sleep', 140)}<p>${S.fatal ? S.fatal : 'Momo se réveille…'}</p></div>`;
    return;
  }
  if (!S.profile) {
    S.ui.ob ??= { step: 0, draft: defaultProfile(), error: null };
    app.innerHTML = typo(onboardingView());
  } else {
    const route = currentRoute();
    if (route === 'profil') S.ui.form ??= profileDraft();
    else S.ui.form = null;
    app.innerHTML = typo(shell(VIEWS[route](), route));
  }
  $('#sheet').innerHTML = typo(sheetHtml());
  document.body.classList.toggle('sheet-open', !!S.ui.sheet);
}

let toastTimer = null;
function toast(text, kind = 'ok') {
  const el = $('#toast');
  el.textContent = text;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'err' ? 6000 : 3800);
}

// ---------------------------------------------------------------------------
// Brouillons de formulaire
// ---------------------------------------------------------------------------

const draft = () => S.ui.ob?.draft ?? S.ui.form?.draft ?? null;

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  o[keys[keys.length - 1]] = value;
}

/**
 * Objectifs à enregistrer : trois à venir au plus, triés par date, avec au moins
 * un objectif majeur. Ceux des trois dernières semaines sont gardés : le plan
 * en a besoin pour la semaine de récupération qui suit.
 */
function cleanGoals(d, split) {
  const mono = split >= 1 ? 'bike' : split <= 0 ? 'run' : null;
  const list = (d.goals ?? [])
    .filter((g) => /^\d{4}-\d{2}-\d{2}$/.test(g?.date ?? '') && g.date >= addDays(S.today, -21))
    .map((g) => ({
      id: String(g.id || `g${Math.random().toString(36).slice(2, 8)}`),
      name: String(g.name ?? '').trim().slice(0, 40),
      sport: mono ?? (g.sport === 'run' ? 'run' : 'bike'),
      date: g.date,
      major: g.major !== false && g.major !== 'false',
      format: g.format,
    }))
    // Le format ne se garde que s'il existe dans le sport de l'objectif.
    .map(({ format, ...g }) => (formatOf({ ...g, format }) ? { ...g, format } : g))
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  const upcoming = list.filter((g) => g.date >= S.today).slice(0, MAX_GOALS);
  if (upcoming.length && !upcoming.some((g) => g.major)) upcoming[upcoming.length - 1].major = true;
  return [...list.filter((g) => g.date < S.today), ...upcoming];
}

const goalLine = (g) => `${g.name || 'Objectif'} (${g.sport === 'bike' ? 'vélo' : 'course à pied'}${formatOf(g) ? `, ${formatOf(g).label.toLowerCase()}` : ''}, ${fmtDate(g.date, { day: 'numeric', month: 'long', year: 'numeric' })}, ${g.major ? 'objectif majeur' : 'étape'})`;

/** Entrée de journal quand les objectifs changent : avant, après, et le nouveau calendrier. */
function goalsNote(before, next) {
  const then = goalsOf(before).filter((g) => g.date >= S.today);
  const now = goalsOf(next).filter((g) => g.date >= S.today);
  const stages = planStages(next, S.plan, S.today).map((s) => `${PHASES[s.phase].label} ${s.weeks} sem.`).join(' → ');
  return {
    rule: 'profil',
    title: 'Objectifs modifiés : plan reconstruit',
    why: 'Le plan est construit à rebours depuis tes objectifs. Quand ils changent, les phases, les semaines allégées et l’affûtage changent de place : la fin de cette semaine a été recalculée, et les semaines suivantes suivent le nouveau calendrier.',
    changes: [
      `Avant : ${then.length ? then.map(goalLine).join(' · ') : 'aucun objectif daté'}`,
      `Maintenant : ${now.length ? now.map(goalLine).join(' · ') : 'aucun objectif daté'}`,
      `Nouveau calendrier : ${stages}`,
    ],
    weekStart: mondayOf(S.today),
  };
}

function cleanProfile(d) {
  const num = (v, lo, hi) => (v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= lo && Number(v) <= hi ? Number(v) : null);
  const split = clamp(Number(d.split) || 0, 0, 1);
  return {
    name: String(d.name ?? '').trim().slice(0, 30),
    birthYear: num(d.birthYear, 1930, 2015),
    weightKg: num(d.weightKg, 30, 200),
    split,
    level: ['debutant', 'intermediaire', 'confirme'].includes(d.level) ? d.level : 'intermediaire',
    hoursNow: clamp(Number(d.hoursNow) || 3, 1, 25),
    avail: Array.from({ length: 7 }, (_, i) => clamp(Number(d.avail?.[i]) || 0, 0, 360)),
    indoor: ['semaine', 'toujours', 'jamais'].includes(d.indoor) ? d.indoor : 'semaine',
    goals: cleanGoals(d, split),
    refs: {
      pma: num(d.refs?.pma, 50, 800),
      ftp: num(d.refs?.ftp, 40, 600),
      fcmax: num(d.refs?.fcmax, 100, 230),
      fcrest: num(d.refs?.fcrest, 30, 110),
      vma: num(d.refs?.vma, 6, 26),
    },
  };
}

// ---------------------------------------------------------------------------
// Opérations
// ---------------------------------------------------------------------------

/** À appeler chaque fois que la liste des activités change. */
async function activitiesChanged() {
  if (ensurePlan()) await savePlan();
}

/** Après chaque action : le coach relit le plan (séance ajoutée, ressenti, activité…) et on enregistre s'il a ajusté quelque chose. */
async function settle() {
  if (S.ready && S.profile && ensurePlan()) await savePlan();
}

async function syncStrava(silent = false) {
  try {
    const res = await api.stravaSync();
    absorb(res);
    await activitiesChanged();
    if (!silent || res.added) toast(`Strava : ${res.added} nouvelle${res.added > 1 ? 's' : ''} activité${res.added > 1 ? 's' : ''}.`);
  } catch (err) {
    if (!silent) toast(err.message, 'err');
  }
  render();
}

/** Nuits de la montre (Withings). Le feu du matin peut changer : le coach relit le plan. */
async function syncWithings(silent = false) {
  try {
    const res = await api.withingsSync();
    absorb(res);
    if (S.ui.withingsResult === 'ok') S.ui.withingsResult = null;
    await settle();
    if (res.warning) {
      if (!silent) toast(res.warning, 'err');
    } else if (!silent) {
      toast(res.added ? `Withings : ${res.added} nuit${res.added > 1 ? 's' : ''} reçue${res.added > 1 ? 's' : ''}.` : 'Withings : rien de nouveau depuis la dernière fois.');
    }
  } catch (err) {
    if (!silent) toast(err.message, 'err');
  }
  render();
}

function startWithingsLogin() {
  S.ui.withingsResult = null;
  location.href = api.loginUrl('withings');
}

/** Sauvegarde choisie (Profil → Mes données, ou premier lancement) : lue, puis appliquée tout de suite ou après confirmation. */
async function pickBackup(file) {
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    toast('Ce fichier est illisible : choisis le fichier enduro-AAAA-MM-JJ.json de « Télécharger une sauvegarde ».', 'err');
    return;
  }
  if (!S.profile) {
    await applyBackup(backup);
    return;
  }
  // Un carnet existe déjà ici : on montre ce qui va le remplacer avant d'y toucher.
  const acts = Array.isArray(backup?.activities) ? backup.activities.length : 0;
  S.ui.restore = { backup, fileName: file.name, name: backup?.profile?.name ?? '', acts };
  render();
}

async function applyBackup(backup) {
  absorb(await api.restore(backup));
  S.ui = { sheet: null, weekOffset: 0, toast: null, ob: null, form: null, busy: {} };
  if (S.profile && ensurePlan()) await savePlan();
  const n = S.activities.length;
  toast(S.profile
    ? `Carnet restauré${S.profile.name ? ` : bonjour ${S.profile.name} !` : '.'} ${n} activité${n > 1 ? 's' : ''} retrouvée${n > 1 ? 's' : ''}.`
    : 'Sauvegarde restaurée.');
  if (location.hash !== '#/') location.hash = '#/';
  render();
}

async function submitWithingsPaste(url) {
  if (!url?.trim()) throw new Error('Colle l’adresse de la page où Withings t’a renvoyé.');
  absorb(await api.withingsCode(url.trim()));
  S.ui.withingsPaste = false;
  S.ui.withingsResult = 'ok';
  render();
  await syncWithings(false);
}

async function importFiles(files) {
  const acts = [];
  const errors = [];
  for (const file of files) {
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith('.fit')) {
        const s = summarizeFit(new Uint8Array(await file.arrayBuffer()));
        if (!s) throw new Error('aucun point enregistré');
        const start = localStamp(s.startEpoch);
        const { startEpoch, sport, durationSec, distanceKm, elevationM, avgPower, np, maxPower, avgHr, maxHr, avgCadence, best, ramp } = s;
        acts.push({
          id: `file:${file.name}`, source: 'file', name: file.name.replace(/\.fit$/i, ''), start, date: start.slice(0, 10),
          startEpoch, sport, durationSec, distanceKm, elevationM, avgPower, np, maxPower, avgHr, maxHr, avgCadence, best, ramp,
        });
      } else if (lower.endsWith('.gpx')) {
        const a = summarizeGpx(await file.text(), file.name);
        if (!a) throw new Error('trace vide ou sans heure');
        acts.push(a);
      } else {
        throw new Error('format non reconnu (.fit ou .gpx attendu)');
      }
    } catch (err) {
      errors.push(`${file.name} : ${err.message}`);
    }
  }
  try {
    if (acts.length) {
      const res = await api.importActivities(acts);
      absorb(res);
      await activitiesChanged();
      const upd = res.merged + res.updated;
      toast(`${res.added} activité${res.added > 1 ? 's' : ''} ajoutée${res.added > 1 ? 's' : ''}${upd ? `, ${upd} mise${upd > 1 ? 's' : ''} à jour` : ''}${errors.length ? ` — ${errors.length} fichier${errors.length > 1 ? 's' : ''} illisible${errors.length > 1 ? 's' : ''}` : ''}.`);
    } else if (errors.length) {
      toast(errors[0], 'err');
    }
  } catch (err) {
    toast(err.message, 'err');
  }
  render();
}

/** ECG de 30 s exporté de l'appli Withings (PDF) → VFC et pouls du matin. */
async function importEcg(file) {
  S.ui.busy.ecg = true;
  render();
  try {
    const rec = await readEcgFile(new Uint8Array(await file.arrayBuffer()), file.name);
    const r = analyzeEcg(rec.segments, rec.fs);
    if (!r.ok) throw new Error(ECG_REASONS[r.reason]);
    // Contrôle : le pouls que nous comptons doit être celui qu'affiche Withings sur le même ECG.
    if (rec.hr && Math.abs(r.hr - rec.hr) > 3) {
      throw new Error(`Lecture du tracé douteuse (pouls ${Math.round(r.hr)} compté, ${rec.hr} selon Withings) : rien n’est enregistré.`);
    }
    const date = rec.date ?? S.today;
    absorb(await api.saveEcg(date, {
      rmssd: r.rmssd, hr: r.hr, beats: r.beats, pairs: r.pairs, rejected: r.rejected, seconds: r.seconds, at: rec.at, file: file.name,
    }));
    const what = `VFC ${Math.round(r.rmssd)} ms, cœur ${Math.round(r.hr)}`;
    toast(date === S.today ? `ECG lu : ${what}.` : `ECG du ${fmtDate(date, { day: 'numeric', month: 'long' })} enregistré : ${what}.`);
    await settle();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    S.ui.busy.ecg = false;
  }
  render();
}

/** Résultats saisis après un test → repères. Renvoie null si rien d'exploitable n'a été saisi. */
function testRefs(sport, sheet) {
  const num = (v, lo, hi) => (v !== '' && v != null && Number(v) >= lo && Number(v) <= hi ? Number(v) : null);
  const refs = {};
  const parts = [];
  if (sport === 'bike') {
    const p5 = num(sheet.p5, 80, 800);
    const p20 = num(sheet.p20, 60, 600);
    if (p5) { refs.pma = Math.round(p5); parts.push(`PMA ${refs.pma} W`); }
    if (p20) { refs.ftp = Math.round(p20 * 0.95); parts.push(`FTP ${refs.ftp} W`); }
  } else {
    const d6 = num(sheet.d6, 600, 2600);
    if (d6) { refs.vma = Math.round(d6 / 10) / 10; parts.push(`VMA ${String(refs.vma).replace('.', ',')} km/h`); }
  }
  return parts.length ? { refs, text: parts.join(', ') } : null;
}

async function saveRefs(refs) {
  const profile = structuredClone(S.profile);
  profile.refs = { ...(profile.refs ?? {}), ...refs };
  absorb(await api.saveProfile(profile));
  S.ui.form = null;
}

/** Séance retirée ou remplacée : si c'était une séance vélo supplémentaire déjà envoyée, on l'enlève de Zwift. */
async function forgetInZwift(session) {
  if (!session?.zwift || !session.zwoSlot) return;
  try { await api.zwiftRemove(session.zwift); } catch { /* Zwift absent : rien à nettoyer */ }
}

async function exportToZwift(sessions) {
  // Version en ligne : la feuille de partage s'ouvre tout de suite (AirDrop vers le Mac où tourne Zwift).
  if (api.local) {
    const res = await api.zwiftShare(sessions);
    if (!res) return;
    for (const f of res.files) {
      const found = findSession(f.sessionId);
      if (found) found.session.zwift = f.fileName;
    }
    await savePlan();
    S.ui.sheet = { type: 'zwift', shared: true, files: res.files, ftp: res.ftp, ftpEstimated: res.ftpEstimated };
    return;
  }
  if (!S.zwift?.canExport) throw new Error('Zwift n’a pas été trouvé sur cet ordinateur : lance-le une première fois.');
  const res = await api.zwiftExport(sessions);
  for (const f of res.files) {
    const found = findSession(f.sessionId);
    if (found) found.session.zwift = f.fileName;
  }
  await savePlan();
  S.ui.sheet = { type: 'zwift', files: res.files, ftp: res.ftp, ftpEstimated: res.ftpEstimated };
}

// ---------------------------------------------------------------------------
// Actions (attribut data-act des boutons)
// ---------------------------------------------------------------------------

const actions = {
  go({ to }) { S.ui.sheet = null; location.hash = to; },
  week({ d }) { S.ui.weekOffset = clamp(S.ui.weekOffset + Number(d), -8, 1); },
  'close-sheet'() { S.ui.sheet = null; S.ui.confirmDelete = null; },
  'open-session'({ id }) { S.ui.sheet = { type: 'session', id }; },
  'open-day'({ date }) { S.ui.sheet = { type: 'day', date }; },
  'open-article'({ id }) { S.ui.sheet = { type: 'article', id }; },
  'open-why'({ monday }) { S.ui.sheet = { type: 'why', monday }; },

  // Ajustements automatiques du plan
  async 'undo-auto'({ key }) {
    if (!undoEntry(S.plan, key, S.today)) throw new Error('Cet ajustement ne peut plus être annulé : la séance est déjà faite ou passée.');
    await savePlan();
    toast('C’est rétabli. Momo ne retouchera pas à ces séances.');
  },
  async 'journal-seen'({ key }) {
    if (markSeen(S.plan, key || null)) await savePlan();
  },
  'journal-all'() { S.ui.journalAll = true; },
  'open-activity'({ id }) {
    const a = activityById(id);
    if (a) S.ui.sheet = { type: 'activity', id, rpe: a.rpe ?? null, note: a.note ?? '' };
  },

  // Ressenti du matin
  async feel({ v }) {
    const cur = S.checkins[S.today];
    const feel = Number(v);
    absorb(await api.saveCheckin(S.today, cur?.feel === feel && !cur.sick ? null : { feel, sick: !!cur?.sick, pulse: cur?.pulse }));
  },
  async sick() {
    const cur = S.checkins[S.today];
    absorb(await api.saveCheckin(S.today, { feel: cur?.feel ?? 2, sick: !cur?.sick, pulse: cur?.pulse }));
  },
  // Pouls de repos du matin (facultatif) : rattaché au ressenti du jour.
  async pulse({ value }) {
    const cur = S.checkins[S.today];
    const pulse = Math.round(Number(value));
    if (value !== '' && !(pulse >= 30 && pulse <= 120)) throw new Error('Un pouls de repos se situe entre 30 et 120 battements par minute.');
    absorb(await api.saveCheckin(S.today, { feel: cur?.feel ?? 3, sick: !!cur?.sick, pulse: value === '' ? null : pulse }));
  },

  // Valider une séance
  done({ id }) {
    const found = findSession(id);
    if (!found) return;
    S.ui.sheet = { type: 'done', id, minutes: found.session.durationMin || 60, rpe: null, note: '' };
  },
  rpe({ v }) { if (S.ui.sheet) S.ui.sheet.rpe = Number(v); },
  'sheet-min'({ d }) { if (S.ui.sheet) S.ui.sheet.minutes = clamp(S.ui.sheet.minutes + Number(d), 5, 720); },
  'sheet-sport'({ v }) { if (S.ui.sheet) S.ui.sheet.sport = v; },
  async 'save-done'() {
    const sh = S.ui.sheet;
    const found = findSession(sh.id);
    if (!found || !sh.rpe) return;
    const s = found.session;
    const res = await api.addActivity({
      sport: s.sport, date: s.date, durationSec: sh.minutes * 60, rpe: sh.rpe, note: sh.note,
      name: `${s.title}${s.detail ? ` ${s.detail}` : ''}`, indoor: !!s.indoor, sessionId: s.id,
    });
    absorb(res);
    s.status = 'done';
    s.activityId = res.activity.id;
    await savePlan();
    S.ui.sheet = null;
    // Séance « test » : les résultats saisis deviennent les nouveaux repères.
    const found2 = s.kind === 'test' ? testRefs(s.sport, sh) : null;
    if (found2) {
      await saveRefs(found2.refs);
      toast(`Test enregistré : ${found2.text}. Tes zones sont recalculées.`);
    } else {
      toast('Séance validée. Bien joué !');
    }
  },
  async 'use-test'({ pma, ftp }) {
    const refs = {};
    if (Number(pma) > 0) refs.pma = Number(pma);
    if (Number(ftp) > 0) refs.ftp = Number(ftp);
    await saveRefs(refs);
    toast('Repères mis à jour d’après ton test. Tes zones sont recalculées.');
  },

  // Activités
  'add-activity'({ date }) { S.ui.sheet = { type: 'add', date, sport: S.profile.split >= 0.5 ? 'bike' : 'run', minutes: 45, rpe: null, name: '' }; },
  async 'save-add'() {
    const sh = S.ui.sheet;
    if (!sh.rpe) return;
    absorb(await api.addActivity({ sport: sh.sport, date: sh.date, durationSec: sh.minutes * 60, rpe: sh.rpe, name: sh.name }));
    await activitiesChanged();
    S.ui.sheet = null;
    toast('Activité ajoutée.');
  },
  async 'save-activity'() {
    const sh = S.ui.sheet;
    absorb(await api.patchActivity(sh.id, { rpe: sh.rpe ?? null, note: sh.note ?? '' }));
    S.ui.sheet = null;
    toast('C’est noté.');
  },
  async 'delete-activity'({ id }) {
    if (S.ui.confirmDelete !== id) {
      S.ui.confirmDelete = id;
      toast('Touche encore « Supprimer » pour confirmer.');
      return;
    }
    absorb(await api.deleteActivity(id));
    S.ui.confirmDelete = null;
    S.ui.sheet = null;
    await activitiesChanged();
    toast('Activité supprimée.');
  },

  // Ajouter une séance au plan (ou en remplacer une)
  'plan-add'({ date, replace, sport, kind }) {
    const d = plannableDays().includes(date) ? date : S.today;
    const sp = sport === 'bike' || sport === 'run' ? sport : (S.profile.split >= 0.5 ? 'bike' : 'run');
    const k = MANUAL_KINDS[sp].includes(kind) ? kind : 'endurance';
    const target = replace ? findSession(replace)?.session : null;
    S.ui.sheet = {
      type: 'plan-add', date: d, sport: sp, kind: k,
      minutes: target?.durationMin || defaultMinutes(S.profile, sp, k),
      replaceId: target ? target.id : (plannedOn(d).sessions[0]?.id ?? null),
    };
  },
  'pa-day'({ v }) {
    const sh = S.ui.sheet;
    sh.date = v;
    sh.replaceId = plannedOn(v).sessions[0]?.id ?? null;
  },
  'pa-sport'({ v }) {
    const sh = S.ui.sheet;
    if (sh.sport === v) return;
    // Même famille de séance dans l'autre sport quand elle existe (PMA ↔ VMA, 30/30 vélo ↔ 30/30 course).
    const twin = { pma: 'vma', vma: 'pma', pma3030: 'vma3030', vma3030: 'pma3030' }[sh.kind];
    sh.sport = v;
    sh.kind = MANUAL_KINDS[v].includes(sh.kind) ? sh.kind : MANUAL_KINDS[v].includes(twin) ? twin : 'endurance';
    sh.minutes = defaultMinutes(S.profile, v, sh.kind);
  },
  'pa-kind'({ v }) {
    const sh = S.ui.sheet;
    sh.kind = v;
    sh.minutes = defaultMinutes(S.profile, sh.sport, v);
  },
  'pa-min'({ d }) { S.ui.sheet.minutes = clamp(S.ui.sheet.minutes + Number(d), 20, 360); },
  'pa-mode'({ v }) { S.ui.sheet.replaceId = v || null; },
  async 'pa-save'() {
    const sh = S.ui.sheet;
    const { monday, week } = weekFor(sh.date);
    if (!week) throw new Error('On ne peut planifier que cette semaine et la suivante.');
    const others = week.sessions.filter((s) => s.date === sh.date && s.id !== sh.replaceId);
    const session = manualSession(S.profile, week, sh, others);
    const replaced = sh.replaceId ? week.sessions.find((s) => s.id === sh.replaceId) : null;
    S.plan.weeks[monday] = insertSession(week, session, replaced?.id ?? null);
    ensurePlan(); // relie une éventuelle activité déjà faite ce jour-là
    await savePlan();
    await forgetInZwift(replaced);
    S.ui.sheet = null;
    S.ui.weekOffset = monday > mondayOf(S.today) ? 1 : 0;
    const when = fmtDate(sh.date, { weekday: 'long', day: 'numeric', month: 'long' });
    const what = `${session.title}${session.detail ? ` ${session.detail}` : ''} (${session.sport === 'bike' ? 'vélo' : 'course à pied'})`;
    toast(replaced ? `Séance de ${when} changée : ${what}.` : `Séance ajoutée ${when} : ${what}.`);
  },
  async 'remove-session'({ id }) {
    const found = findSession(id);
    if (!found) return;
    S.plan.weeks[found.week.weekStart] = removeSession(found.week, id);
    await savePlan();
    await forgetInZwift(found.session);
    S.ui.sheet = null;
    toast('Séance retirée du plan.');
  },

  // Ajuster une séance
  'less-time'({ id }) { S.ui.sheet = { type: 'time', id }; },
  async resize({ id, min }) {
    const found = findSession(id);
    if (!found) return;
    const next = resizeSession(found.session, Number(min));
    delete next.zwift;
    replaceSession(id, next);
    await savePlan();
    S.ui.sheet = null;
    toast(next.kind === found.session.kind ? `Séance ramenée à ${fmtDuration(next.durationMin)}.` : `Trop court pour la séance prévue : ${fmtDuration(next.durationMin)} d’endurance.`);
  },
  async lighten({ id, mode }) {
    const found = findSession(id);
    if (!found) return;
    const next = lightenSession(found.session, mode === 'recup' ? 'recup' : 'facile');
    delete next.zwift;
    replaceSession(id, next);
    await savePlan();
    toast('Séance allégée. Écouter son corps, c’est aussi s’entraîner.');
  },
  async keep({ id }) {
    const found = findSession(id);
    if (!found) return;
    found.session.keepAsIs = true;
    await savePlan();
  },
  async skip({ id }) {
    const found = findSession(id);
    if (!found) return;
    const s = found.session;
    if (s.role === 'key' && s.date >= S.today) {
      const moved = moveKeySession(found.week, id, S.today, S.profile.avail);
      if (moved) {
        const where = moved.sessions.find((x) => x.moved && x.kind === s.kind && x.status === 'planned');
        found.week.sessions = moved.sessions;
        await savePlan();
        S.ui.sheet = null;
        toast(`Séance clé déplacée à ${fmtDate(where.date, { weekday: 'long' })}.`);
        return;
      }
    }
    s.status = 'skipped';
    await savePlan();
    S.ui.sheet = null;
    toast('Séance passée. On ne rattrape pas : cap sur la suivante.');
  },
  async replan() {
    replan();
    note(S.plan, S.today, {
      rule: 'replan', weekStart: mondayOf(S.today),
      title: 'Semaine recalculée à ta demande',
      why: 'Les séances restantes ont été reconstruites à partir d’aujourd’hui, autour de ce qui est déjà fait et des séances que tu as ajoutées. Les réglages faits à la main sur les autres séances (durée, allègement) ont été remis à zéro.',
    });
    await savePlan();
    toast('Semaine recalculée à partir d’aujourd’hui.');
  },

  // Zwift
  async zwift({ id }) {
    const found = findSession(id);
    if (found) await exportToZwift([found.session]);
  },
  async 'zwift-week'({ monday }) {
    const week = S.plan.weeks[monday];
    const list = (week?.sessions ?? []).filter((s) => s.sport === 'bike' && s.status === 'planned' && s.date >= S.today && s.steps?.length);
    if (list.length) await exportToZwift(list);
  },
  async 'zwift-import'() {
    const res = await api.zwiftImport();
    absorb(res);
    await activitiesChanged();
    toast(res.added ? `${res.added} nouvelle${res.added > 1 ? 's' : ''} sortie${res.added > 1 ? 's' : ''} Zwift.` : 'Aucune nouvelle sortie Zwift.');
  },

  // Strava
  async 'strava-save'() {
    absorb(await api.stravaConfig($('#strava-id').value.trim(), $('#strava-secret').value.trim()));
    S.ui.stravaEdit = false;
    S.ui.stravaId = '';
    S.ui.stravaSecret = '';
    location.href = api.loginUrl('strava');
  },
  'strava-connect'() { location.href = api.loginUrl('strava'); },
  'strava-edit'() { S.ui.stravaEdit = true; },
  async 'strava-sync'() { await syncStrava(false); },
  async 'strava-disconnect'() {
    absorb(await api.stravaDisconnect(false));
    S.ui.stravaResult = null;
    toast('Strava déconnecté.');
  },

  // Withings
  async 'withings-save'() {
    absorb(await api.withingsConfig($('#withings-id').value.trim(), $('#withings-secret').value.trim(), ($('#withings-redirect')?.value ?? '').trim()));
    S.ui.withingsEdit = false;
    S.ui.withingsId = '';
    S.ui.withingsSecret = '';
    S.ui.withingsRedirect = undefined;
    // Avec une adresse de retour à coller, Withings s'ouvre dans un autre onglet : il faut un vrai clic sur « Connecter ».
    if (S.withings?.customRedirect) toast('Identifiants enregistrés. Clique sur « Connecter Withings ».');
    else location.href = api.loginUrl('withings');
  },
  'withings-connect'() { startWithingsLogin(); },
  'withings-edit'() { S.ui.withingsEdit = true; S.ui.withingsPaste = false; },
  async 'withings-paste'() { await submitWithingsPaste($('#withings-paste')?.value); },
  async 'withings-sync'() { await syncWithings(false); },
  async 'ecg-delete'({ date }) {
    absorb(await api.deleteEcg(date));
    toast('ECG retiré.');
  },
  async 'withings-disconnect'() {
    absorb(await api.withingsDisconnect(false));
    S.ui.withingsResult = null;
    toast('Withings déconnecté. Les nuits déjà reçues restent dans ton historique.');
  },

  // Repères suggérés par les records
  async 'use-ref'({ key, value }) {
    const p = structuredClone(S.profile);
    p.refs = { ...(p.refs ?? {}), [key]: Number(value) };
    absorb(await api.saveProfile(p));
    S.ui.form = null;
    toast(`${key.toUpperCase()} mise à jour : ${value} W. Tes cibles sont recalculées.`);
  },

  // Formulaires (premier lancement et profil)
  set({ path, value, num }) {
    const d = draft();
    if (!d) return;
    setPath(d, path, /\.major$/.test(path) ? value === 'true' : num || path === 'split' ? Number(value) : value);
    // Un seul sport pratiqué : les objectifs suivent.
    const mono = d.split >= 1 ? 'bike' : d.split <= 0 ? 'run' : null;
    if (mono) for (const g of d.goals ?? []) g.sport = mono;
    if (S.ui.ob) S.ui.ob.error = null;
  },
  'goal-add'() {
    const d = draft();
    if (!d) return;
    d.goals ??= [];
    if (d.goals.filter((g) => !g.date || g.date >= S.today).length >= MAX_GOALS) return;
    d.goals.push({ id: `g${Math.random().toString(36).slice(2, 8)}`, name: '', sport: d.split >= 0.5 ? 'bike' : 'run', date: null, major: true });
    if (S.ui.ob) S.ui.ob.error = null;
  },
  'goal-remove'({ i }) {
    draft()?.goals?.splice(Number(i), 1);
    if (S.ui.ob) S.ui.ob.error = null;
  },
  step({ path, delta, min, max }) {
    const d = draft();
    if (!d) return;
    const next = Math.round(((Number(getPath(d, path)) || 0) + Number(delta)) * 100) / 100;
    setPath(d, path, clamp(next, Number(min), Number(max)));
    if (S.ui.ob) S.ui.ob.error = null;
  },
  'ob-next'() {
    const ob = S.ui.ob;
    ob.error = obError(ob);
    if (!ob.error) { ob.step += 1; window.scrollTo(0, 0); }
  },
  'ob-back'() { S.ui.ob.error = null; S.ui.ob.step = Math.max(0, S.ui.ob.step - 1); },
  async 'ob-finish'() {
    const ob = S.ui.ob;
    const profile = cleanProfile(ob.draft);
    profile.createdAt = S.today;
    profile.seedHours = profile.hoursNow;
    absorb(await api.saveProfile(profile));
    S.ui.ob = null;
    S.plan = null;
    ensurePlan();
    await savePlan();
    location.hash = '#/';
    window.scrollTo(0, 0);
    toast('Ton plan est prêt. En selle !');
  },
  async 'save-profile'() {
    const before = S.profile;
    const form = S.ui.form;
    const invalid = goalsError(form.draft);
    if (invalid) throw new Error(invalid);
    const next = cleanProfile(form.draft);
    next.createdAt = before.createdAt ?? S.today;
    next.seedHours = before.seedHours ?? before.hoursNow;
    const goalsChanged = JSON.stringify(goalsOf(before)) !== JSON.stringify(goalsOf(next));
    const changed = [
      JSON.stringify(before.avail) !== JSON.stringify(next.avail) ? 'ton temps disponible' : null,
      before.level !== next.level ? 'ton niveau' : null,
      before.split !== next.split ? 'ta répartition vélo / course' : null,
      before.indoor !== next.indoor ? 'ton lieu de pratique' : null,
      Math.abs(next.hoursNow - form.initialHours) > 0.01 ? 'ton volume hebdomadaire' : null,
    ].filter(Boolean);
    const volume = Math.abs(next.hoursNow - form.initialHours) > 0.01;
    absorb(await api.saveProfile(next));
    if (goalsChanged || changed.length) {
      replan({ rebaseMin: volume ? next.hoursNow * 60 : null });
      if (goalsChanged) note(S.plan, S.today, goalsNote(before, next));
      if (changed.length) {
        note(S.plan, S.today, {
          rule: 'profil', weekStart: mondayOf(S.today),
          title: 'Profil modifié : fin de semaine recalculée',
          why: `Tu as changé ${changed.join(', ')}. Les séances restantes de la semaine ont été recalculées pour en tenir compte ; ce qui est déjà fait et les séances que tu as ajoutées restent en place.`,
        });
      }
      await savePlan();
      toast(goalsChanged ? 'Objectifs enregistrés : ton plan est reconstruit à rebours.' : 'Profil enregistré, fin de semaine recalculée.');
    } else {
      toast('Profil enregistré.');
    }
    S.ui.form = null;
  },
  'export-data'() { return api.exportBackup(); },
  async 'restore-confirm'() {
    const pending = S.ui.restore;
    if (pending) await applyBackup(pending.backup);
  },
  'restore-cancel'() { S.ui.restore = null; },
  async 'reset-all'() {
    if (!S.ui.confirmReset) {
      S.ui.confirmReset = true;
      toast(api.local
        ? 'Touche encore pour tout effacer de ce navigateur. Rien ne pourra être récupéré sans une sauvegarde téléchargée.'
        : 'Touche encore pour tout effacer (une sauvegarde est gardée dans data/sauvegardes).');
      return;
    }
    absorb(await api.reset());
    S.profile = null;
    S.plan = null;
    S.ui = { sheet: null, weekOffset: 0, ob: null, form: null };
    location.hash = '#/';
  },
};

// ---------------------------------------------------------------------------
// Écouteurs
// ---------------------------------------------------------------------------

document.addEventListener('click', (e) => {
  // Lien « Connecter Withings » (page de retour hors d'Enduro) : il s'ouvre dans un autre onglet, ici on prépare le champ à coller.
  const withingsLink = e.target.closest('#withings-open');
  if (withingsLink) {
    // L'adresse d'autorisation est préparée au dernier moment (la version en ligne la construit elle-même).
    try {
      withingsLink.href = api.loginUrl('withings');
    } catch (err) {
      e.preventDefault();
      toast(err.message, 'err');
      return;
    }
    S.ui.withingsResult = null;
    S.ui.withingsPaste = true;
    setTimeout(render, 0);
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  let out;
  try {
    out = fn(el.dataset, el);
  } catch (err) {
    toast(err.message, 'err');
  }
  if (out instanceof Promise) {
    el.classList.add('loading');
    out.then(settle).catch((err) => toast(err.message, 'err')).finally(render);
  } else {
    render();
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset?.field) {
    const d = draft();
    if (!d) return;
    setPath(d, el.dataset.field, el.dataset.num ? (el.value === '' ? null : Number(el.value)) : el.value);
  } else if (el.dataset?.sheetField && S.ui.sheet) {
    S.ui.sheet[el.dataset.sheetField] = el.value;
  } else if (el.dataset?.ui) {
    S.ui[el.dataset.ui] = el.value;
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'file-input' && e.target.files?.length) {
    importFiles([...e.target.files]);
  } else if (e.target.id === 'ecg-input' && e.target.files?.length) {
    importEcg(e.target.files[0]);
  } else if (e.target.id === 'restore-input' && e.target.files?.length) {
    pickBackup(e.target.files[0]).catch((err) => toast(err.message, 'err')).finally(render);
    e.target.value = '';
  } else if (e.target.dataset?.change && actions[e.target.dataset.change]) {
    // Champ qui enregistre tout seul dès qu'on le quitte (pouls de repos du matin).
    actions[e.target.dataset.change]({ value: e.target.value })
      .then(settle).catch((err) => toast(err.message, 'err')).finally(render);
  } else if (e.target.dataset?.field) {
    // On attend que le curseur soit arrivé dans le champ suivant, puis on le lui rend après le rafraîchissement.
    setTimeout(() => {
      const field = document.activeElement?.dataset?.field;
      render();
      if (field) document.querySelector(`[data-field="${field}"]`)?.focus();
    }, 0);
  }
});

// L'adresse de retour Withings collée : on la valide aussitôt (le code ne vaut que 30 secondes).
document.addEventListener('paste', (e) => {
  if (e.target.id !== 'withings-paste') return;
  const text = e.clipboardData?.getData('text');
  if (!text) return;
  e.preventDefault();
  e.target.value = text;
  submitWithingsPaste(text).then(settle).catch((err) => toast(err.message, 'err')).finally(render);
});

// Retour sur l'onglet : la montre a peut-être envoyé la nuit entre-temps.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !S.ready || !S.profile || !S.withings?.connected) return;
  if (!S.withings.lastSync || Date.now() / 1000 - S.withings.lastSync > 15 * 60) syncWithings(true);
});

document.addEventListener('dragover', (e) => { if (e.target.closest?.('#drop, #ecg-drop')) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  if (e.target.closest?.('#ecg-drop')) {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) importEcg(e.dataTransfer.files[0]);
    return;
  }
  if (!e.target.closest?.('#drop')) return;
  e.preventDefault();
  if (e.dataTransfer?.files?.length) importFiles([...e.dataTransfer.files]);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.ui.sheet) { S.ui.sheet = null; render(); }
});

window.addEventListener('hashchange', () => {
  S.ui.sheet = null;
  S.ui.confirmReset = false;
  S.ui.journalAll = false;
  window.scrollTo(0, 0);
  render();
  // Le journal vient d'être affiché en entier : ses entrées sont vues.
  if (currentRoute() === 'comprendre' && S.plan && markSeen(S.plan)) savePlan().catch(() => {});
});

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

async function boot() {
  render();
  try {
    absorb(await api.start());
  } catch (err) {
    S.fatal = 'Impossible de joindre le serveur Enduro. Relance « Démarrer Enduro ».';
    render();
    return;
  }
  if (api.local) {
    // Version en ligne : l'appli s'ouvre même sans réseau, et le navigateur est prié de ne pas effacer le carnet.
    navigator.serviceWorker?.register('sw.js').catch(() => {});
    navigator.storage?.persist?.().catch(() => {});
  }
  // Les sorties Zwift sont lues à chaque ouverture, même avant d'avoir un profil.
  if (S.zwift?.found) {
    try { absorb(await api.zwiftImport()); } catch { /* Zwift illisible : on continue sans */ }
  }
  // Retour de la connexion Strava : #/profil?strava=ok
  const m = location.hash.match(/[?&]strava=(\w+)/);
  if (m) {
    S.ui.stravaResult = m[1];
    history.replaceState(null, '', '#/profil');
  }
  // Retour de la connexion Withings : #/profil?withings=ok
  const mw = location.hash.match(/[?&]withings=(\w+)/);
  if (mw) {
    S.ui.withingsResult = mw[1];
    history.replaceState(null, '', '#/profil');
  }
  S.ready = true;
  try {
    if (S.profile && ensurePlan()) await savePlan();
  } catch (err) {
    toast(err.message, 'err');
  }
  render();
  if (S.profile && S.strava?.connected) {
    const stale = !S.strava.lastSync || Date.now() / 1000 - S.strava.lastSync > 3600;
    if (stale || S.ui.stravaResult === 'ok') syncStrava(S.ui.stravaResult !== 'ok');
  }
  // Withings demande de ne pas l'interroger plus d'une fois toutes les 10 minutes.
  if (S.profile && S.withings?.connected) {
    const stale = !S.withings.lastSync || Date.now() / 1000 - S.withings.lastSync > 15 * 60;
    if (stale || S.ui.withingsResult === 'ok') syncWithings(S.ui.withingsResult !== 'ok');
  }
}

boot();
