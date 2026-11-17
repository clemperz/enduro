// Fenêtres qui glissent par-dessus l'écran : détail d'une séance, « c'est
// fait », moins de temps, journée, activité, fiche du manuel…

import { S, refs, findSession, activityById, peekWeek, plannableDays } from '../store.js';
import { momo, icon } from '../art.js';
import { workoutChart } from '../charts.js';
import { ZONES, ZONE_BY_ID, stepTarget, zoneTable, zoneNick, zoneHold } from '../../engine/zones.js';
import { RPE_LABELS, RPE_POINTS_PER_HOUR, FORM_ZONES, LOAD_METHOD_LABELS } from '../../engine/load.js';
import { fmtDate, fmtDuration, mondayOf, addDays, dayIndex, DAYS } from '../../engine/dates.js';
import { minMinutes, LIBRARY } from '../../engine/workouts.js';
import { MANUAL_KINDS, manualSession, normalizeAvail } from '../../engine/plan.js';
import { ARTICLE_BY_ID } from '../manual.js';
import { esc, btn, sessionTitle, sessionMeta, sportBadge, fmtSec } from './common.js';
import { sessionCard, activityRow, journalEntry } from './today.js';
import { explainWeek, explainSession } from '../../engine/explain.js';
import { PHASES } from '../../engine/plan.js';

function stepRow(sport, step, r, indent = false) {
  const z = ZONE_BY_ID[step.zone] ?? ZONES[0];
  const t = step.effortOnly ? { main: null, hr: null } : stepTarget(sport, step, r);
  const feel = step.kind === 'free' ? 'tout ce que tu as, en restant régulier' : z.talk.toLowerCase();
  const target = [t.main, t.hr].filter(Boolean).join(' · ');
  const cadence = step.cadence ? ` · ${step.cadence - 5}–${step.cadence + 5} tr/min` : '';
  return `<li class="step ${indent ? 'indent' : ''}">
    <span class="step-zone" style="--z:${z.color}">I${z.num}</span>
    <span class="step-dur">${fmtSec(step.sec)}</span>
    <span class="step-body"><strong>${esc(step.label ?? zoneNick(z, sport))}</strong>
      <small>${target ? `${esc(target)}${cadence} · ` : cadence ? `${cadence.slice(3)} · ` : ''}${esc(feel)}</small></span>
  </li>`;
}

function stepsList(s) {
  const r = refs();
  const rows = (s.steps ?? []).map((step) => {
    if (step.kind !== 'intervals') return stepRow(s.sport, step, r);
    return `<li class="step-group"><div class="step-reps">${step.reps} ×</div><ul>
      ${stepRow(s.sport, step.on, r, true)}${step.off?.sec ? stepRow(s.sport, { label: 'Récupération', ...step.off }, r, true) : ''}
    </ul></li>`;
  }).join('');
  const key = s.sport === 'bike' ? 'pma' : 'vma';
  const name = s.sport === 'bike' ? 'PMA' : 'VMA';
  const value = r[key] ? (s.sport === 'bike' ? `${r[key]} W` : `${String(r[key]).replace('.', ',')} km/h`) : null;
  let hint = '';
  if (!value) {
    hint = `<p class="hint">${icon('info', 18)} <span>Pas encore assez de données pour estimer ta ${name}. Renseigne-la dans ${btn('Profil', 'go', { cls: 'link-btn', data: { to: '#/profil' } })} pour voir tes ${s.sport === 'bike' ? 'watts' : 'allures'} ; en attendant, fie-toi aux sensations.</span></p>`;
  } else if (r.est[key]) {
    hint = `<p class="hint">${icon('info', 18)} <span>Cibles calculées avec ta ${name} <strong>estimée</strong> à ${value}${r.why[key]?.quality === 'record' ? ' (un minimum)' : ''}. ${btn('D’où vient ce chiffre ?', 'go', { cls: 'link-btn', data: { to: '#/profil' } })}</span></p>`;
  }
  return `<ul class="steps">${rows}</ul>${hint}`;
}

/** Séance ajustée par le coach : la raison, telle qu'elle est écrite dans le journal. */
function autoBlock(s) {
  if (!s.auto) return '';
  const entry = (S.plan?.journal ?? []).find((e) => e.key === s.auto.key);
  return entry ? `<div class="auto-block">${journalEntry(entry)}</div>` : '';
}

