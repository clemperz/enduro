// Écran « S'entraîner » : le mot de Momo, la séance du jour, la semaine, le profil du plan.

import { S, fitness, todayReadiness, todayNight, todayEcg, weekAt, planPreview, activityById, goals } from '../store.js';
import { momo, face, icon, sportIcon } from '../art.js';
import { workoutChart, planProfile } from '../charts.js';
import { DAYS, addDays, mondayOf, fmtDate, fmtDuration, dayIndex, fmtShort } from '../../engine/dates.js';
import { FEELINGS, proposeAdaptation, pulseBaseline } from '../../engine/readiness.js';
import { PHASES, planProgress } from '../../engine/plan.js';
import { weekTotals, RPE_LABELS, LOAD_METHOD_LABELS } from '../../engine/load.js';
import { pendingNotices, canUndo } from '../../engine/coach.js';
import { esc, btn, card, sessionTitle, sessionMeta, sportBadge } from './common.js';

const firstName = () => esc((S.profile?.name ?? '').trim().split(/\s+/)[0] || 'champion');

function todaySessions() {
  const { week } = weekAt(0);
  return (week?.sessions ?? []).filter((s) => s.date === S.today);
}

const fmtSleep = (min) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;

/** Ce que dit la VFC du jour, comparée à ton habitude (nuit ou ECG du matin). */
function hrvVerdict(h, learning) {
  if (!h) return '';
  const [text, cls] = !h.base ? [learning, 'learn']
    : h.trendLow ? ['sous ta normale cette semaine', 'low']
      : h.nightLow ? ['plus basse que d’habitude', 'low']
        : h.high ? ['au-dessus de ta normale', 'high']
          : ['dans ta normale', 'ok'];
  return ` <em class="night-verdict ${cls}">${text}</em>`;
}

/** Ce que la montre a mesuré cette nuit, comparé à ton habitude (si Withings est branché). */
function nightLine() {
  if (!S.withings?.connected && !S.nights?.[S.today]) return '';
  const n = todayNight();
  if (!n) {
    return `<p class="night muted">${icon('rest', 18)}<span>Pas encore de nuit reçue de ta montre. Ouvre l’appli Withings pour la synchroniser, puis ${btn('actualise', 'withings-sync', { cls: 'link-btn' })}.</span></p>`;
  }
  const parts = [];
  if (n.hr) parts.push(`cœur <strong>${n.hr.value}</strong>${n.hr.base ? ` <small>(d’habitude ${Math.round(n.hr.base)})</small>` : ''}`);
  if (n.hrv) parts.push(`VFC <strong>${Math.round(n.hrv.value)} ms</strong>${n.hrv.base ? ` <small>(d’habitude ${n.hrv.base.ms})</small>` : ''}`);
  if (!parts.length) parts.push('pas de pouls mesuré');
  return `<p class="night">${icon('rest', 18)}<span>Cette nuit${n.sleepMin ? ` (${fmtSleep(n.sleepMin)} de sommeil)` : ''} : ${parts.join(' · ')}${hrvVerdict(n.hrv, 'Enduro apprend ton habitude : il lui faut une semaine de nuits.')}
    ${btn('C’est quoi ?', 'open-article', { cls: 'link-btn', data: { id: 'recup' } })}</span></p>`;
}

