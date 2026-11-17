// Écran « Observer » : la forme du jour, le volume, la condition, les records.

import { S, fitness, refs } from '../store.js';
import { momo, icon } from '../art.js';
import { formGauge, weekBars, fitnessLines, pprChart, hrvChart } from '../charts.js';
import { hrvSeries, hrvBaseline, nightHrBaseline } from '../../engine/nights.js';
import { weeklyHistory } from '../../engine/load.js';
import { powerProfile, suggestRefs } from '../../engine/power.js';
import { addDays, fmtShort } from '../../engine/dates.js';
import { btn, card } from './common.js';
import { activityRow } from './today.js';

function formCard(f) {
  const trend = Math.round(f.ramp * 10) / 10;
  const arrow = trend > 0.4 ? `▲ +${trend.toFixed(1).replace('.', ',')}` : trend < -0.4 ? `▼ ${trend.toFixed(1).replace('.', ',')}` : '= stable';
  // Ce que les séances d'aujourd'hui ont changé depuis ce matin.
  const delta = (v) => {
    const d = Math.round(v * 10) / 10;
    return f.todayLoad > 0 && Math.abs(d) >= 0.1 ? ` <em class="delta">${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1).replace('.', ',')} aujourd’hui</em>` : '';
  };
  const today = f.todayLoad > 0
    ? `<p class="today-note">${icon('check', 18)} Aujourd’hui : <strong>${Math.round(f.todayLoad)} points</strong> déjà comptés.</p>`
    : '';
  return card('Ma forme du jour', `
    <div class="form-grid">
      <div class="gauge-box">
        ${formGauge(f.ratio)}
        <div class="gauge-when">${f.forecast ? 'Ta fraîcheur demain matin' : 'Ta fraîcheur aujourd’hui'}</div>
        <div class="gauge-label" style="--c:${f.zone.color}">${f.zone.label}</div>
        <p>${f.zone.hint}</p>
      </div>
      <div class="stats">
        <div class="stat"><span class="stat-num">${Math.round(f.ctl)}</span><div><strong>Condition${delta(f.ctl - f.morning.ctl)}</strong><small>ta « caisse », construite sur 6 semaines · ${arrow} sur 7 jours</small></div></div>
        <div class="stat"><span class="stat-num warm">${Math.round(f.atl)}</span><div><strong>Fatigue${delta(f.atl - f.morning.atl)}</strong><small>le poids de tes 7 derniers jours</small></div></div>
        <div class="stat"><span class="stat-num soft">${Math.round(f.weekLoad)}</span><div><strong>Points sur 7 jours</strong><small>1 h tranquille ≈ 50 points, 1 h au seuil = 100</small></div></div>
      </div>
    </div>
    ${today}
    <p class="muted small">Fraîcheur = condition − fatigue. Condition et fatigue bougent dès qu’une séance est enregistrée ; la jauge montre alors ce qu’il en restera demain matin, après une nuit. ${btn('Comprendre ces jauges', 'open-article', { cls: 'link-btn', data: { id: 'forme' } })}</p>
  `);
}

function volumeCard() {
  const history = weeklyHistory(S.activities, S.today, 8);
  const planned = Object.fromEntries(Object.values(S.plan?.weeks ?? {}).map((w) => [w.weekStart, w.targetMin]));
  return card('Mon volume, semaine par semaine', `
    ${weekBars(history, planned)}
    <div class="legend"><span><i style="background:#5DB7EA"></i>Vélo</span><span><i style="background:#F68D3F"></i>Course</span><span><i style="background:#B9C6D2"></i>Autre</span><span><i class="dash"></i>Prévu</span></div>
  `);
}

function linesCard(f) {
  const rows = f.rows.slice(-57);
  if (rows.length < 8) return '';
  rows[rows.length - 1] = { ...rows[rows.length - 1], ctl: f.ctl, atl: f.atl };
  return card('Condition et fatigue', `
    ${fitnessLines(rows)}
    <div class="legend"><span><i style="background:#1F6FA3"></i>Condition (lente)</span><span><i class="dots"></i>Fatigue (rapide)</span></div>
    <p class="muted small">Quand la fatigue passe au-dessus de la condition, tu « creuses ». Quand elle repasse dessous, tu surcompenses.</p>
  `);
}

