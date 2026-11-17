// Le feu tricolore du jour : croise la fraîcheur calculée (charge des
// dernières semaines) et le ressenti du matin pour dire s'il faut y aller,
// lever le pied ou se reposer.

export const FEELINGS = [
  { v: 1, label: 'Cuit', color: '#E8504F' },
  { v: 2, label: 'Fatigué', color: '#F68D3F' },
  { v: 3, label: 'Moyen', color: '#F7C948' },
  { v: 4, label: 'Bien', color: '#5CC98A' },
  { v: 5, label: 'Au top', color: '#5DB7EA' },
];

/** Écart de pouls de repos (en battements) à partir duquel on parle de récupération incomplète. */
export const PULSE_ALERT = 7;
export const PULSE_WATCH = 4;

/**
 * Pouls de repos habituel : la médiane des mesures des 21 jours précédents.
 * Il en faut au moins 4 — une mesure isolée varie trop pour servir de repère.
 */
export function pulseBaseline(checkins, today) {
  const values = Object.entries(checkins ?? {})
    .filter(([date, c]) => date < today && c?.pulse > 0 && Math.round((Date.parse(today) - Date.parse(date)) / 86400000) <= 21)
    .map(([, c]) => c.pulse)
    .sort((a, b) => a - b);
  if (values.length < 4) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

/**
 * Quelle VFC lire ce matin : l'ECG du matin s'il y en a un (tu l'as fait exprès),
 * sinon celle de la nuit. Les deux ne sont jamais mélangées : chacune a son habitude.
 */
function hrvSource(extra) {
  if (extra.ecg?.hrv) return { hrv: extra.ecg.hrv, of: 'du matin', ecg: true };
  if (extra.night?.hrv) return { hrv: extra.night.hrv, of: 'de nuit', ecg: false };
  return null;
}

const LEVELS = {
  rouge: { title: 'Repos conseillé', mood: 'ko', advice: 'repos' },
  orange: { title: 'On lève le pied', mood: 'tired', advice: 'alleger' },
  vert: { title: 'Feu vert', mood: 'happy', advice: 'go' },
  bleu: { title: 'Jambes de feu', mood: 'pumped', advice: 'go' },
};

/**
 * @param {object} fitness  résultat de fitnessAt()
 * @param {object|null} checkin  { feel: 1..5, sick?: boolean, pulse?: number }
 * @param {object} [extra]  { pulseBase, night, ecg } : pouls de repos habituel (voir pulseBaseline),
 *   nuit mesurée par la montre (voir nightStatus) et ECG de ce matin (voir morningStatus, dans nights.js)
 */
export function readiness(fitness, checkin = null, extra = {}) {
  const reasons = [];
  const feel = checkin?.feel ?? null;
  // Pour conseiller la séance qui reste à faire, c'est la fraîcheur de l'instant qui compte.
  const r = fitness.ratioNow ?? fitness.ratio;
  let level = 'vert';
  const v = hrvSource(extra);

  if (checkin?.sick) { level = 'rouge'; reasons.push('Malade ou blessé : le corps a d’autres priorités.'); }
  if (feel === 1) { level = 'rouge'; reasons.push('Tu te sens cuit ce matin.'); }
  if (r < -0.4) { level = 'rouge'; reasons.push('Ta fatigue dépasse largement ta condition.'); }

  if (level !== 'rouge') {
    if (feel === 2) { level = 'orange'; reasons.push('Tu te sens fatigué.'); }
    if (r < -0.25) { level = 'orange'; reasons.push('Grosse charge ces derniers jours.'); }
    // Pouls de repos nettement au-dessus de l'habitude : la récupération n'est pas complète.
    const drift = checkin?.pulse > 0 && extra.pulseBase ? checkin.pulse - extra.pulseBase : null;
    if (drift != null && drift >= PULSE_ALERT) {
      level = 'orange';
      reasons.push(`Ton pouls de repos est ${Math.round(drift)} battements au-dessus de ton habitude : tu n’as pas fini de récupérer.`);
    } else if (drift != null && drift >= PULSE_WATCH) {
      reasons.push('Ton pouls de repos est un peu plus haut que d’habitude : écoute tes sensations.');
    }
    // Ce que mesure la montre (la nuit, ou l'ECG de ce matin) : même règle pour le pouls.
    const watched = [
      [extra.night?.hr?.drift ?? null, 'Ton pouls de cette nuit'],
      [extra.ecg?.hr?.drift ?? null, 'Ton pouls pendant l’ECG de ce matin'],
    ];
    for (const [d, who] of watched) {
      if (d != null && d >= PULSE_ALERT) {
        level = 'orange';
        reasons.push(`${who} est ${Math.round(d)} battements au-dessus de ton habitude : tu n’as pas fini de récupérer.`);
      } else if (d != null && d >= PULSE_WATCH) {
        reasons.push(`${who} est un peu plus haut que d’habitude.`);
      }
    }
    const pulseUp = (drift ?? 0) >= PULSE_WATCH || watched.some(([d]) => (d ?? 0) >= PULSE_WATCH);
    // La VFC se lit sur plusieurs jours, et une baisse seule ne prouve pas la fatigue
    // (elle baisse aussi, normalement, pendant un bloc chargé) : il faut un autre signe.
    if (v?.hrv.trendLow) {
      const signs = [];
      if (feel === 2 || feel === 3) signs.push(feel === 2 ? 'tu te sens fatigué' : 'tu te sens moyen');
      if (pulseUp) signs.push('ton pouls de repos est plus haut que d’habitude');
      if (signs.length) {
        level = 'orange';
        reasons.push(`Ta VFC ${v.of} baisse depuis plusieurs jours et ${signs.join(', et ')} : ton corps encaisse moins bien en ce moment.`);
      } else {
        reasons.push(`Ta VFC ${v.of} est sous ton habitude depuis quelques jours. Seule, ce n’est pas une alerte : écoute tes sensations.`);
      }
    } else if (v?.hrv.nightLow) {
      reasons.push(v.ecg
        ? 'Ta VFC de ce matin est plus basse que d’habitude. Une mesure isolée ne veut rien dire (nuit courte, stress, café…) : on regarde si ça dure.'
        : 'Ta VFC de cette nuit est plus basse que d’habitude. Une nuit isolée ne veut rien dire (repas tardif, stress, un verre…) : on regarde si ça dure.');
    }
    const monotone = fitness.monotony != null && fitness.monotony > 2 && fitness.weekLoad > 250;
    if (monotone) {
      reasons.push('Semaine très monotone : il manque un vrai jour facile.');
      if (r < -0.1) level = 'orange';
    }
  }
  if (level === 'vert') {
    const calm = !(checkin?.pulse > 0 && extra.pulseBase && checkin.pulse - extra.pulseBase >= PULSE_WATCH)
      && !((extra.night?.hr?.drift ?? 0) >= PULSE_WATCH)
      && !((extra.ecg?.hr?.drift ?? 0) >= PULSE_WATCH)
      && !(v?.hrv.trendLow || v?.hrv.nightLow);
    if (!calm) {
      // Pas de « jambes de feu » quand le cœur dit le contraire.
    } else if (r > 0.05 && (feel == null || feel >= 4)) {
      level = 'bleu';
      reasons.push('Tu es bien reposé.');
    } else if (feel === 5) {
      level = 'bleu';
      reasons.push('Tu te sens au top.');
    } else if (r < -0.1) {
      reasons.push('Fatigue d’entraînement normale : c’est comme ça qu’on progresse.');
    }
  }
  if ((level === 'vert' || level === 'bleu') && v?.hrv.high && !v.hrv.trendLow) {
    reasons.push(`Ta VFC ${v.ecg ? 'de ce matin' : 'de cette nuit'} est au-dessus de ton habitude : belle récupération.`);
  }
  return { level, ...LEVELS[level], reasons, feel };
}

/**
 * Faut-il modifier la séance du jour ? Renvoie null si elle peut rester telle
 * quelle, sinon { mode: 'recup' | 'facile', text }.
 */
export function proposeAdaptation(session, level) {
  if (!session || session.status !== 'planned' || session.role === 'race') return null;
  if (level === 'rouge') {
    if (session.kind === 'recup' && session.durationMin <= 40) return null;
    return { mode: 'recup', text: 'Remplacer par un décrassage très court, ou repos complet.' };
  }
  if (level === 'orange') {
    if (session.hard >= 2 || session.role === 'key') {
      return { mode: 'facile', text: 'Transformer la séance dure en endurance tranquille.' };
    }
  }
  return null;
}
