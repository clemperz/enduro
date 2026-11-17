// Formulaires : le premier lancement (6 petites étapes) et l'écran Profil.
// Les deux partagent les mêmes blocs de questions, qui modifient un brouillon.

import { S, refs } from '../store.js';
import { momo, icon, sportIcon } from '../art.js';
import { DAYS, fmtDuration, fmtDate } from '../../engine/dates.js';
import { LEVELS, MAX_GOALS, upcomingGoals } from '../../engine/plan.js';
import { FORMATS, formatOf } from '../../engine/formats.js';
import { athleteProfile, vo2Label } from '../../engine/predict.js';
import { fmtClock } from '../../engine/estimate.js';
import { esc, btn, card } from './common.js';

export function defaultProfile() {
  return {
    name: '',
    birthYear: null,
    weightKg: null,
    split: 0.5,
    level: 'intermediaire',
    hoursNow: 4,
    avail: [0, 60, 0, 60, 0, 90, 120],
    indoor: 'semaine',
    goals: [],
    refs: { pma: null, ftp: null, fcmax: null, fcrest: null, vma: null },
  };
}

const SPLITS = [
  { v: 1, label: '100 % vélo', icons: ['bike'] },
  { v: 0.75, label: 'Surtout vélo', icons: ['bike', 'bike', 'run'] },
  { v: 0.5, label: 'Moitié-moitié', icons: ['bike', 'run'] },
  { v: 0.25, label: 'Surtout course', icons: ['bike', 'run', 'run'] },
  { v: 0, label: '100 % course', icons: ['run'] },
];

const LEVEL_TEXT = {
  debutant: 'Je débute ou je reprends. On y va doucement.',
  intermediaire: 'Je m’entraîne régulièrement depuis un moment.',
  confirme: 'Des années d’entraînement structuré derrière moi.',
};

const INDOOR = [
  { v: 'semaine', label: 'Home trainer en semaine, dehors le week-end' },
  { v: 'toujours', label: 'Toujours sur home trainer' },
  { v: 'jamais', label: 'Toujours dehors' },
];

const choice = (path, value, on, inner, cls = 'chip') => `<button type="button" class="${cls} ${on ? 'on' : ''}" data-act="set" data-path="${path}" data-value="${value}" aria-pressed="${on}">${inner}</button>`;
const numInput = (path, value, { placeholder = '', min = 0, max = 9999, step = 1, unit = '' } = {}) => `<span class="num-input"><input class="input" type="number" inputmode="decimal" data-field="${path}" data-num="1" min="${min}" max="${max}" step="${step}" value="${value ?? ''}" placeholder="${placeholder}">${unit ? `<em>${unit}</em>` : ''}</span>`;
const stepper = (path, label, delta, min, max) => `<div class="stepper">
  <button type="button" class="round" data-act="step" data-path="${path}" data-delta="${-delta}" data-min="${min}" data-max="${max}" aria-label="Moins">${icon('minus', 18)}</button>
  <output>${label}</output>
  <button type="button" class="round" data-act="step" data-path="${path}" data-delta="${delta}" data-min="${min}" data-max="${max}" aria-label="Plus">${icon('plus', 18)}</button></div>`;

// ---------------------------------------------------------------------------
// Blocs de questions
// ---------------------------------------------------------------------------

function sportsField(d) {
  return `<div class="split-row">${SPLITS.map((s) => choice('split', s.v, Number(d.split) === s.v,
    `<span class="split-icons">${s.icons.map((i) => sportIcon(i, 26)).join('')}</span><span>${s.label}</span>`, 'tile')).join('')}</div>`;
}

/**
 * Les objectifs : jusqu'à trois courses datées (court, moyen, long terme).
 * Sans objectif, le plan enchaîne des cycles pour progresser et garder la forme.
 */