/** « Pourquoi cette semaine ? » : le volume, l'intensité, les jours, les ajustements. */
function whySheet({ monday }) {
  const week = S.plan?.weeks?.[monday];
  if (!week) return null;
  const phase = PHASES[week.info?.phase] ?? null;
  const items = explainWeek(S.profile, S.plan, week, S.today);
  const changes = (S.plan.journal ?? []).filter((e) => e.weekStart === monday && e.rule !== 'profil').slice().reverse();
  return {
    title: `<span class="art-ico" style="--c:${phase?.color ?? '#F7C948'}">${icon('info', 24)}</span><span>Pourquoi cette semaine ?</span>`,
    body: `<p class="lead">Semaine du ${fmtDate(monday, { day: 'numeric', month: 'long' })} au ${fmtDate(addDays(monday, 6), { day: 'numeric', month: 'long' })}</p>
      <dl class="why-list">${items.map((x) => `<div><dt>${esc(x.title)}</dt><dd>${esc(x.text)}</dd></div>`).join('')}</dl>
      ${changes.length ? `<h3>Ce que Momo a changé cette semaine</h3>${changes.map((e) => journalEntry(e)).join('')}` : ''}
      <p class="muted small">Touche une séance pour savoir pourquoi elle est là, ce jour-là. ${btn('Tout le plan expliqué', 'go', { cls: 'link-btn', data: { to: '#/comprendre' } })}</p>`,
    foot: '',
  };
}