/** L'ECG de 30 s fait ce matin avec la montre : on l'importe, Enduro en tire la VFC. */
function ecgLine() {
  const e = todayEcg();
  if (!e) {
    const busy = S.ui.busy?.ecg;
    return `<div class="night ecg-pick" id="ecg-drop">${icon('heart', 18)}<span>VFC du matin : ${busy ? 'lecture de l’ECG…'
      : `<label class="btn link-btn" for="ecg-input">importe l’ECG de ta montre (PDF)</label><input type="file" id="ecg-input" accept=".pdf,application/pdf" hidden>`}
      ${btn('Comment ?', 'open-article', { cls: 'link-btn', data: { id: 'recup' } })}</span></div>`;
  }
  const m = S.ecg[S.today];
  const parts = [
    `cœur <strong>${Math.round(e.hr.value)}</strong>${e.hr.base ? ` <small>(d’habitude ${Math.round(e.hr.base)})</small>` : ''}`,
    `VFC <strong>${Math.round(e.hrv.value)} ms</strong>${e.hrv.base ? ` <small>(d’habitude ${e.hrv.base.ms})</small>` : ''}`,
  ];
  // L'habitude demande 7 ECG sur les 4 semaines précédentes (voir nights.js).
  const before = Object.keys(S.ecg).filter((d) => d < S.today && d >= addDays(S.today, -28)).length;
  const learning = `Enduro apprend ton habitude : encore ${Math.max(1, 7 - before)} ECG du matin.`;
  return `<p class="night">${icon('heart', 18)}<span>ECG de ce matin${e.at ? ` (${e.at.slice(11, 16).replace(':', ' h ')})` : ''} : ${parts.join(' · ')}${hrvVerdict(e.hrv, learning)}
    <small class="muted">${m.beats} battements lus${m.rejected ? `, ${m.rejected} irrégulier${m.rejected > 1 ? 's' : ''} écarté${m.rejected > 1 ? 's' : ''}` : ''}.</small>
    ${btn('Retirer', 'ecg-delete', { cls: 'link-btn', data: { date: S.today } })}</span></p>`;
}

function hero(sessions) {
  const ready = todayReadiness();
  const checkin = S.checkins[S.today];
  const planned = sessions.filter((s) => s.status === 'planned');
  const done = sessions.filter((s) => s.status === 'done');
  let mood = ready.mood;
  let title = `${ready.title}, ${firstName()}${ready.level === 'vert' || ready.level === 'bleu' ? ' !' : '.'}`;
  const lines = [...ready.reasons];
  if (done.length && !planned.length) {
    mood = 'proud';
    title = `Bien joué, ${firstName()} !`;
    lines.length = 0;
    lines.push('Séance du jour validée. Mange, bois, et savoure.');
  } else if (!sessions.length) {
    if (ready.level === 'vert' || ready.level === 'bleu') mood = 'sleep';
    lines.push('Aujourd’hui c’est repos : c’est là que tu progresses.');
  } else if (planned.length) {
    const s = planned[0];
    const already = Math.round(fitness().todayLoad);
    if (already > 0) {
      // Une autre activité a déjà été faite aujourd'hui (une course, une sortie libre…).
      lines.push(`Tu as déjà ${already} points au compteur aujourd’hui : la séance prévue (${s.title.toLowerCase()}) devient un bonus, écoute tes jambes.`);
    } else {
      if (ready.level === 'vert') lines.push(`Au menu : ${s.title.toLowerCase()}${s.detail ? ` ${s.detail}` : ''}.`);
      if (ready.level === 'bleu') lines.push(s.hard >= 2 ? 'Parfait pour la séance du jour : fais-toi plaisir !' : 'Garde ça sous le pied : la séance du jour reste facile.');
    }
  }

  const faces = FEELINGS.map((f) => `
    <button type="button" class="feel ${checkin?.feel === f.v ? 'on' : ''}" data-act="feel" data-v="${f.v}" aria-pressed="${checkin?.feel === f.v}">
      ${face(f.v, f.color, 46)}<span>${f.label}</span>
    </button>`).join('');
  const sick = `<button type="button" class="link" data-act="sick">${checkin?.sick ? '✓ Malade ou blessé — annuler' : 'Malade ou blessé ?'}</button>`;
  // Facultatif : le pouls de repos, compté au réveil. Comparé à ton habitude, il dit si tu as récupéré.
  const base = pulseBaseline(S.checkins, S.today);
  const pulse = `<label class="pulse"><span>Pouls au réveil <small>(facultatif)</small></span>
      <input class="input" type="number" inputmode="numeric" min="30" max="120" step="1" data-change="pulse" value="${checkin?.pulse ?? ''}" placeholder="${base ? `d’habitude ${Math.round(base)}` : 'ex. 52'}" aria-label="Pouls de repos au réveil, en battements par minute">
    </label>`;

  return `<section class="hero">
    <div class="hero-momo">${momo(mood, 150)}</div>
    <div class="bubble">
      <h1>${title}</h1>
      ${lines.map((l) => `<p>${esc(l)}</p>`).join('')}
      <div class="checkin">
        <div class="checkin-q">${checkin ? 'Ton ressenti du jour' : 'Comment tu te sens aujourd’hui ?'}</div>
        <div class="feels">${faces}</div>
        <div class="checkin-more">${pulse}${sick}</div>
        ${nightLine()}
        ${ecgLine()}
      </div>
    </div>
  </section>`;
}