function goalsField(d) {
  const all = d.goals ?? [];
  // Du plus proche au plus lointain ; ceux qui n'ont pas encore de date à la fin.
  const shown = all.map((g, i) => ({ g, i })).filter(({ g }) => !g.date || g.date >= S.today)
    .sort((x, y) => (x.g.date || '9999').localeCompare(y.g.date || '9999') || x.i - y.i);
  const dated = upcomingGoals({ goals: all }, S.today);
  const mono = d.split >= 1 ? 'bike' : d.split <= 0 ? 'run' : null;
  const cards = shown.map(({ g, i }) => {
    const live = dated.find((x) => x.id === g.id) ?? null;
    const major = live ? live.major : g.major !== false;
    const left = !live ? 'date à préciser' : live.daysLeft < 14 ? `dans ${live.daysLeft} jour${live.daysLeft > 1 ? 's' : ''}` : `dans ${live.weeksLeft} semaines`;
    const sports = mono ? '' : `<div class="goal-row"><span class="goal-q">Sport</span><div class="chips">
        ${choice(`goals.${i}.sport`, 'bike', g.sport === 'bike', `${sportIcon('bike', 18)} Vélo`)}
        ${choice(`goals.${i}.sport`, 'run', g.sport === 'run', `${sportIcon('run', 18)} Course à pied`)}
      </div></div>`;
    const weight = shown.length < 2 ? '' : `<div class="goal-row"><span class="goal-q">Importance</span><div class="chips">
        ${choice(`goals.${i}.major`, 'true', major, 'Objectif majeur<small>affûtage, puis récupération</small>')}
        ${choice(`goals.${i}.major`, 'false', !major, 'Étape<small>course de préparation</small>')}
      </div></div>`;
    // Durée de l'épreuve : règle la longueur de l'affûtage et, à pied, l'allure travaillée.
    const fmt = formatOf(g)?.id ?? '';
    const format = `<div class="goal-row"><span class="goal-q">Format</span><div class="chips">
        ${FORMATS[mono ?? (g.sport === 'run' ? 'run' : 'bike')].map((f) => choice(`goals.${i}.format`, f.id, fmt === f.id, f.label)).join('')}
        ${choice(`goals.${i}.format`, '', !fmt, 'Je ne sais pas')}
      </div></div>`;
    return `<div class="goal-card ${major ? 'major' : 'minor'}">
      <div class="goal-head">
        <span class="goal-tag">${icon('flag', 16)}${live?.horizon ?? 'Objectif'}</span>
        <span class="muted small">${left}</span>
        <button type="button" class="round mini" data-act="goal-remove" data-i="${i}" aria-label="Retirer cet objectif" title="Retirer cet objectif">${icon('trash', 16)}</button>
      </div>
      <div class="field-grid">
        <label><span class="field-label">Nom de l’épreuve</span><input class="input" type="text" maxlength="40" data-field="goals.${i}.name" value="${esc(g.name ?? '')}" placeholder="${g.sport === 'bike' ? 'La Marmotte' : 'Semi de Paris'}"></label>
        <label><span class="field-label">Date</span><input class="input" type="date" data-field="goals.${i}.date" min="${S.today}" value="${esc(g.date ?? '')}"></label>
      </div>
      ${sports}${format}${weight}
    </div>`;
  }).join('');
  const none = shown.length ? '' : `<div class="goal-none">
      <span class="tile-ico">${icon('heart', 30)}</span>
      <span><strong>Progresser et garder la forme</strong><small>Pas de date précise pour l’instant : j’enchaîne des cycles de 12 semaines pour te rendre plus endurant.</small></span>
    </div>`;
  const add = shown.length < MAX_GOALS
    ? `<div class="actions minor">${btn(shown.length ? 'Ajouter un autre objectif' : 'Ajouter un objectif daté', 'goal-add', { cls: 'small', ico: 'plus' })}</div>`
    : '';
  const hint = shown.length >= 2
    ? '<p class="muted small">Le plan est construit à rebours depuis tes objectifs majeurs. Une étape se court sur une semaine allégée, sans casser la progression.</p>'
    : shown.length === 1 ? '<p class="muted small">Tu peux en ajouter jusqu’à trois : court, moyen et long terme.</p>' : '';
  return `<div class="goals-edit">${none}${cards}</div>${add}${hint}`;
}

function levelField(d) {
  const cards = Object.entries(LEVELS).map(([k, l]) => choice('level', k, d.level === k,
    `<span><strong>${l.label}</strong><small>${LEVEL_TEXT[k]}</small></span>`, 'tile wide')).join('');
  return `<div class="tiles-col">${cards}</div>
    <div class="field-block"><span class="field-label">En ce moment, je m’entraîne environ</span>
      ${stepper('hoursNow', `${String(d.hoursNow).replace('.', ',')} h par semaine`, 0.5, 1, 25)}
      <small class="muted">Vélo et course confondus. C’est le point de départ : le plan augmentera tout doucement.</small></div>`;
}

function availField(d) {
  const total = d.avail.reduce((a, b) => a + (Number(b) || 0), 0);
  const rows = DAYS.map((day, i) => `<div class="avail-row ${d.avail[i] ? '' : 'off'}">
    <span class="avail-day">${day.name}</span>
    ${stepper(`avail.${i}`, d.avail[i] ? fmtDuration(d.avail[i]) : 'Repos', 15, 0, 360)}
  </div>`).join('');
  const indoor = d.split > 0 ? `<div class="field-block"><span class="field-label">Et le vélo, tu le fais où ?</span>
    <div class="chips">${INDOOR.map((o) => choice('indoor', o.v, d.indoor === o.v, o.label)).join('')}</div></div>` : '';
  return `<div class="avail">${rows}</div>
    <p class="avail-total">Total disponible : <strong>${fmtDuration(total)}</strong> par semaine. Le plan n’utilisera que ce qu’il faut.</p>${indoor}`;
}