function sessionSheet({ id }) {
  const found = findSession(id);
  if (!found) return null;
  const s = found.session;
  const zone = ZONE_BY_ID[s.zone];
  const canAct = s.status === 'planned';
  return {
    title: `${sportBadge(s.sport, 26)}<span>${sessionTitle(s)}</span>`,
    body: `
      <div class="eyebrow">${fmtDate(s.date)}</div>
      ${sessionMeta(s)}
      ${workoutChart(s, { height: 120 })}
      <div class="callout"><strong>Pourquoi cette séance ?</strong> ${esc(s.why ?? '')}</div>
      <p class="why-day">${icon('info', 18)} <span><strong>Pourquoi ce jour-là ?</strong> ${esc(explainSession(S.profile, found.week, s))}</span></p>
      ${autoBlock(s)}
      <h3>Le déroulé</h3>
      ${stepsList(s)}
      ${zone ? `<div class="callout zone" style="--z:${zone.color}"><strong>La zone clé : I${zone.num} · ${zone.name}.</strong> ${zone.legs}. ${zone.talk}. Tenable : ${zoneHold(zone, s.sport).toLowerCase()}. ${btn('Les 7 intensités', 'open-article', { cls: 'link-btn', data: { id: 'zones' } })}</div>` : ''}
      ${s.tips?.length ? `<h3>Les conseils de Momo</h3><ul class="tips">${s.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    `,
    foot: canAct ? [
      btn('C’est fait', 'done', { cls: 'primary', ico: 'check', data: { id: s.id } }),
      s.sport === 'bike' && s.date >= S.today ? btn(s.zwift ? (S.server?.mode === 'local' ? 'Envoyée vers Zwift ✓' : 'Dans Zwift ✓') : 'Envoyer vers Zwift', 'zwift', { cls: s.zwift ? 'sent' : 'zwift', ico: 'screen', data: { id: s.id } }) : '',
      s.date >= S.today && plannableDays().includes(s.date) && s.role !== 'race'
        ? btn('Changer de séance', 'plan-add', { cls: 'ghost', ico: 'swap', data: { date: s.date, replace: s.id, sport: s.sport, kind: s.kind } }) : '',
    ].join('') : '',
  };
}

function rpePicker(value) {
  const colors = ['#B9C6D2', '#B9C6D2', '#5DB7EA', '#5DB7EA', '#5CC98A', '#5CC98A', '#F7C948', '#F68D3F', '#E8504F', '#9C6BE0'];
  const buttons = Array.from({ length: 10 }, (_, i) => {
    const v = i + 1;
    return `<button type="button" class="rpe ${value === v ? 'on' : ''}" style="--c:${colors[i]}" data-act="rpe" data-v="${v}" aria-pressed="${value === v}">${v}</button>`;
  }).join('');
  return `<div class="rpe-row">${buttons}</div>
    <p class="rpe-label">${value ? `<strong>${value}/10</strong> — ${RPE_LABELS[value]}` : 'Touche une note : 1 = promenade, 10 = à fond de fond.'}</p>`;
}

/** Séance « test » validée à la main : on demande les résultats pour recalibrer les repères. */
function testFields(s, sheet) {
  if (s.kind !== 'test') return '';
  const field = (key, label, unit, placeholder) => `<label><span class="field-label">${label}</span>
    <span class="num-input"><input class="input" type="number" inputmode="decimal" min="0" data-sheet-field="${key}" value="${esc(sheet[key] ?? '')}" placeholder="${placeholder}"><em>${unit}</em></span></label>`;
  const inputs = s.sport === 'bike'
    ? field('p5', 'Puissance moyenne des 5 min', 'W', 'ex. 290') + field('p20', 'Puissance moyenne des 20 min', 'W', 'ex. 240')
    : field('d6', 'Distance parcourue en 6 min', 'm', 'ex. 1500');
  const how = s.sport === 'bike'
    ? 'Tes 5 min donnent ta PMA, 95 % de tes 20 min donnent ta FTP. Sur Zwift, inutile de remplir : tes records sont lus tout seuls.'
    : 'Cette distance divisée par 100 donne ta VMA en km/h.';
  return `<div class="callout test-fields"><strong>Tes résultats</strong> <span class="muted small">(facultatif)</span>
    <div class="field-grid">${inputs}</div><p class="muted small">${how}</p></div>`;
}

function doneSheet(sheet) {
  const found = findSession(sheet.id);
  if (!found) return null;
  const s = found.session;
  return {
    title: `<span>Bravo ! Comment c’était ?</span>`,
    body: `
      <div class="done-hero">${momo('proud', 96)}<p><strong>${esc(s.title)}${s.detail ? ` ${esc(s.detail)}` : ''}</strong><br>${fmtDate(s.date)}</p></div>
      <label class="field-label">Durée réelle</label>
      <div class="stepper big">
        <button type="button" class="round" data-act="sheet-min" data-d="-5" aria-label="Moins">${icon('minus', 20)}</button>
        <output>${fmtDuration(sheet.minutes)}</output>
        <button type="button" class="round" data-act="sheet-min" data-d="5" aria-label="Plus">${icon('plus', 20)}</button>
      </div>
      <label class="field-label">Ton ressenti global</label>
      ${rpePicker(sheet.rpe)}
      ${testFields(s, sheet)}
      <label class="field-label" for="done-note">Un mot ? (facultatif)</label>
      <input id="done-note" class="input" type="text" maxlength="200" data-sheet-field="note" value="${esc(sheet.note ?? '')}" placeholder="Jambes lourdes, super sensations…">
      <p class="muted small">Sans capteur, c’est ce ressenti × la durée qui donne la charge de la séance. ${btn('En savoir plus', 'open-article', { cls: 'link-btn', data: { id: 'charge' } })}</p>
    `,
    foot: btn('Enregistrer', 'save-done', { cls: 'primary', ico: 'check', disabled: !sheet.rpe }),
  };
}

function timeSheet({ id }) {
  const found = findSession(id);
  if (!found) return null;
  const s = found.session;
  const options = [20, 30, 40, 45, 50, 60, 75, 90, 120].filter((m) => m < s.durationMin);
  const min = minMinutes(s.sport, s.kind);
  return {
    title: '<span>Combien de temps as-tu ?</span>',
    body: `
      <p>Prévu : <strong>${esc(s.title)}${s.detail ? ` ${esc(s.detail)}` : ''}</strong>, ${fmtDuration(s.durationMin)}. Choisis ton temps réel, Momo adapte la séance.</p>
      <div class="chips big">${options.map((m) => `<button type="button" class="chip" data-act="resize" data-id="${esc(id)}" data-min="${m}">${fmtDuration(m)}${s.role === 'key' && m < min ? '<small>version facile</small>' : ''}</button>`).join('')}</div>
      <p class="muted small">Mieux vaut une séance courte qu’une séance sautée. En dessous de ${min} min, la séance clé devient une sortie d’endurance.</p>
    `,
    foot: '',
  };
}

function daySheet({ date }) {
  const monday = mondayOf(date);
  const week = S.plan?.weeks?.[monday];
  const sessions = (week?.sessions ?? []).filter((s) => s.date === date);
  const linked = new Set(sessions.map((s) => s.activityId).filter(Boolean));
  const free = S.activities.filter((a) => a.date === date && !linked.has(a.id));
  const body = sessions.length
    ? sessions.map((s) => sessionCard(s, { compact: true })).join('')
    : `<div class="rest"><div class="rest-art">${icon('rest', 44)}</div><div><h3>Repos</h3><p>Rien de prévu ce jour-là.</p></div></div>`;
  return {
    title: `<span>${fmtDate(date)}</span>`,
    body: `${body}${free.length ? `<div class="free"><div class="eyebrow">Activités</div>${free.map(activityRow).join('')}</div>` : ''}`,
    foot: [
      plannableDays().includes(date) ? btn('Ajouter une séance', 'plan-add', { cls: 'primary', ico: 'plus', data: { date } }) : '',
      date <= S.today ? btn('Noter une activité faite', 'add-activity', { cls: 'ghost', ico: 'check', data: { date } }) : '',
    ].join(''),
  };
}

function activitySheet(sheet) {
  const a = activityById(sheet.id);
  if (!a) return null;
  const rows = [
    ['Durée', fmtDuration(a.durationSec / 60)],
    a.distanceKm ? ['Distance', `${a.distanceKm.toFixed(1).replace('.', ',')} km`] : null,
    a.elevationM ? ['Dénivelé', `${Math.round(a.elevationM)} m`] : null,
    a.avgPower ? ['Puissance moyenne', `${a.avgPower} W`] : null,
    a.np ? ['Puissance normalisée', `${a.np} W`] : null,
    a.avgHr ? ['FC moyenne', `${a.avgHr} bpm`] : null,
    ['Charge', `${a.load ?? 0} pts (${LOAD_METHOD_LABELS[a.loadMethod] ?? 'estimation'})`],
  ].filter(Boolean);
  return {
    title: `${sportBadge(a.sport, 26)}<span>${esc(a.name || 'Activité')}</span>`,
    body: `
      <div class="eyebrow">${fmtDate(a.date)}</div>
      <dl class="facts">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      <label class="field-label">Ton ressenti global</label>
      ${rpePicker(sheet.rpe)}
      <label class="field-label" for="act-note">Note</label>
      <input id="act-note" class="input" type="text" maxlength="200" data-sheet-field="note" value="${esc(sheet.note ?? '')}" placeholder="Facultatif">
    `,
    foot: `${btn('Enregistrer', 'save-activity', { cls: 'primary', ico: 'check' })}${btn('Supprimer', 'delete-activity', { cls: 'ghost danger', ico: 'trash', data: { id: a.id } })}`,
  };
}

function addSheet(sheet) {
  const sports = [['bike', 'Vélo'], ['run', 'Course'], ['other', 'Autre']];
  return {
    title: '<span>Ajouter une activité</span>',
    body: `
      <div class="eyebrow">${fmtDate(sheet.date)}</div>
      <label class="field-label">Sport</label>
      <div class="chips">${sports.map(([k, l]) => `<button type="button" class="chip ${sheet.sport === k ? 'on' : ''}" data-act="sheet-sport" data-v="${k}">${l}</button>`).join('')}</div>
      <label class="field-label">Durée</label>
      <div class="stepper big">
        <button type="button" class="round" data-act="sheet-min" data-d="-5" aria-label="Moins">${icon('minus', 20)}</button>
        <output>${fmtDuration(sheet.minutes)}</output>
        <button type="button" class="round" data-act="sheet-min" data-d="5" aria-label="Plus">${icon('plus', 20)}</button>
      </div>
      <label class="field-label">Ton ressenti global</label>
      ${rpePicker(sheet.rpe)}
      <label class="field-label" for="add-name">Nom (facultatif)</label>
      <input id="add-name" class="input" type="text" maxlength="80" data-sheet-field="name" value="${esc(sheet.name ?? '')}" placeholder="Sortie avec les copains, rando…">
    `,
    foot: btn('Ajouter', 'save-add', { cls: 'primary', ico: 'check', disabled: !sheet.rpe }),
  };
}

function zonesTableHtml(sport) {
  const r = refs();
  const rows = zoneTable(sport, r).map(({ zone: z, main, hr }) => `<tr>
    <td><span class="step-zone" style="--z:${z.color}">I${z.num}</span></td>
    <td><strong>${z.name}</strong><small>${zoneNick(z, sport)} · ${zoneHold(z, sport).toLowerCase()}</small></td>
    <td class="num">${main ?? `${Math.round(z[sport === 'run' ? 'vma' : 'pma'][0] * 100)}–${Math.round(z[sport === 'run' ? 'vma' : 'pma'][1] * 100)} %`}${hr ? `<small>${hr}</small>` : ''}</td>
    <td class="feel-col">${z.legs}. ${z.talk}.</td>
  </tr>`).join('');
  const key = sport === 'bike' ? 'pma' : 'vma';
  const known = r[key];
  const from = (k) => (r.est[k] ? ` (estimée d’après ${esc(r.why[k]?.basis ?? 'tes données')})` : '');
  const note = known
    ? `<p class="muted small">Calculé avec ${sport === 'bike' ? `ta PMA de ${r.pma} W` : `ta VMA de ${String(r.vma).replace('.', ',')} km/h`}${from(key)}${r.fcmax ? ` et ta FC max de ${r.fcmax} bpm${from('fcmax')}` : ''}.</p>`
    : `<p class="muted small">En % de ${sport === 'bike' ? 'PMA' : 'VMA'} pour l’instant : renseigne tes repères dans Profil pour les voir en ${sport === 'bike' ? 'watts' : 'min/km'}.</p>`;
  return `<div class="table-wrap"><table class="zones"><tbody>${rows}</tbody></table></div>${note}`;
}

const SPECIALS = {
  'zones-bike': () => zonesTableHtml('bike'),
  'zones-run': () => zonesTableHtml('run'),
  'rpe-table': () => `<div class="rpe-table">${RPE_POINTS_PER_HOUR.slice(1).map((p, i) => `<div><strong>${i + 1}</strong><span>${RPE_LABELS[i + 1]}</span><em>${p} pts/h</em></div>`).join('')}</div>`,
  'form-legend': () => `<ul class="legend-list">${FORM_ZONES.map((z) => `<li><span class="dot" style="background:${z.color}"></span><strong>${z.label}</strong> — ${z.hint}</li>`).join('')}</ul>`,
};

function articleSheet({ id }) {
  const a = ARTICLE_BY_ID[id];
  if (!a) return null;
  const blocks = a.blocks.map((b) => {
    if (b.p) return `<p>${esc(b.p)}</p>`;
    if (b.h) return `<h3>${esc(b.h)}</h3>`;
    if (b.li) return `<ul class="tips">${b.li.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    if (b.tip) return `<div class="momo-tip">${momo(a.mood ?? 'happy', 64)}<p>${esc(b.tip)}</p></div>`;
    if (b.special) return SPECIALS[b.special]?.() ?? '';
    return '';
  }).join('');
  return {
    title: `<span class="art-ico" style="--c:${a.color}">${icon(a.icon, 24)}</span><span>${esc(a.title)}</span>`,
    body: `<p class="lead">${esc(a.tagline)}</p>${blocks}
      <div class="sources"><strong>Sources et inspirations</strong><ul>${a.sources.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>`,
    foot: '',
  };
}

function zwiftSheet({ files, ftp, ftpEstimated, shared }) {
  const several = files.length > 1;
  const intro = shared
    ? `<div class="momo-tip">${momo('pumped', 72)}<p>${several ? `${files.length} séances envoyées` : 'Séance envoyée'}. Si tu les as passées à ton Mac par AirDrop, ${several ? 'elles sont' : 'elle est'} déjà rangée${several ? 's' : ''} dans Zwift.</p></div>
      <p class="muted small">Le rangement est automatique sur le Mac où tourne Zwift (réception AirDrop installée une fois pour toutes). Une notification « Enduro → Zwift » le confirme.</p>`
    : `<div class="momo-tip">${momo('pumped', 72)}<p>${several ? `${files.length} séances déposées` : 'Séance déposée'} dans ton dossier Zwift.</p></div>`;
  return {
    title: `<span class="art-ico" style="--c:#F68D3F">${icon('screen', 24)}</span><span>${shared ? 'En route pour Zwift !' : 'C’est dans Zwift !'}</span>`,
    body: `
      ${intro}
      <ol class="howto">
        <li><strong>Relance Zwift</strong> s’il était ouvert (il lit les nouvelles séances au démarrage).</li>
        <li>Ouvre <strong>Entraînements</strong>, puis la catégorie <strong>Entraînements personnalisés</strong>.</li>
        <li>Choisis la séance dont le nom commence par <strong>Enduro</strong>, suivie du jour (Lun, Mar…).</li>
      </ol>
      <div class="callout">${ftp && !ftpEstimated
    ? `Zwift calcule tes watts avec <strong>sa propre FTP</strong>. Vérifie qu’elle vaut bien <strong>${ftp} W</strong> dans Zwift (menu → Mon profil), sinon les cibles seront décalées.`
    : `Zwift calcule tes watts avec <strong>la FTP réglée dans Zwift</strong>${ftp ? ` (Enduro, lui, l’estime à ${ftp} W d’après ta PMA)` : ''}. Regarde-la dans Zwift (menu → Mon profil) et reporte-la dans Profil → Mes repères : les cibles seront alors identiques des deux côtés.`}</div>
      <p class="muted small">Il n’y a jamais plus de 7 séances Enduro dans Zwift : une par jour de la semaine, remplacée la semaine suivante.</p>
    `,
    foot: btn('Compris', 'close-sheet', { cls: 'primary' }),
  };
}

/** Séances prévues (pas encore faites) d'un jour donné. */
export function plannedOn(date) {
  const week = peekWeek(date);
  return { week, sessions: (week?.sessions ?? []).filter((s) => s.date === date && s.status === 'planned') };
}

function planAddSheet(sheet) {
  const days = plannableDays();
  const nextMonday = addDays(mondayOf(S.today), 7);
  const { week, sessions: sameDay } = plannedOn(sheet.date);
  const replaced = sameDay.find((s) => s.id === sheet.replaceId) ?? null;
  const preview = manualSession(S.profile, week, sheet, sameDay.filter((s) => s !== replaced));

  const dayChip = (d) => {
    const busy = (peekWeek(d)?.sessions ?? []).some((s) => s.date === d && s.status !== 'skipped');
    const label = d === S.today ? 'Auj.' : `${DAYS[dayIndex(d)].name.slice(0, 3)}. ${Number(d.slice(8))}`;
    return `<button type="button" class="chip day-chip ${sheet.date === d ? 'on' : ''} ${busy ? 'busy' : ''}" data-act="pa-day" data-v="${d}" aria-pressed="${sheet.date === d}">${label}</button>`;
  };
  const thisWeek = days.filter((d) => d < nextMonday);
  const nextWeek = days.filter((d) => d >= nextMonday);

  const kinds = MANUAL_KINDS[sheet.sport].map((k) => {
    const meta = LIBRARY[sheet.sport][k];
    const z = ZONE_BY_ID[meta.zone];
    return `<button type="button" class="kind ${sheet.kind === k ? 'on' : ''}" style="--z:${z.color}" data-act="pa-kind" data-v="${k}" aria-pressed="${sheet.kind === k}">
      <strong>${esc(meta.title)}</strong><small>I${z.num}${meta.hard >= 2 ? ' · dure' : meta.hard === 1 ? ' · moyenne' : ' · facile'}</small></button>`;
  }).join('');

  const modes = sameDay.length ? `<label class="field-label">Ce jour-là, il y a déjà ${sameDay.length > 1 ? 'des séances' : 'une séance'}</label>
    <div class="chips">${sameDay.map((s) => `<button type="button" class="chip ${sheet.replaceId === s.id ? 'on' : ''}" data-act="pa-mode" data-v="${esc(s.id)}">À la place de « ${esc(s.title)} »</button>`).join('')}
      <button type="button" class="chip ${!replaced ? 'on' : ''}" data-act="pa-mode" data-v="">En plus</button></div>` : '';

  const notes = [];
  if (preview.fallback) {
    notes.push(`Trop court pour cette séance : ce sera une sortie d’endurance. Il faut au moins ${minMinutes(sheet.sport, sheet.kind)} min.`);
  } else if (Math.abs(preview.durationMin - sheet.minutes) >= 3) {
    notes.push(`La séance complète dure ${fmtDuration(preview.durationMin)} (échauffement et retour au calme compris).`);
  }
  if (preview.hard >= 2) {
    for (const [delta, word] of [[-1, 'la veille'], [1, 'le lendemain']]) {
      const d = addDays(sheet.date, delta);
      const hard = (peekWeek(d)?.sessions ?? []).find((s) => s.date === d && s.id !== sheet.replaceId && s.status !== 'skipped' && s.hard >= 2);
      if (hard) notes.push(`Il y a déjà une séance dure ${word} (${esc(hard.title)}) : deux jours durs de suite, c’est la récupération qui trinque.`);
    }
  }
  if (normalizeAvail(S.profile?.avail)[dayIndex(sheet.date)] === 0) notes.push('C’est un jour de repos dans ton profil : pas de souci, c’est toi qui décides.');

  return {
    title: '<span>Ajouter une séance</span>',
    body: `
      <label class="field-label">Quel jour ?</label>
      <div class="day-chips"><span class="eyebrow-mini">Cette semaine</span><div class="chips">${thisWeek.map(dayChip).join('')}</div>
        <span class="eyebrow-mini">Semaine prochaine</span><div class="chips">${nextWeek.map(dayChip).join('')}</div></div>
      ${modes}
      <label class="field-label">Sport</label>
      <div class="chips">${[['bike', 'Vélo'], ['run', 'Course à pied']].map(([k, l]) => `<button type="button" class="chip ${sheet.sport === k ? 'on' : ''}" data-act="pa-sport" data-v="${k}">${l}</button>`).join('')}</div>
      <label class="field-label">Quelle séance ?</label>
      <div class="kinds">${kinds}</div>
      <label class="field-label">Temps disponible</label>
      <div class="stepper big">
        <button type="button" class="round" data-act="pa-min" data-d="-5" aria-label="Moins">${icon('minus', 20)}</button>
        <output>${fmtDuration(sheet.minutes)}</output>
        <button type="button" class="round" data-act="pa-min" data-d="5" aria-label="Plus">${icon('plus', 20)}</button>
      </div>
      <div class="pa-preview">
        <div class="eyebrow">Aperçu · ${fmtDate(sheet.date)}</div>
        <h3>${sessionTitle(preview)}</h3>
        ${sessionMeta(preview)}
        ${workoutChart(preview, { height: 80 })}
        <p class="why">${esc(preview.why)}</p>
        ${notes.map((n) => `<p class="hint">${icon('info', 18)} <span>${n}</span></p>`).join('')}
      </div>
    `,
    foot: btn(replaced ? `Remplacer « ${esc(replaced.title)} »` : 'Ajouter au plan', 'pa-save', { cls: 'primary', ico: replaced ? 'swap' : 'plus' }),
  };
}

const SHEETS = {
  'plan-add': planAddSheet,
  session: sessionSheet,
  done: doneSheet,
  time: timeSheet,
  day: daySheet,
  activity: activitySheet,
  add: addSheet,
  article: articleSheet,
  zwift: zwiftSheet,
  why: whySheet,
};

export function sheetHtml() {
  const sheet = S.ui.sheet;
  if (!sheet) return '';
  const content = SHEETS[sheet.type]?.(sheet);
  if (!content) return '';
  return `<div class="sheet-back" data-act="close-sheet"></div>
  <div class="sheet" role="dialog" aria-modal="true">
    <header class="sheet-head"><h2>${content.title}</h2><button type="button" class="round" data-act="close-sheet" aria-label="Fermer">${icon('close', 20)}</button></header>
    <div class="sheet-body">${content.body}</div>
    ${content.foot ? `<footer class="sheet-foot">${content.foot}</footer>` : ''}
  </div>`;
}