function isHard(a) {
  const r = refs();
  if (a.rpe) return a.rpe >= 7;
  if (a.sport === 'bike' && a.np && r.ftp) return a.np / r.ftp >= 0.88;
  for (const w of Object.values(S.plan?.weeks ?? {})) {
    const s = w.sessions.find((x) => x.activityId === a.id);
    if (s) return s.hard >= 2;
  }
  return false;
}

function mixCard(f) {
  const since = addDays(S.today, -27);
  const recent = S.activities.filter((a) => a.date >= since && a.date <= S.today && a.durationSec >= 900);
  if (recent.length < 3) return '';
  const hard = recent.filter(isHard).length;
  const easy = recent.length - hard;
  const pctEasy = Math.round((easy / recent.length) * 100);
  let verdict = 'Belle répartition : beaucoup de facile, un peu de dur.';
  if (pctEasy < 65) verdict = 'Beaucoup de séances dures : garde des jours vraiment faciles pour encaisser.';
  else if (hard === 0) verdict = 'Que du facile ce mois-ci : parfait pour construire, un peu d’intensité viendra avec le plan.';
  const mono = f.monotony != null && f.monotony > 2 && f.weekLoad > 250
    ? '<p class="warn">Semaine très monotone (même charge tous les jours) : alterne vraies journées faciles et vraies séances.</p>' : '';
  return card('Facile ou dur ?', `
    <div class="mix"><span class="easy" style="flex:${Math.max(easy, 0.4)}">${easy} facile${easy > 1 ? 's' : ''}</span><span class="hard" style="flex:${Math.max(hard, 0.4)}">${hard} dure${hard > 1 ? 's' : ''}</span></div>
    <p>${verdict}</p>${mono}
    <p class="muted small">Sur 4 semaines. Le repère : environ 4 séances faciles pour 1 dure. ${btn('Pourquoi ?', 'open-article', { cls: 'link-btn', data: { id: 'polarise' } })}</p>
  `);
}

/** Les nuits de la montre : la VFC nuit par nuit, sa moyenne sur 7 jours et ta normale. */
function nightsCard() {
  if (!Object.values(S.nights ?? {}).some((n) => n.rmssd > 0)) return '';
  const rows = hrvSeries(S.nights, S.today, 56);
  const base = hrvBaseline(S.nights, S.today);
  const hrBase = nightHrBaseline(S.nights, S.today);
  const chart = hrvChart(rows, base);
  if (!chart) return '';
  const facts = [
    base ? `Ta normale : <strong>${base.low} à ${base.high} ms</strong> en moyenne sur 7 nuits.` : 'Encore quelques nuits et Enduro connaîtra ta normale.',
    hrBase ? `Pouls de nuit habituel : <strong>${Math.round(hrBase)}</strong>.` : '',
  ].filter(Boolean).join(' ');
  return card('Mes nuits', `
    ${chart}
    <div class="legend"><span><i style="background:#5DB7EA"></i>VFC d’une nuit</span><span><i style="background:#1F6FA3"></i>Moyenne sur 7 nuits</span>${base ? '<span><i style="background:#5CC98A;opacity:.5"></i>Ta normale</span>' : ''}</div>
    <p>${facts}</p>
    <p class="muted small">Mesurée par ta montre Withings pendant ton sommeil. Une nuit isolée ne veut rien dire : c’est le trait qui compte. ${btn('Comprendre la VFC', 'open-article', { cls: 'link-btn', data: { id: 'recup' } })}</p>
  `);
}