const REF_ROWS = [
  {
    key: 'ftp', label: 'FTP', unit: 'W', sport: 'bike',
    none: 'Pas encore de sortie avec capteur de puissance ces 4 derniers mois.',
    better: 'Le test PMA + FTP du plan la précisera.',
  },
  {
    key: 'pma', label: 'PMA', unit: 'W', sport: 'bike',
    none: 'Pas encore de sortie avec capteur de puissance ces 4 derniers mois.',
    better: 'Le test PMA + FTP du plan la précisera.',
  },
  {
    key: 'vma', label: 'VMA', unit: 'km/h', sport: 'run',
    none: 'Pas encore de course à pied enregistrée ces 4 derniers mois.',
    better: 'Un test de 6 min à fond la précisera.',
  },
  {
    key: 'fcmax', label: 'FC max', unit: 'bpm', sport: null,
    none: 'Indique ton année de naissance pour une première estimation.',
    better: 'Un cardio porté pendant un effort maximal donnerait la vraie valeur.',
  },
];

const refValue = (key, v) => (key === 'vma' ? String(Math.round(v * 10) / 10).replace('.', ',') : String(Math.round(v)));

/** Phrase qui dit d'où vient une estimation, selon sa fiabilité. */
export function estimateSentence(why, better = '') {
  if (!why) return '';
  const basis = esc(why.basis);
  if (why.quality === 'test') return `Estimée d’après ${basis}.`;
  if (why.quality === 'record') return `Estimée d’après ${basis}. C’est un minimum : ta vraie valeur est au moins celle-là. ${better}`;
  if (why.quality === 'cardio') return `Estimée d’après ${basis}. ${better}`;
  return `Ordre de grandeur, d’après ${basis}. ${better}`;
}

/** « Ce que l'app utilise en ce moment » : chaque repère, saisi ou estimé, et pourquoi. */
function refsNow(d, r) {
  const rows = REF_ROWS.filter((row) => !row.sport || (row.sport === 'bike' ? d.split > 0 : d.split < 1)).map((row) => {
    const v = r[row.key];
    if (!v) {
      return `<div class="ref-row none"><span class="ref-name">${row.label}</span><span class="ref-val">—</span><span class="ref-tag">inconnue</span><small>${row.none}</small></div>`;
    }
    const estimated = !!r.est[row.key];
    return `<div class="ref-row ${estimated ? 'est' : 'given'}">
      <span class="ref-name">${row.label}</span><span class="ref-val">${refValue(row.key, v)} ${row.unit}</span>
      <span class="ref-tag">${estimated ? 'estimée' : 'saisie'}</span>
      <small>${estimated ? estimateSentence(r.why[row.key], row.better) : 'Valeur que tu as indiquée.'}</small>
    </div>`;
  }).join('');
  return `<div class="refs-now"><div class="eyebrow">Ce que l’app utilise en ce moment</div>${rows}
    <p class="muted small">Un champ laissé vide ci-dessous est estimé d’après tes sorties Zwift et Strava. Dès que tu saisis une valeur, c’est elle qui compte.</p></div>`;
}

function refsField(d) {
  const r = refs(d);
  const hint = (key, example) => (r.est[key] && r[key] ? `estimée : ${refValue(key, r[key])}` : example);
  const bike = d.split > 0 ? `<h3 class="sec">${sportIcon('bike', 22)} Vélo</h3>
    <div class="field-grid">
      <label><span class="field-label">FTP</span>${numInput('refs.ftp', d.refs.ftp, { placeholder: hint('ftp', 'ex. 220'), max: 600, unit: 'W' })}<small class="muted">Celle affichée dans Zwift</small></label>
      <label><span class="field-label">PMA</span>${numInput('refs.pma', d.refs.pma, { placeholder: hint('pma', 'ex. 290'), max: 800, unit: 'W' })}<small class="muted">Ta puissance sur 5 min à fond</small></label>
    </div>` : '';
  const run = d.split < 1 ? `<h3 class="sec">${sportIcon('run', 22)} Course à pied</h3>
    <div class="field-grid">
      <label><span class="field-label">VMA</span>${numInput('refs.vma', d.refs.vma, { placeholder: hint('vma', 'ex. 15'), max: 26, step: 0.5, unit: 'km/h' })}<small class="muted">Distance en 6 min à fond ÷ 100</small></label>
    </div>` : '';
  return `${refsNow(d, r)}
    <div class="field-grid">
      <label><span class="field-label">Année de naissance</span>${numInput('birthYear', d.birthYear, { placeholder: 'ex. 1990', min: 1930, max: 2015 })}<small class="muted">Pour estimer ta FC max</small></label>
      <label><span class="field-label">Poids</span>${numInput('weightKg', d.weightKg, { placeholder: 'ex. 70', min: 30, max: 200, step: 0.5, unit: 'kg' })}<small class="muted">Pour les watts par kilo</small></label>
    </div>
    ${bike}${run}
    <h3 class="sec">${icon('heart', 22)} Cœur</h3>
    <div class="field-grid">
      <label><span class="field-label">FC max</span>${numInput('refs.fcmax', d.refs.fcmax, { placeholder: hint('fcmax', 'si tu la connais'), min: 100, max: 230, unit: 'bpm' })}</label>
      <label><span class="field-label">FC au repos</span>${numInput('refs.fcrest', d.refs.fcrest, { placeholder: 'au réveil', min: 30, max: 110, unit: 'bpm' })}</label>
    </div>`;
}

