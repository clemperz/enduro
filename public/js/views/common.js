// Petits éléments d'interface partagés par tous les écrans.

import { icon, sportIcon } from '../art.js';
import { ZONE_BY_ID, zoneNick } from '../../engine/zones.js';
import { fmtDuration } from '../../engine/dates.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function attrs(data = {}) {
  return Object.entries(data).filter(([, v]) => v != null && v !== false).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
}

/** Bouton d'action : `act` est le nom de l'action déclenchée au clic. */
export function btn(label, act, { cls = '', data = {}, ico = null, title = null, disabled = false } = {}) {
  return `<button type="button" class="btn ${cls}" data-act="${act}"${attrs(data)}${title ? ` title="${esc(title)}"` : ''}${disabled ? ' disabled' : ''}>${ico ? icon(ico, 20) : ''}<span>${label}</span></button>`;
}

export function zoneChip(zoneId, sport = 'bike') {
  const z = ZONE_BY_ID[zoneId];
  if (!z) return '';
  return `<span class="zchip" style="--z:${z.color}">I${z.num} · ${zoneNick(z, sport)}</span>`;
}

export function sessionTitle(s) {
  return `${esc(s.title)}${s.detail ? ` <small>${esc(s.detail)}</small>` : ''}`;
}

export function sessionMeta(s) {
  const parts = [];
  if (s.durationMin) parts.push(`<span class="meta-item">${icon('clock', 17)}${fmtDuration(s.durationMin)}</span>`);
  if (s.load) parts.push(`<span class="meta-item" title="Charge prévue">${icon('flame', 17)}${s.load} pts</span>`);
  if (s.role !== 'race') parts.push(zoneChip(s.zone, s.sport));
  if (s.indoor) parts.push(`<span class="meta-item tag">${icon('screen', 16)}Home trainer</span>`);
  return `<div class="meta">${parts.join('')}</div>`;
}

export function sportBadge(sport, size = 30) {
  return `<span class="sport-badge ${sport}">${sportIcon(sport, size)}</span>`;
}

/** 90 → '1 min 30', 30 → '30 s', 600 → '10 min'. */
export function fmtSec(sec) {
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r ? `${m} min ${String(r).padStart(2, '0')}` : `${m} min`;
}

export function card(title, body, { cls = '', aside = '' } = {}) {
  return `<section class="card ${cls}">${title ? `<header class="card-head"><h2>${title}</h2>${aside}</header>` : ''}${body}</section>`;
}
