// Dates locales au format 'AAAA-MM-JJ'. On travaille à midi pour éviter les
// surprises des changements d'heure.

const pad = (n) => String(n).padStart(2, '0');

export const DAYS = [
  { key: 'lun', name: 'Lundi', short: 'L' },
  { key: 'mar', name: 'Mardi', short: 'M' },
  { key: 'mer', name: 'Mercredi', short: 'M' },
  { key: 'jeu', name: 'Jeudi', short: 'J' },
  { key: 'ven', name: 'Vendredi', short: 'V' },
  { key: 'sam', name: 'Samedi', short: 'S' },
  { key: 'dim', name: 'Dimanche', short: 'D' },
];

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

export function todayISO(now = new Date()) {
  return toISO(now);
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Nombre de jours de `from` à `to` (positif si `to` est après). */
export function diffDays(from, to) {
  return Math.round((parseISO(to) - parseISO(from)) / 86400000);
}

/** 0 = lundi … 6 = dimanche. */
export function dayIndex(iso) {
  return (parseISO(iso).getDay() + 6) % 7;
}

export function mondayOf(iso) {
  return addDays(iso, -dayIndex(iso));
}

export function weekDates(monday) {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function fmtDate(iso, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('fr-FR', opts).format(parseISO(iso));
}

export function fmtShort(iso) {
  return fmtDate(iso, { day: 'numeric', month: 'short' });
}

/** 95 → '1 h 35', 45 → '45 min'. */
export function fmtDuration(minutes) {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${pad(r)}` : `${h} h`;
}

/** Instant Unix (secondes) → heure locale 'AAAA-MM-JJTHH:MM:SS'. */
export function localStamp(epochSec) {
  const d = new Date(epochSec * 1000);
  return `${toISO(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
