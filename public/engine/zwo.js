// Export d'une séance vélo au format .zwo (entraînement personnalisé Zwift).
// Dans un .zwo, les puissances sont des fractions de la FTP réglée dans Zwift.

import { FTP_PER_PMA } from './zones.js';
import { dayIndex } from './dates.js';

/** Zwift est plus sûr avec de l'ASCII pur : on retire accents et symboles. */
export function ascii(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[’‘]/g, "'")
    .replace(/«\s*|\s*»|[“”]/g, '"')
    .replace(/→/g, '->')
    .replace(/×/g, 'x')
    .replace(/œ/g, 'oe')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const esc = (text) => ascii(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function slug(text) {
  return ascii(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const DAY_FILES = ['1-lun', '2-mar', '3-mer', '4-jeu', '5-ven', '6-sam', '7-dim'];
const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

/**
 * Un fichier par jour de la semaine, réécrit d'une semaine sur l'autre :
 * Zwift ne contient jamais plus de 7 séances Enduro, et rien n'est à supprimer.
 */
export function zwoFileName(session) {
  // Deuxième (ou troisième) séance vélo du même jour, ajoutée à la main : fichier à part.
  const slot = [2, 3].includes(session.zwoSlot) ? `-${session.zwoSlot}` : '';
  return `enduro-${DAY_FILES[dayIndex(session.date)]}${slot}.zwo`;
}

/**
 * @param {object} session  séance vélo (avec ses étapes)
 * @param {object} [refs]   repères : si PMA et FTP sont connues, on utilise le vrai rapport
 */
export function sessionToZwo(session, refs = {}) {
  if (session.sport !== 'bike') throw new Error('Seules les séances vélo s’exportent vers Zwift');
  const ratio = refs.pma && refs.ftp ? refs.ftp / refs.pma : FTP_PER_PMA;
  const p = (pct) => Math.min(2, pct / ratio).toFixed(3);
  const msg = (label, offset = 0) => (label ? `\n            <textevent timeoffset="${offset}" message="${esc(label)}"/>\n        ` : '');
  const blocks = [];

  for (const s of session.steps) {
    if (s.kind === 'warmup') {
      blocks.push(`<Warmup Duration="${s.sec}" PowerLow="${p(s.pct)}" PowerHigh="${p(s.pctEnd ?? s.pct)}">${msg(s.label)}</Warmup>`);
    } else if (s.kind === 'cooldown') {
      // Particularité du format : pour un retour au calme, PowerLow est la puissance de départ.
      blocks.push(`<Cooldown Duration="${s.sec}" PowerLow="${p(s.pct)}" PowerHigh="${p(s.pctEnd ?? s.pct)}">${msg(s.label)}</Cooldown>`);
    } else if (s.kind === 'free') {
      blocks.push(`<FreeRide Duration="${s.sec}" FlatRoad="1">${msg(s.label)}</FreeRide>`);
    } else if (s.kind === 'intervals') {
      const note = s.on.cadence ? `${s.label ?? ''} - cadence ${s.on.cadence - 5}-${s.on.cadence + 5} tr/min` : s.label;
      // Sans récupération après la dernière répétition : n-1 répétitions complètes + un dernier bloc seul.
      const full = s.skipLastOff ? s.reps - 1 : s.reps;
      if (full > 0) {
        blocks.push(
          `<IntervalsT Repeat="${full}" OnDuration="${s.on.sec}" OffDuration="${s.off.sec}" OnPower="${p(s.on.pct)}" OffPower="${p(s.off.pct)}">${msg(note)}</IntervalsT>`,
        );
      }
      if (s.skipLastOff) {
        blocks.push(`<SteadyState Duration="${s.on.sec}" Power="${p(s.on.pct)}">${msg(full > 0 ? 'Derniere repetition' : note)}</SteadyState>`);
      }
    } else {
      const cadence = s.cadence ? ` Cadence="${s.cadence}"` : '';
      blocks.push(`<SteadyState Duration="${s.sec}" Power="${p(s.pct)}"${cadence}>${msg(s.label)}</SteadyState>`);
    }
  }

  const [, month, day] = session.date.split('-');
  const name = `Enduro ${DAY_NAMES[dayIndex(session.date)]} ${day}-${month} ${session.title}${session.detail ? ` ${session.detail}` : ''}`;
  const description = [session.why, ...(session.tips ?? [])].join(' ');
  return `<workout_file>
    <author>Enduro</author>
    <name>${esc(name)}</name>
    <description>${esc(description)}</description>
    <sportType>bike</sportType>
    <tags>
        <tag name="Enduro"/>
    </tags>
    <workout>
        ${blocks.join('\n        ')}
    </workout>
</workout_file>
`;
}