/** Une entrée du journal : ce qui a changé, pourquoi, et de quoi revenir en arrière. */
export function journalEntry(e, { compact = false } = {}) {
  const undo = canUndo(S.plan, e, S.today);
  const when = e.date === S.today ? 'aujourd’hui' : fmtDate(e.date, { weekday: 'long', day: 'numeric', month: 'long' });
  const tools = [
    undo ? btn('Rétablir comme avant', 'undo-auto', { cls: 'small', ico: 'swap', data: { key: e.key } }) : '',
    compact ? btn('Compris', 'journal-seen', { cls: 'small ghost', ico: 'check', data: { key: e.key } }) : '',
  ].join('');
  return `<article class="jr ${e.undone ? 'undone' : ''} ${e.rule}">
    <div class="jr-head"><strong>${esc(e.title)}</strong><small>${when}${e.undone ? ' · annulé par toi' : ''}</small></div>
    <p class="jr-why">${esc(e.why)}</p>
    ${e.changes?.length ? `<ul class="jr-changes">${e.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    ${tools ? `<div class="row">${tools}</div>` : ''}
  </article>`;
}

function coachBanner() {
  const pending = pendingNotices(S.plan);
  if (!pending.length) return '';
  const shown = pending.slice(0, 2);
  const more = pending.length - shown.length;
  return `<section class="coach">
    <div class="coach-head">
      <span class="coach-ico">${icon('swap', 24)}</span>
      <h2>Momo a ajusté ton plan</h2>
      ${btn('Tout le journal', 'go', { cls: 'link-btn', data: { to: '#/comprendre' } })}
    </div>
    ${shown.map((e) => journalEntry(e, { compact: true })).join('')}
    ${more > 0 ? `<p class="muted small">Et ${more} autre${more > 1 ? 's' : ''} ajustement${more > 1 ? 's' : ''} : ${btn('tout marquer comme vu', 'journal-seen', { cls: 'link-btn' })}</p>` : ''}
  </section>`;
}

function adaptBanner(session) {
  const ready = todayReadiness();
  const prop = session.keepAsIs ? null : proposeAdaptation(session, ready.level);
  if (!prop) return '';
  return `<div class="banner ${ready.level}">
    <div class="banner-ico">${icon('feather', 26)}</div>
    <div class="banner-body">
      <strong>Momo propose d’alléger.</strong> ${esc(prop.text)}
      <div class="row">
        ${btn(prop.mode === 'recup' ? 'D’accord, décrassage' : 'D’accord, on allège', 'lighten', { cls: 'small', data: { id: session.id, mode: prop.mode } })}
        ${prop.mode === 'recup' ? btn('Repos complet', 'skip', { cls: 'small', data: { id: session.id } }) : ''}
        ${btn('Je garde ma séance', 'keep', { cls: 'small ghost', data: { id: session.id } })}
      </div>
    </div>
  </div>`;
}

function doneBlock(s) {
  const a = s.activityId ? activityById(s.activityId) : null;
  if (!a) return `<p class="done-line">${icon('check', 20)} Séance faite.</p>`;
  const bits = [fmtDuration(a.durationSec / 60)];
  if (a.distanceKm) bits.push(`${a.distanceKm.toFixed(1).replace('.', ',')} km`);
  if (a.np || a.avgPower) bits.push(`${a.np || a.avgPower} W`);
  bits.push(`${a.load ?? 0} pts`);
  const rate = a.rpe
    ? `<button type="button" class="pill" data-act="open-activity" data-id="${esc(a.id)}">Ressenti ${a.rpe}/10 · ${RPE_LABELS[Math.round(a.rpe)]}</button>`
    : btn('Comment c’était ?', 'open-activity', { cls: 'small primary', data: { id: a.id } });
  return `<div class="done-box">
    <div class="done-line">${icon('check', 22)}<strong>C’est fait !</strong> <span>${bits.join(' · ')}</span></div>
    <div class="row">${rate}<span class="muted small">charge mesurée par ${LOAD_METHOD_LABELS[a.loadMethod] ?? 'estimation'}</span></div>
  </div>${testResult(s, a)}`;
}

/** Test fait avec un capteur de puissance (Zwift) : on propose d'adopter les résultats comme repères. */
function testResult(s, a) {
  if (s.kind !== 'test' || s.sport !== 'bike' || !a.best) return '';
  const raw = S.profile?.refs ?? {};
  const pma = a.best[300] ?? null;
  const ftp = a.best[1200] ? Math.round(a.best[1200] * 0.95) : null;
  if (!pma && !ftp) return '';
  const same = (!pma || Number(raw.pma) === pma) && (!ftp || Number(raw.ftp) === ftp);
  const text = [pma ? `PMA ${pma} W (tes 5 min)` : null, ftp ? `FTP ${ftp} W (95 % de tes 20 min)` : null].filter(Boolean).join(' · ');
  return `<div class="callout"><strong>Résultats du test :</strong> ${text}.
    ${same ? '<br>Ce sont déjà tes repères.' : `<div class="row">${btn('Mettre à jour mes repères', 'use-test', { cls: 'small primary', data: { pma, ftp } })}</div>`}</div>`;
}

export function sessionCard(s, { compact = false } = {}) {
  const isToday = s.date === S.today;
  const past = s.date < S.today;
  const status = s.status === 'done' ? 'done' : s.status === 'skipped' ? 'skipped' : past ? 'missed' : 'planned';
  const race = s.role === 'race';
  let actions = '';
  if (status === 'planned' || status === 'missed') {
    const main = [
      btn(past ? 'Je l’ai faite' : 'C’est fait', 'done', { cls: 'primary', ico: 'check', data: { id: s.id } }),
      !race && s.steps?.length ? btn('Le détail', 'open-session', { data: { id: s.id }, ico: 'info' }) : '',
      s.sport === 'bike' && !race && s.steps?.length && !past && S.server?.mode !== 'local'
        ? btn(s.zwift ? 'Dans Zwift ✓' : 'Envoyer vers Zwift', 'zwift', { cls: s.zwift ? 'sent' : 'zwift', ico: 'screen', data: { id: s.id } })
        : '',
    ].join('');
    const minor = !race && !past ? [
      btn('Moins de temps', 'less-time', { cls: 'ghost small', ico: 'clock', data: { id: s.id } }),
      s.hard >= 1 ? btn('Plus facile', 'lighten', { cls: 'ghost small', ico: 'feather', data: { id: s.id, mode: 'facile' } }) : '',
      s.manual
        ? btn('Retirer du plan', 'remove-session', { cls: 'ghost small', ico: 'trash', data: { id: s.id } })
        : btn(isToday ? 'Pas aujourd’hui' : 'Je passe', 'skip', { cls: 'ghost small', ico: 'close', data: { id: s.id } }),
    ].join('') : '';
    actions = `<div class="actions">${main}</div>${minor ? `<div class="actions minor">${minor}</div>` : ''}`;
  }
  const flag = s.auto ? `<span class="note-tag auto">${esc(s.auto.what)} par Momo${s.auto.what === 'allégée' ? ` (prévu : ${esc(s.auto.from)})` : ''}</span>`
    : s.lightened ? `<span class="note-tag">allégée (prévu : ${esc(s.lightened)})</span>`
    : s.resized ? '<span class="note-tag">raccourcie</span>'
      : s.moved ? '<span class="note-tag">déplacée</span>'
        : s.manual ? '<span class="note-tag mine">ajoutée par toi</span>' : '';
  const stateLine = status === 'missed' ? '<p class="state missed">Séance manquée — pas grave, on ne rattrape pas.</p>'
    : status === 'skipped' ? '<p class="state skipped">Séance passée.</p>' : '';
  return `<article class="session ${status} ${s.sport}">
    <div class="session-head">
      ${sportBadge(s.sport, compact ? 24 : 30)}
      <div class="session-titles">
        <h3>${sessionTitle(s)} ${flag}</h3>
        ${sessionMeta(s)}
      </div>
    </div>
    ${race ? '' : workoutChart(s, { height: compact ? 64 : 96 })}
    ${!compact && s.why ? `<p class="why">${esc(s.why)}</p>` : ''}
    ${s.fallback ? '<p class="state">Créneau trop court pour la séance prévue : on fait simple.</p>' : ''}
    ${stateLine}
    ${status === 'done' ? doneBlock(s) : ''}
    ${status === 'planned' && isToday ? adaptBanner(s) : ''}
    ${actions}
  </article>`;
}

function freeActivities(date, sessions) {
  const linked = new Set(sessions.map((s) => s.activityId).filter(Boolean));
  return S.activities.filter((a) => a.date === date && !linked.has(a.id));
}

export function activityRow(a) {
  const bits = [fmtDuration(a.durationSec / 60)];
  if (a.distanceKm) bits.push(`${a.distanceKm.toFixed(1).replace('.', ',')} km`);
  if (a.np || a.avgPower) bits.push(`${a.np || a.avgPower} W`);
  const src = { zwift: 'Zwift', strava: 'Strava', manual: 'Saisie', file: 'Fichier' }[a.source] ?? '';
  return `<button type="button" class="act-row" data-act="open-activity" data-id="${esc(a.id)}">
    <span class="act-ico ${a.sport}">${sportIcon(a.sport, 22)}</span>
    <span class="act-main"><strong>${esc(a.name || (a.sport === 'bike' ? 'Sortie vélo' : a.sport === 'run' ? 'Course à pied' : 'Activité'))}</strong>
      <small>${fmtDate(a.date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${bits.join(' · ')} · ${src}</small></span>
    <span class="act-load"><strong>${a.load ?? 0}</strong><small>pts</small></span>
    <span class="act-rpe ${a.rpe ? '' : 'todo'}">${a.rpe ? `${a.rpe}/10` : 'noter'}</span>
  </button>`;
}

function todayCard(sessions) {
  const free = freeActivities(S.today, sessions);
  let body;
  if (sessions.length) {
    body = sessions.map((s) => sessionCard(s)).join('');
  } else {
    body = `<div class="rest">
      <div class="rest-art">${icon('rest', 54)}</div>
      <div><h3>Repos</h3><p>Pas de séance prévue. Une balade, des étirements, une bonne nuit : tout ça compte.</p></div>
    </div>`;
  }
  const extra = free.length ? `<div class="free"><div class="eyebrow">Activités du jour</div>${free.map(activityRow).join('')}</div>` : '';
  const add = `<div class="actions minor">${btn(sessions.length ? 'Noter une autre activité' : 'J’ai quand même bougé', 'add-activity', { cls: 'ghost small', ico: 'plus', data: { date: S.today } })}</div>`;
  return card('', `<div class="eyebrow">Aujourd’hui · ${fmtDate(S.today)}</div>${body}${extra}${add}`, { cls: 'today' });
}

const SHORT = {
  endurance: 'Endurance', recup: 'Récup', long: 'Longue', sv1: 'End. haute', tempo: 'Tempo', sweetspot: 'Sweet spot', seuil: 'Seuil',
  pma3030: '30/30', vma3030: '30/30', pma: 'PMA', vma: 'VMA', force: 'Force', cotes: 'Côtes', allure10: 'All. 10 km', allure21: 'All. semi', allure42: 'All. marathon', test: 'Test', activation: 'Déblocage', course: 'Jour J',
};

function dayCell(date, sessions, isToday) {
  const i = dayIndex(date);
  // On affiche la première séance encore valable ; un badge signale les suivantes.
  const live = sessions.filter((x) => x.status !== 'skipped');
  const s = live[0] ?? sessions[0];
  const more = live.length > 1 ? `<span class="d-more">+${live.length - 1}</span>` : '';
  const acts = S.activities.filter((a) => a.date === date);
  let cls = 'rest';
  let ico = `<span class="d-ico">${icon('rest', 22)}</span>`;
  let label = 'Repos';
  let mark = '';
  if (s) {
    cls = s.status === 'done' ? 'done' : s.status === 'skipped' ? 'skipped' : date < S.today ? 'missed' : 'planned';
    ico = `<span class="d-ico ${s.sport}">${sportIcon(s.sport, 24)}</span>`;
    label = s.role === 'race' && s.major === false ? 'Étape'
      : s.sport === 'run' && s.kind === 'endurance' ? 'Footing' : s.sport === 'run' && s.kind === 'tempo' ? 'Active' : SHORT[s.kind] ?? s.title;
    if (cls === 'done') mark = `<span class="d-mark ok">${icon('check', 14)}</span>`;
    if (cls === 'missed') mark = `<span class="d-mark ko">${icon('close', 14)}</span>`;
  } else if (acts.length) {
    cls = 'done free';
    ico = `<span class="d-ico ${acts[0].sport}">${sportIcon(acts[0].sport, 24)}</span>`;
    label = 'Libre';
    mark = `<span class="d-mark ok">${icon('check', 14)}</span>`;
  }
  const planned = live.reduce((t, x) => t + (x.durationMin || 0), 0);
  const dur = planned ? fmtDuration(planned) : s?.durationMin ? fmtDuration(s.durationMin) : acts.length ? fmtDuration(acts.reduce((t, a) => t + a.durationSec, 0) / 60) : '';
  return `<button type="button" class="day ${cls} ${isToday ? 'today' : ''} ${s?.hard >= 2 ? 'hard' : ''}" data-act="open-day" data-date="${date}" aria-label="${DAYS[i].name} : ${esc(label)}">
    <span class="d-name">${DAYS[i].name.slice(0, 3)}</span>
    <span class="d-num">${Number(date.slice(8))}</span>
    ${ico}${mark}${more}
    <span class="d-title">${esc(label)}</span>
    <span class="d-dur">${dur}</span>
  </button>`;
}

/** Les séances ajoutées à la main couvrent déjà le volume prévu : on le dit, pour que le plan reste lisible. */
function fullNote(week) {
  if (!week?.targetMin) return '';
  const mine = week.sessions.filter((s) => s.manual && s.status !== 'skipped').reduce((t, s) => t + (s.durationMin || 0), 0);
  if (!mine || mine < week.targetMin) return '';
  return `<p class="hint">${icon('info', 18)} <span>Avec tes séances ajoutées (${fmtDuration(mine)}), le volume prévu de la semaine (${fmtDuration(week.targetMin)}) est atteint : au prochain recalcul, Momo n’en ajoutera pas d’autres.</span></p>`;
}

function weekCard() {
  const offset = S.ui.weekOffset;
  const { monday, week } = weekAt(offset);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const sessions = week?.sessions ?? [];
  const cells = dates.map((d) => dayCell(d, sessions.filter((s) => s.date === d), d === S.today)).join('');
  const totals = weekTotals(S.activities, monday);
  const planned = sessions.filter((s) => s.role !== 'race' && s.status !== 'skipped');
  const doneCount = sessions.filter((s) => s.status === 'done').length;
  const target = planned.reduce((t, s) => t + (s.durationMin || 0), 0);
  const pct = target ? Math.min(100, Math.round((totals.min / target) * 100)) : 0;
  const info = week?.info;
  const phase = info ? PHASES[info.phase] : null;
  // Les semaines enregistrées avant l'ajout de la longueur de bloc sont des blocs de 3.
  const cycle = (info?.etape ? 'semaine allégée · course de préparation'
    : info?.lead ? 'semaine de reprise après une course'
      : info?.cycleWeek ? (info.isRecovery ? 'semaine allégée' : `semaine ${info.cycleWeek} sur ${info.cycleLen ?? 3} de charge`) : '')
    + (week?.eased === 'fatigue' ? ' · reprise en douceur après une semaine de fatigue' : week?.eased ? ' · reprise en douceur après une semaine creuse' : '')
    + (week?.relief ? ' · allégée en route : tu étais fatigué' : '');
  const label = offset === 0 ? 'Cette semaine' : offset === 1 ? 'Semaine prochaine' : `Semaine du ${fmtShort(monday)}`;
  const toZwift = sessions.filter((s) => s.sport === 'bike' && s.status === 'planned' && s.date >= S.today && s.steps?.length);
  const tools = [];
  if (offset === 0 || offset === 1) {
    tools.push(btn('Ajouter une séance', 'plan-add', { cls: 'small', ico: 'plus', data: { date: offset === 0 ? S.today : monday } }));
  }
  if (toZwift.length > 1 && S.zwift?.canExport) tools.push(btn(`Envoyer mes ${toZwift.length} séances vélo vers Zwift`, 'zwift-week', { cls: 'small zwift', ico: 'screen', data: { monday } }));
  if (week) tools.push(btn('Pourquoi cette semaine ?', 'open-why', { cls: 'small ghost', ico: 'info', data: { monday } }));
  if (offset === 0 && week) tools.push(btn('Recalculer ma semaine', 'replan', { cls: 'small ghost', ico: 'sync' }));
  return card('', `
    <div class="week-nav">
      <button type="button" class="round" data-act="week" data-d="-1" aria-label="Semaine précédente" ${offset <= -8 ? 'disabled' : ''}>${icon('left', 20)}</button>
      <div class="week-title"><h2>${label}</h2><small>du ${fmtShort(monday)} au ${fmtShort(addDays(monday, 6))}</small></div>
      <button type="button" class="round" data-act="week" data-d="1" aria-label="Semaine suivante" ${offset >= 1 ? 'disabled' : ''}>${icon('right', 20)}</button>
    </div>
    ${phase ? `<div class="phase-line"><span class="phase-chip" style="--p:${phase.color}">${phase.label}</span><span>${cycle}</span></div>` : ''}
    <div class="days">${cells}</div>
    ${week ? `<div class="progress">
      <div class="progress-text"><strong>${doneCount} séance${doneCount > 1 ? 's' : ''} sur ${planned.length}</strong><span>${fmtDuration(totals.min)} faits · ${fmtDuration(target)} prévus</span></div>
      <div class="bar"><span style="width:${pct}%"></span></div>
    </div>` : '<p class="muted">Pas de plan enregistré pour cette semaine.</p>'}
    ${fullNote(week)}
    ${tools.length ? `<div class="actions minor">${tools.join('')}</div>` : ''}
  `, { cls: 'week' });
}

function planCard() {
  const weeks = planPreview();
  if (!weeks.length) return '';
  const monday = mondayOf(S.today);
  const info = weeks[0].info;
  const phase = PHASES[info.phase];
  const prog = planProgress(S.profile, S.plan, monday);
  const where = prog.week < 1 ? 'Semaine de mise en route' : prog.total ? `Semaine ${prog.week} sur ${prog.total}` : `Semaine ${prog.week}`;
  const list = goals();
  const chips = list.length
    ? `<div class="goal-chips">${list.map((g) => `<span class="goal-chip ${g.major ? 'major' : 'minor'}">
        <span class="goal-chip-ico">${sportIcon(g.sport, 20)}</span>
        <span><small>${g.horizon} · ${g.major ? 'objectif majeur' : 'étape'}</small><strong>${esc(g.name || (g.sport === 'bike' ? 'Épreuve à vélo' : 'Course à pied'))}</strong></span>
        <em>${g.daysLeft === 0 ? 'Jour J' : g.daysLeft < 14 ? `J-${g.daysLeft}` : `${g.weeksLeft} sem.`}</em>
      </span>`).join('')}</div>`
    : `<p class="muted small">Pas d’objectif daté : le plan enchaîne des cycles de 12 semaines. ${btn('Ajouter un objectif', 'go', { cls: 'link-btn', data: { to: '#/profil' } })}</p>`;
  return card('Le profil de mon plan', `
    <p class="plan-where"><strong>${where}</strong> · ${phase.label} — ${phase.blurb}</p>
    ${chips}
    <div class="plan-chart">${planProfile(weeks, monday)}</div>
    <p class="muted small">Une bosse = une semaine, sa hauteur = la charge prévue. Les creux, ce sont tes semaines allégées ; les drapeaux, tes objectifs. ${btn('Pourquoi ce plan ?', 'go', { cls: 'link-btn', data: { to: '#/comprendre' } })}</p>
  `, { cls: 'plan' });
}

export function todayView() {
  const sessions = todaySessions();
  return `${hero(sessions)}
  ${coachBanner()}
  <div class="grid two">
    ${todayCard(sessions)}
    ${weekCard()}
  </div>
  ${planCard()}`;
}