/**
 * « Où je me situe » : ce que les repères disent de toi — moteur dans chaque
 * sport, profil du cycliste, chronos probables à pied.
 */
function insightsCard(d) {
  const r = refs(d);
  const p = athleteProfile(r);
  const rows = [];
  const approx = (key) => (r.est[key] ? ' (repère estimé)' : '');
  if (d.split > 0) {
    if (p.vo2.bike) {
      rows.push(['Moteur à vélo', `VO2max d’environ ${p.vo2.bike} ml/min/kg — ${vo2Label(p.vo2.bike)}${p.wkg ? `, soit ${String(p.wkg).replace('.', ',')} W/kg au seuil` : ''}${approx('pma')}.`]);
    } else {
      rows.push(['Moteur à vélo', r.pma ? 'Indique ton poids pour que je l’estime.' : 'Il me faut ta PMA ou ta FTP, et ton poids.']);
    }
    rows.push([p.bike ? p.bike.title : 'Profil du cycliste', p.bike ? p.bike.text : 'Diesel ou puncheur ? Pour le savoir, il faut ta PMA et ta FTP mesurées toutes les deux : c’est le rôle du test 5 + 20 min, placé en fin de semaine allégée.']);
  }
  if (d.split < 1) {
    if (p.vo2.run) {
      rows.push(['Moteur à pied', `VO2max d’environ ${p.vo2.run} ml/min/kg — ${vo2Label(p.vo2.run)}${approx('vma')}.`]);
      rows.push(['Ce que tu vaux aujourd’hui', `${p.predictions.map((x) => `${x.label} en ${fmtClock(Math.round(x.sec / 60) * 60)} (${x.pace} /km)`).join(' · ')}. À condition d’avoir préparé la distance.`]);
    } else {
      rows.push(['Moteur à pied', 'Il me faut ta VMA : un test de 6 minutes, ou quelques courses enregistrées.']);
    }
  }
  // Tant qu'un des deux repères est estimé, la comparaison reste une piste, pas un verdict.
  const unsure = r.est.pma || r.est.vma ? ' C’est une piste, à confirmer par un test dans chaque sport.' : '';
  if (p.lead === 'bike') rows.push(['Vélo et course', `Ton moteur semble plus développé à vélo qu’à pied : c’est en course à pied que tu as le plus à gagner.${unsure}`]);
  if (p.lead === 'run') rows.push(['Vélo et course', `Ton moteur semble plus développé à pied qu’à vélo : c’est sur le vélo que tu as le plus à gagner.${unsure}`]);
  if (p.lead === 'even') rows.push(['Vélo et course', `Ton moteur est au même niveau dans les deux sports : un bon équilibre.${unsure}`]);
  return `<dl class="why-list">${rows.map(([t, x]) => `<div><dt>${t}</dt><dd>${esc(x)}</dd></div>`).join('')}</dl>
    <p class="muted small">Des ordres de grandeur, calculés d’après tes repères. ${btn('Comment c’est calculé', 'open-article', { cls: 'link-btn', data: { id: 'profil' } })}</p>`;
}

// ---------------------------------------------------------------------------
// Premier lancement
// ---------------------------------------------------------------------------

const OB_STEPS = [
  {
    mood: 'pumped', title: 'Salut, moi c’est Momo !',
    text: 'Je suis une marmotte : l’endurance et la sieste, ça me connaît. Réponds à 5 petites questions et je te prépare un plan vélo + course à pied qui tient dans ton emploi du temps.',
    body: (d) => `<label class="field-block"><span class="field-label">Ton prénom</span>
      <input class="input big" type="text" maxlength="30" data-field="name" value="${esc(d.name)}" placeholder="Comment je t’appelle ?" autocomplete="given-name"></label>
      <p class="muted small ob-restore">Tu as déjà un carnet Enduro (sur ton Mac, par exemple) ? ${restoreButton('Restaure ta sauvegarde', 'link-btn')}</p>`,
  },
  { mood: 'happy', title: 'Tu roules, tu cours, ou les deux ?', text: 'Je répartirai les séances en conséquence.', body: sportsField },
  { mood: 'happy', title: 'On vise quoi ?', text: 'Avec une date, je construis le plan à rebours jusqu’au jour J. Tu peux me donner jusqu’à trois objectifs, ou aucun.', body: goalsField },
  { mood: 'happy', title: 'Où en es-tu ?', text: 'Sois honnête : partir de trop haut, c’est le meilleur moyen de se cramer.', body: levelField },
  { mood: 'happy', title: 'Ton temps, jour par jour', text: 'Indique le temps que tu peux vraiment consacrer au sport chaque jour. Aucune séance ne dépassera.', body: availField },
  { mood: 'proud', title: 'Tes repères (facultatif)', text: 'Tu ne connais pas ces chiffres ? Laisse vide : je les estime d’après tes sorties Zwift et Strava, et je te proposerai un vrai test plus tard.', body: refsField },
];