/** Les ECG de 30 s du matin (importés à la main) : leur propre courbe, jamais mêlée aux nuits. */
function ecgCard() {
  if (!Object.values(S.ecg ?? {}).some((m) => m.rmssd > 0)) return '';
  const rows = hrvSeries(S.ecg, S.today, 56);
  const base = hrvBaseline(S.ecg, S.today);
  const asNights = Object.fromEntries(Object.entries(S.ecg).map(([d, m]) => [d, { hrAvg: m.hr }]));
  const hrBase = nightHrBaseline(asNights, S.today);
  const count = Object.keys(S.ecg).length;
  const chart = hrvChart(rows, base);
  const facts = [
    base ? `Ta normale : <strong>${base.low} à ${base.high} ms</strong> en moyenne sur 7 matins.`
      : `${count} ECG du matin pour l’instant : il en faut 7 pour qu’Enduro connaisse ta normale.`,
    hrBase ? `Pouls habituel pendant l’ECG : <strong>${Math.round(hrBase)}</strong>.` : '',
  ].filter(Boolean).join(' ');
  return card('Ma VFC du matin', `
    ${chart || '<p class="muted">La courbe apparaîtra dès le 3<sup>e</sup> ECG.</p>'}
    ${chart ? `<div class="legend"><span><i style="background:#5DB7EA"></i>VFC d’un matin</span><span><i style="background:#1F6FA3"></i>Moyenne sur 7 jours</span>${base ? '<span><i style="background:#5CC98A;opacity:.5"></i>Ta normale</span>' : ''}</div>` : ''}
    <p>${facts}</p>
    <p class="muted small">Calculée sur l’ECG de 30 s de ta montre. Un matin isolé ne veut rien dire : c’est le trait qui compte. ${btn('Comment bien mesurer', 'open-article', { cls: 'link-btn', data: { id: 'recup' } })}</p>
  `);
}

function pprCard() {
  const ppr = powerProfile(S.activities);
  if (!Object.keys(ppr).length) return '';
  const r = refs();
  const sug = suggestRefs(ppr);
  const offers = [];
  if (sug.pma && sug.pma > (r.pma ?? 0)) {
    offers.push(btn(`Utiliser ${sug.pma} W comme PMA`, 'use-ref', { cls: 'small', data: { key: 'pma', value: sug.pma } }));
  }
  if (sug.ftp && sug.ftp > (r.ftp ?? 0)) {
    offers.push(btn(`Utiliser ${sug.ftp} W comme FTP`, 'use-ref', { cls: 'small', data: { key: 'ftp', value: sug.ftp } }));
  }
  return card('Mes records de puissance', `
    <div class="chart-narrow">${pprChart(ppr, r.weightKg)}</div>
    <p class="muted small">Ta meilleure puissance moyenne sur chaque durée, d’après tes sorties avec capteur (Zwift). C’est le « Profil de Puissance Record » de Pinot et Grappe.</p>
    ${offers.length ? `<div class="callout"><strong>Tes records dépassent tes repères actuels.</strong> Si ces efforts étaient à fond, tu peux les adopter :<div class="row">${offers.join('')}</div></div>` : ''}
  `);
}

function activitiesCard() {
  const list = [...S.activities].sort((a, b) => (a.start < b.start ? 1 : -1)).slice(0, 12);
  if (!list.length) return '';
  return card('Mes dernières sorties', `<div class="act-list">${list.map(activityRow).join('')}</div>
    <p class="muted small">Touche une sortie pour noter ton ressenti. Les sorties Zwift arrivent toutes seules ; pour le reste, voir ${btn('Profil → Connexions', 'go', { cls: 'link-btn', data: { to: '#/profil' } })}.</p>`);
}

export function observeView() {
  const f = fitness();
  if (!S.activities.length) {
    return `<section class="hero">
      <div class="hero-momo">${momo('happy', 150)}</div>
      <div class="bubble"><h1>Rien à observer… pour l’instant</h1>
        <p>Dès ta première séance validée, tu verras ici ta condition, ta fatigue et ta fraîcheur.</p>
        <p>En attendant, voilà ton point de départ, calculé d’après ton volume habituel.</p></div>
    </section>${formCard(f)}`;
  }
  return `<div class="page-title"><span>${icon('eye', 30)}</span><h1>Observer</h1><p>Ce que ton entraînement fait à ton corps, du ${fmtShort(f.rows[0].date)} à aujourd’hui.</p></div>
  ${formCard(f)}
  <div class="grid two">${volumeCard()}${linesCard(f) || mixCard(f)}</div>
  ${linesCard(f) ? mixCard(f) : ''}
  ${nightsCard()}
  ${ecgCard()}
  ${pprCard()}
  ${activitiesCard()}`;
}
