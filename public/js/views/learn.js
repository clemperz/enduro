// Écran « Comprendre » : d'abord le pourquoi de TON plan (où il va, pourquoi
// cette semaine, ce qui a été ajusté et pourquoi), puis le petit manuel.

import { S, goals, refs } from '../store.js';
import { momo, icon, sportIcon } from '../art.js';
import { ARTICLES } from '../manual.js';
import { esc, btn, card } from './common.js';
import { journalEntry } from './today.js';
import { mondayOf, fmtShort } from '../../engine/dates.js';
import { goalNotes, planStages, planRules, explainWeek, stageSpan, AUTO_RULES } from '../../engine/explain.js';

function goalsBlock() {
  const notes = goalNotes(S.profile, S.plan, S.today, refs());
  if (!notes.length) {
    return `<p>Tu n’as pas d’objectif daté. Le plan enchaîne donc des cycles de 12 semaines — fondations, développement, spécifique — pour te rendre plus endurant, sans jour J à préparer.</p>
      <div class="actions minor">${btn('Ajouter un objectif', 'go', { cls: 'small', ico: 'flag', data: { to: '#/profil' } })}</div>`;
  }
  return `<div class="goal-notes">${notes.map((g) => `<article class="goal-note ${g.major ? 'major' : 'minor'}">
      <div class="goal-note-head">
        <span class="goal-chip-ico">${sportIcon(g.sport, 22)}</span>
        <div><small>${g.horizon} · ${g.role}${g.formatLabel ? ` · ${g.formatLabel}` : ''}</small><strong>${esc(g.name || (g.sport === 'bike' ? 'Épreuve à vélo' : 'Course à pied'))}</strong></div>
        <em>${g.left}</em>
      </div>
      <p class="muted small">${g.when}</p>
      <p>${esc(g.how)}</p>
    </article>`).join('')}</div>`;
}

function stagesBlock() {
  const stages = planStages(S.profile, S.plan, S.today);
  const rows = stages.map((s) => `<li class="stage ${s.current ? 'current' : ''}" style="--p:${s.color}">
      <span class="stage-dot"></span>
      <div>
        <div class="stage-head"><strong>${s.label}</strong><small>${stageSpan(s)}${s.light ? ` · dont ${s.light} allégée${s.light > 1 ? 's' : ''}` : ''}${s.current ? ' · tu es ici' : ''}</small></div>
        <p>${esc(s.why)}</p>
        ${s.races.map((r) => `<p class="stage-race">${icon('flag', 16)} <strong>${esc(r.name || 'Course')}</strong> · ${fmtShort(r.date)} · ${r.major ? 'objectif majeur' : 'étape'}</p>`).join('')}
      </div>
    </li>`).join('');
  return `<ol class="stages">${rows}</ol>`;
}

function weekBlock() {
  const monday = mondayOf(S.today);
  const week = S.plan?.weeks?.[monday];
  if (!week) return '<p class="muted">Pas de semaine en cours.</p>';
  const items = explainWeek(S.profile, S.plan, week, S.today);
  return `<dl class="why-list">${items.map((x) => `<div><dt>${esc(x.title)}</dt><dd>${esc(x.text)}</dd></div>`).join('')}</dl>
    <p class="muted small">Touche une séance sur l’écran « S’entraîner » pour savoir pourquoi elle est là, ce jour-là.</p>`;
}

function journalBlock() {
  const entries = (S.plan?.journal ?? []).slice().reverse();
  const rules = `<details class="fold"><summary>Ce que Momo ajuste tout seul</summary>
      <dl class="why-list">${AUTO_RULES.map((r) => `<div><dt>${r.title}</dt><dd>${r.text}</dd></div>`).join('')}</dl>
      <p class="muted small">Momo ne touche jamais aux séances que tu as ajoutées ou réglées toi-même, et tu peux rétablir chaque ajustement.</p>
    </details>`;
  if (!entries.length) {
    return `<p>Rien pour l’instant : ton plan n’a pas eu besoin d’être ajusté. Dès qu’il le sera — séance ajoutée, fatigue, séance manquée, objectif modifié — tu trouveras ici ce qui a changé et pourquoi.</p>${rules}`;
  }
  const shown = entries.slice(0, S.ui.journalAll ? entries.length : 6);
  const more = entries.length - shown.length;
  return `${shown.map((e) => journalEntry(e)).join('')}
    ${more > 0 ? `<div class="actions minor">${btn(`Voir les ${more} plus anciens`, 'journal-all', { cls: 'small ghost' })}</div>` : ''}
    ${rules}`;
}

function rulesBlock() {
  return `<details class="fold"><summary>Les règles que le plan applique toujours</summary>
      <dl class="why-list">${planRules(S.profile).map((r) => `<div><dt>${r.title}</dt><dd>${r.text}</dd></div>`).join('')}</dl>
    </details>`;
}

export function learnView() {
  const cards = ARTICLES.map((a, i) => `
    <button type="button" class="lesson" data-act="open-article" data-id="${a.id}" style="--c:${a.color}">
      <span class="lesson-num">${i + 1}</span>
      <span class="lesson-ico">${icon(a.icon, 34)}</span>
      <strong>${esc(a.title)}</strong>
      <small>${esc(a.tagline)}</small>
    </button>`).join('');
  const count = goals().length;
  return `<section class="hero">
    <div class="hero-momo">${momo('happy', 130)}</div>
    <div class="bubble">
      <h1>Mon plan expliqué</h1>
      <p>${count ? `Ton plan est construit à rebours depuis ${count > 1 ? `tes ${count} objectifs` : 'ton objectif'}.` : 'Ton plan enchaîne des cycles pour te rendre plus endurant.'} Voici où il va, pourquoi cette semaine ressemble à ça, et ce que j’ai changé en route.</p>
    </div>
  </section>
  <div class="grid two">
    ${card('Où je vais', `${goalsBlock()}${stagesBlock()}${rulesBlock()}`, { cls: 'explain' })}
    <div class="grid">
      ${card('Pourquoi cette semaine', weekBlock(), { cls: 'explain' })}
      ${card('Ce qui a changé, et pourquoi', journalBlock(), { cls: 'explain journal' })}
    </div>
  </div>
  <div class="page-title sub"><span>${icon('book', 30)}</span><h1>Le petit manuel</h1><p>${ARTICLES.length} fiches d’une minute pour comprendre ce que tu fais et pourquoi. Tout ce que le plan applique vient d’ici.</p></div>
  <div class="lessons">${cards}</div>
  <p class="muted small center">Enduro ne remplace ni un entraîneur ni un médecin : en cas de douleur ou de doute sur ta santé, consulte.</p>`;
}