/** Chaque objectif affiché doit avoir une date à venir. Renvoie le message d'erreur, ou null. */
export function goalsError(d) {
  const shown = (d.goals ?? []).filter((g) => !g.date || g.date >= S.today);
  if (shown.some((g) => !/^\d{4}-\d{2}-\d{2}$/.test(g.date ?? '') || g.date <= S.today)) {
    return 'Indique la date de chaque objectif (dans le futur), ou retire celui qui n’en a pas.';
  }
  return null;
}

export function obError(ob) {
  const d = ob.draft;
  if (ob.step === 2) return goalsError(d);
  if (ob.step === 4 && !d.avail.some((m) => m >= 30)) return 'Il me faut au moins un créneau de 30 minutes dans la semaine.';
  return null;
}

export function onboardingView() {
  const ob = S.ui.ob;
  const step = OB_STEPS[ob.step];
  const last = ob.step === OB_STEPS.length - 1;
  const dots = OB_STEPS.map((_, i) => `<i class="${i === ob.step ? 'on' : i < ob.step ? 'past' : ''}"></i>`).join('');
  return `<div class="onboarding">
    <div class="ob-brand">Enduro</div>
    <section class="hero">
      <div class="hero-momo">${momo(step.mood, 150)}</div>
      <div class="bubble"><h1>${step.title}</h1><p>${step.text}</p></div>
    </section>
    <section class="card ob-card">
      ${step.body(ob.draft)}
      ${ob.error ? `<p class="warn">${esc(ob.error)}</p>` : ''}
      <div class="ob-nav">
        ${ob.step > 0 ? btn('Retour', 'ob-back', { cls: 'ghost', ico: 'left' }) : '<span></span>'}
        <div class="dots">${dots}</div>
        ${last ? btn('Créer mon plan', 'ob-finish', { cls: 'primary', ico: 'flag' }) : btn('Continuer', 'ob-next', { cls: 'primary', ico: 'right' })}
      </div>
    </section>
  </div>`;
}

// ---------------------------------------------------------------------------
// Profil
// ---------------------------------------------------------------------------

/** Version en ligne (téléphone) : pas de serveur, tout reste dans le navigateur. */
const online = () => S.server?.mode === 'local';

function zwiftCard() {
  const z = S.zwift ?? {};
  const count = S.activities.filter((a) => a.source === 'zwift' || a.sources?.includes('zwift')).length;
  if (online()) {
    return card(`${icon('screen', 24)} Zwift`, `
      <ul class="tips">
        <li><strong>Zwift → Enduro :</strong> Zwift envoie tes sorties à Strava, et Strava à Enduro (carte ci-dessous). Il suffit que Zwift soit relié à Strava (appli Zwift Companion → Connexions).</li>
        <li><strong>Enduro → Zwift :</strong> le bouton « Envoyer vers Zwift » ouvre le partage : choisis ton Mac dans AirDrop. Sur le Mac, la séance est rangée toute seule dans Zwift (Entraînements personnalisés), si la réception AirDrop y est installée.</li>
      </ul>
      <details class="fold"><summary>Installer la réception AirDrop sur le Mac</summary>
        <p class="muted small">Une seule fois, dans le Terminal du Mac, dans le dossier d’Enduro : <code>npm run zwift:airdrop</code>. Pour la retirer : <code>npm run zwift:airdrop:retirer</code>. Elle ne touche qu’aux fichiers « enduro-….zwo » arrivés dans Téléchargements.</p>
      </details>`, { cls: 'conn' });
  }
  if (!z.found) {
    return card(`${icon('screen', 24)} Zwift`, `<p>Zwift n’a pas été trouvé sur cet ordinateur (dossier Documents/Zwift). Installe-le et lance-le une fois, puis reviens ici.</p>`, { cls: 'conn' });
  }
  return card(`${icon('screen', 24)} Zwift`, `
    <p class="ok-line">${icon('check', 20)} Zwift est installé sur ce Mac : tout se passe en direct, sans compte ni mot de passe.</p>
    <ul class="tips">
      <li><strong>Zwift → Enduro :</strong> tes sorties sont lues automatiquement à chaque ouverture (${count} importée${count > 1 ? 's' : ''}).</li>
      <li><strong>Enduro → Zwift :</strong> ${z.canExport ? 'le bouton « Envoyer vers Zwift » dépose tes séances dans Entraînements personnalisés.' : 'lance Zwift une première fois pour activer l’envoi des séances.'}</li>
      <li><strong>Depuis le téléphone :</strong> ${S.server?.airdrop
    ? 'réception AirDrop active. Une séance envoyée depuis Enduro en ligne est rangée ici toute seule.'
    : 'pour recevoir les séances envoyées par AirDrop depuis Enduro en ligne, lance une fois <code>npm run zwift:airdrop</code> dans le Terminal, dans le dossier d’Enduro.'}</li>
    </ul>
    <div class="actions minor">${btn('Relire mes sorties Zwift', 'zwift-import', { cls: 'small', ico: 'sync' })}${btn('Comment ça marche ?', 'open-article', { cls: 'small ghost', data: { id: 'ht' } })}</div>
  `, { cls: 'conn' });
}

function stravaCard() {
  const st = S.strava ?? {};
  const result = S.ui.stravaResult;
  const notice = {
    ok: '<p class="ok-line">Strava est connecté. Première synchronisation en cours…</p>',
    refus: '<p class="warn">Connexion annulée côté Strava.</p>',
    droits: '<p class="warn">Il faut cocher l’accès aux activités pour que ça marche.</p>',
    expire: '<p class="warn">La demande a expiré : relance la connexion.</p>',
    erreur: '<p class="warn">Strava a refusé la connexion : vérifie le Client ID et le Client Secret.</p>',
  }[result] ?? '';
  if (st.connected) {
    const last = st.lastSync ? new Date(st.lastSync * 1000).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'jamais';
    return card(`${icon('sync', 24)} Strava`, `${notice}
      <p class="ok-line">${icon('check', 20)} Connecté${st.athlete?.name ? ` en tant que ${esc(st.athlete.name)}` : ''}. Dernière synchro : ${last}.</p>
      <p class="muted small">Tes sorties et tes courses arrivent toutes seules à l’ouverture de l’app. Les doublons avec Zwift sont fusionnés.</p>
      <div class="actions minor">${btn('Synchroniser maintenant', 'strava-sync', { cls: 'small', ico: 'sync' })}${btn('Déconnecter', 'strava-disconnect', { cls: 'small ghost' })}</div>`, { cls: 'conn' });
  }
  if (st.configured && !S.ui.stravaEdit) {
    return card(`${icon('sync', 24)} Strava`, `${notice}
      <p>Tes identifiants sont enregistrés. Il reste à autoriser l’accès à tes activités.</p>
      <div class="actions minor">${btn('Connecter Strava', 'strava-connect', { cls: 'small primary', ico: 'right' })}${btn('Modifier les identifiants', 'strava-edit', { cls: 'small ghost' })}</div>`, { cls: 'conn' });
  }
  return card(`${icon('sync', 24)} Strava <small>facultatif</small>`, `${notice}
    <p>Pour récupérer automatiquement tes sorties dehors et tes courses à pied. Depuis juin 2026, Strava réserve cette possibilité à ses abonnés.</p>
    <ol class="howto">
      <li>Ouvre <a href="https://www.strava.com/settings/api" target="_blank" rel="noopener">strava.com/settings/api</a> et crée une application (nom libre, par exemple « Mon carnet »).</li>
      <li>Dans le champ <strong>Authorization Callback Domain</strong>, écris <code>${online() ? esc(location.hostname) : 'localhost'}</code>.${online() ? ' Si tu as déjà une application pour Enduro sur le Mac, modifie simplement ce champ : Strava accepte toujours <code>localhost</code> en plus.' : ''}</li>
      <li>Recopie ci-dessous le <strong>Client ID</strong> et le <strong>Client Secret</strong> affichés par Strava.</li>
    </ol>
    <div class="field-grid">
      <label><span class="field-label">Client ID</span><input class="input" id="strava-id" type="text" inputmode="numeric" autocomplete="off" data-ui="stravaId" value="${esc(S.ui.stravaId ?? '')}" placeholder="ex. 123456"></label>
      <label><span class="field-label">Client Secret</span><input class="input" id="strava-secret" type="password" autocomplete="off" data-ui="stravaSecret" value="${esc(S.ui.stravaSecret ?? '')}" placeholder="longue suite de lettres et chiffres"></label>
    </div>
    <p class="muted small">${online() ? 'Ces identifiants restent dans ce navigateur et ne servent qu’à parler à Strava.' : 'Ces identifiants restent sur cet ordinateur (fichier data/secrets.json).'} Pas d’abonnement ? Aucun souci : valide tes séances avec « C’est fait » ou importe des fichiers ci-dessous.</p>
    <div class="actions minor">${btn('Enregistrer et connecter', 'strava-save', { cls: 'small primary', ico: 'right' })}</div>`, { cls: 'conn' });
}

function withingsCard() {
  const w = S.withings ?? {};
  const notice = {
    ok: '<p class="ok-line">Withings est connecté. Récupération de tes nuits en cours…</p>',
    refus: '<p class="warn">Connexion annulée côté Withings.</p>',
    expire: '<p class="warn">La demande a expiré : relance la connexion.</p>',
    erreur: '<p class="warn">Withings a refusé la connexion : vérifie le Client ID, le Client Secret et l’adresse de retour.</p>',
  }[S.ui.withingsResult] ?? '';
  const title = `${icon('heart', 24)} Montre Withings`;
  if (w.connected) {
    const nights = Object.values(S.nights ?? {}).filter((n) => n.rmssd > 0).length;
    const last = w.lastSync ? new Date(w.lastSync * 1000).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'jamais';
    return card(title, `${notice}
      <p class="ok-line">${icon('check', 20)} Connectée. Dernière synchro : ${last}${nights ? ` · ${nights} nuit${nights > 1 ? 's' : ''} avec VFC` : ''}.</p>
      <p class="muted small">Chaque matin, Enduro lit ta nuit (pouls et VFC) dès que ta montre s’est synchronisée avec l’appli Withings, et la compare à ton habitude.</p>
      <div class="actions minor">${btn('Synchroniser maintenant', 'withings-sync', { cls: 'small', ico: 'sync' })}${btn('Déconnecter', 'withings-disconnect', { cls: 'small ghost' })}</div>`, { cls: 'conn' });
  }
  if (w.configured && !S.ui.withingsEdit) {
    const paste = S.ui.withingsPaste ? `<div class="callout">
        <p><strong>Une fois l’accès autorisé</strong>, Withings ouvre une page qui ne s’affiche sans doute pas : c’est normal. Copie son adresse (elle contient <code>code=</code>), reviens ici et colle-la tout de suite — le code ne vaut que 30 secondes.</p>
        <input class="input" id="withings-paste" type="text" autocomplete="off" placeholder="Colle ici l’adresse de la page de retour">
        <div class="actions minor">${btn('Valider', 'withings-paste', { cls: 'small primary', ico: 'check' })}</div>
      </div>` : '';
    // Page de retour hors d'Enduro : Withings s'ouvre dans un autre onglet (un vrai lien, que les navigateurs ne bloquent pas).
    const connect = w.customRedirect
      ? `<a class="btn small primary" id="withings-open" href="#" target="_blank" rel="noopener">${icon('right', 20)}<span>Connecter Withings</span></a>`
      : btn('Connecter Withings', 'withings-connect', { cls: 'small primary', ico: 'right' });
    return card(title, `${notice}
      <p>Tes identifiants sont enregistrés. Il reste à autoriser Enduro à lire tes nuits.</p>${paste}
      <div class="actions minor">${connect}${btn('Modifier les identifiants', 'withings-edit', { cls: 'small ghost' })}</div>`, { cls: 'conn' });
  }
  const custom = S.ui.withingsRedirect ?? (w.customRedirect ? w.redirectUri : '');
  return card(`${title} <small>facultatif</small>`, `${notice}
    <p>Ta montre mesure ton pouls et ta VFC (variabilité de la fréquence cardiaque) pendant la nuit. Enduro s’en sert pour le feu du matin, sans que tu aies rien à saisir.</p>
    <ol class="howto">
      <li>Ouvre <a href="https://developer.withings.com/dashboard/" target="_blank" rel="noopener">developer.withings.com/dashboard</a>, connecte-toi avec ton compte Withings et crée une application de type <strong>Public API integration</strong> (nom libre, par exemple « Mon carnet »).</li>
      <li>Dans <strong>Callback URL</strong>, colle cette adresse : <code>${esc(w.redirectUri ?? '')}</code></li>
      <li>Recopie ci-dessous le <strong>Client ID</strong> et le <strong>Client Secret</strong> affichés par Withings.</li>
    </ol>
    <div class="field-grid">
      <label><span class="field-label">Client ID</span><input class="input" id="withings-id" type="text" autocomplete="off" data-ui="withingsId" value="${esc(S.ui.withingsId ?? '')}" placeholder="longue suite de lettres et chiffres"></label>
      <label><span class="field-label">Client Secret</span><input class="input" id="withings-secret" type="password" autocomplete="off" data-ui="withingsSecret" value="${esc(S.ui.withingsSecret ?? '')}" placeholder="longue suite de lettres et chiffres"></label>
    </div>
    <details class="fold"${custom ? ' open' : ''}><summary>Withings refuse cette adresse ?</summary>
      <p class="muted small">Écris ici l’adresse de retour que Withings a acceptée. Après l’autorisation, Enduro te demandera simplement de coller l’adresse de la page où Withings t’a renvoyé.</p>
      <label><span class="field-label">Adresse de retour déclarée chez Withings</span><input class="input" id="withings-redirect" type="url" autocomplete="off" data-ui="withingsRedirect" value="${esc(custom)}" placeholder="https://…"></label>
    </details>
    <p class="muted small">${online() ? 'Ces identifiants restent dans ce navigateur et ne servent qu’à parler à Withings.' : 'Ces identifiants restent sur cet ordinateur (fichier data/secrets.json).'} Enduro ne demande que le droit de lire ton activité et ton sommeil.</p>
    <div class="actions minor">${btn('Enregistrer et connecter', 'withings-save', { cls: 'small primary', ico: 'right' })}</div>`, { cls: 'conn' });
}

function filesCard() {
  return card(`${icon('upload', 24)} Importer des fichiers`, `
    <p>Une sortie enregistrée ailleurs (compteur, montre, export Strava) ? Dépose son fichier <strong>.fit</strong> ou <strong>.gpx</strong>.</p>
    <label class="drop" id="drop">
      <input type="file" id="file-input" accept=".fit,.gpx" multiple hidden>
      ${icon('upload', 30)}<span>Choisir des fichiers… ou les glisser ici</span>
    </label>
    <p class="muted small">Sur Strava : ouvre une activité, menu « … » → « Exporter le fichier d’origine » ou « Exporter en GPX ».</p>`, { cls: 'conn' });
}

/** Champ « Restaurer une sauvegarde » : un vrai bouton de fichier, que les téléphones savent ouvrir. */
export function restoreButton(label = 'Restaurer une sauvegarde', cls = 'btn small') {
  return `<label class="${cls}">${icon('download', 18)}<span>${label}</span><input type="file" id="restore-input" accept=".json,application/json" hidden></label>`;
}

function restoreCallout() {
  const r = S.ui.restore;
  if (!r) return '';
  return `<div class="callout">
      <p><strong>Remplacer tout ce carnet par « ${esc(r.fileName)} » ?</strong> Profil, plan, ${r.acts} activité${r.acts > 1 ? 's' : ''}, ressentis : ce qui est ici sera effacé${online() ? '' : ' (une copie est gardée dans data/sauvegardes)'}.</p>
      <div class="actions minor">${btn('Oui, remplacer', 'restore-confirm', { cls: 'small primary', ico: 'check' })}${btn('Annuler', 'restore-cancel', { cls: 'small ghost' })}</div>
    </div>`;
}

function dataCard() {
  const shared = S.server?.shared && S.server.addresses?.length
    ? `<p class="muted small">Depuis ton téléphone (même Wi-Fi) : <code>http://${esc(S.server.addresses[0])}:${S.server.port}</code></p>` : '';
  const where = online()
    ? `<p>Tout est enregistré dans ce navigateur, sur cet appareil. Rien n’est envoyé ailleurs (sauf à Strava ou Withings, si tu les connectes).</p>
      <p class="muted small">Effacer les données du navigateur effacerait aussi ton carnet : télécharge une sauvegarde de temps en temps. Elle sert aussi à passer d’un appareil à l’autre (« Restaurer une sauvegarde » de l’autre côté).</p>`
    : `<p>Tout est enregistré sur cet ordinateur, dans le dossier <code>data</code> de l’application. Rien n’est envoyé ailleurs.</p>${shared}
      <p class="muted small">Pour continuer sur ton téléphone : télécharge une sauvegarde, envoie-la sur le téléphone (AirDrop…), ouvre Enduro en ligne et choisis « Restaurer une sauvegarde ».</p>`;
  return card('Mes données', `${where}${restoreCallout()}
    <div class="actions minor">
      ${btn('Télécharger une sauvegarde', 'export-data', { cls: 'small', ico: 'upload' })}
      ${restoreButton()}
      ${btn(S.ui.confirmReset ? 'Oui, tout effacer pour de bon' : 'Tout effacer et recommencer', 'reset-all', { cls: `small ghost danger ${S.ui.confirmReset ? 'armed' : ''}`, ico: 'trash' })}
    </div>`);
}

export function profileView() {
  const d = S.ui.form.draft;
  return `<div class="page-title"><span>${icon('gear', 30)}</span><h1>Profil</h1><p>${S.profile.createdAt ? `Plan démarré le ${fmtDate(S.profile.createdAt, { day: 'numeric', month: 'long', year: 'numeric' })}.` : ''}</p></div>
  <div class="grid two">
    ${card('Moi', `<label class="field-block"><span class="field-label">Prénom</span><input class="input" type="text" maxlength="30" data-field="name" value="${esc(d.name)}"></label>
      <span class="field-label">Mes sports</span>${sportsField(d)}`)}
    ${card('Mes objectifs', goalsField(d))}
  </div>
  <div class="grid two">
    ${card('Mon temps', availField(d))}
    ${card('Mon niveau et mon volume', `${levelField(d)}`)}
  </div>
  ${card('Mes repères', `${refsField(d)}
    <p class="muted small">${btn('Voir mes zones', 'open-article', { cls: 'link-btn', data: { id: 'zones' } })} · ${btn('Comment se tester', 'open-article', { cls: 'link-btn', data: { id: 'tests' } })}</p>`)}
  ${card('Où je me situe', insightsCard(d), { cls: 'explain' })}
  <div class="save-bar">${btn('Enregistrer mon profil', 'save-profile', { cls: 'primary', ico: 'check' })}<small class="muted">Si tu changes ton temps, ton niveau ou tes objectifs, le plan est reconstruit à partir d’aujourd’hui.</small></div>
  <div class="page-title sub"><h1>Connexions</h1></div>
  <div class="grid two">${zwiftCard()}${stravaCard()}</div>
  <div class="grid two">${withingsCard()}${filesCard()}</div>
  ${dataCard()}`;
}
