// Les 7 intensités.
//
// Vélo : échelle ESIE de Frédéric Grappe (1999) — % de PMA, % de FC max et
// sensations. Course à pied : mêmes 7 niveaux de ressenti, exprimés en % de
// VMA (zones classiques de l'entraînement français).

/** FTP (puissance tenable ~1 h) ≈ 78 % de la PMA (puissance record sur ~5 min). */
export const FTP_PER_PMA = 0.78;
/** Allure seuil en course à pied ≈ 88 % de la VMA. */
export const RUN_THRESHOLD = 0.88;
/** FC au seuil ≈ 93 % de la FC max (I4 de Grappe : 92–96 %). */
export const LTHR_PER_FCMAX = 0.93;

export const ZONES = [
  {
    id: 'i1', num: 1, name: 'Légère', nick: 'Balade', color: '#B9C6D2', dark: '#5E7083',
    pma: [0.35, 0.5], fc: [0.6, 0.75], vma: [0.5, 0.65],
    hold: 'Des heures', runHold: 'Des heures', legs: 'Aucune tension dans les jambes', talk: 'Tu papotes sans y penser',
    use: 'Récupérer, faire tourner les jambes',
  },
  {
    id: 'i2', num: 2, name: 'Moyenne', nick: 'Endurance', color: '#5DB7EA', dark: '#1F6FA3',
    pma: [0.5, 0.65], fc: [0.75, 0.85], vma: [0.65, 0.75],
    hold: '3 à 4 h avant de fatiguer', runHold: '1 h 30 à 3 h', legs: 'Jambes légères', talk: 'Conversation facile',
    use: 'Construire le moteur : la base de tout',
  },
  {
    id: 'i3', num: 3, name: 'Soutenue', nick: 'Tempo', color: '#5CC98A', dark: '#1F7D49',
    pma: [0.65, 0.75], fc: [0.85, 0.92], vma: [0.75, 0.85],
    hold: 'Jusqu’à 2 h', runHold: '1 à 2 h (allure marathon)', legs: 'Les jambes commencent à tirer', talk: 'Phrases courtes',
    use: 'Tenir un bon rythme longtemps',
  },
  {
    id: 'i4', num: 4, name: 'Critique', nick: 'Seuil', color: '#F7C948', dark: '#9A7208',
    pma: [0.75, 0.8], fc: [0.92, 0.96], vma: [0.85, 0.92],
    hold: '20 min à 1 h', runHold: '30 min à 1 h', legs: 'La brûlure monte doucement', talk: 'Quelques mots, pas plus',
    use: 'Repousser le seuil',
  },
  {
    id: 'i5', num: 5, name: 'Sur-critique', nick: 'PMA', runNick: 'VMA', color: '#F68D3F', dark: '#A8500F',
    pma: [0.8, 1.0], fc: [0.96, 1.0], vma: [0.92, 1.05],
    hold: '3 à 7 min à 100 %', runHold: '4 à 8 min à 100 %', legs: 'Ça brûle vite et fort', talk: 'Presque impossible',
    use: 'Agrandir la cylindrée (VO2max)',
  },
  {
    id: 'i6', num: 6, name: 'Sous-maximale', nick: 'Lactique', runNick: 'Vitesse', color: '#E8504F', dark: '#9C2423',
    pma: [1.0, 1.8], fc: null, vma: [1.05, 1.3],
    hold: '30 s à 1 min', runHold: '1 à 2 min', legs: 'Souffrance maximale', talk: 'Impossible',
    use: 'Punch, relances, tolérance à l’acide',
  },
  {
    id: 'i7', num: 7, name: 'Maximale', nick: 'Sprint', color: '#9C6BE0', dark: '#5B2FA3',
    pma: [1.8, 3.0], fc: null, vma: [1.3, 1.6],
    hold: 'Moins de 10 s', runHold: 'Quelques secondes', legs: 'Pas de douleur : c’est nerveux', talk: 'En apnée',
    use: 'Explosivité, réveil du système nerveux',
  },
];

export const ZONE_BY_ID = Object.fromEntries(ZONES.map((z) => [z.id, z]));

/** Cible par défaut au cœur de chaque zone (fraction de PMA ou de VMA). */
export const DEFAULT_PCT = {
  // I1 à 42 % de PMA (≈ 54 % de la FTP) : sous les 55 % de FTP, la récupération ne coûte vraiment rien.
  bike: { i1: 0.42, i2: 0.57, i3: 0.7, i4: 0.78, i5: 0.92, i6: 1.3, i7: 2.0 },
  run: { i1: 0.6, i2: 0.7, i3: 0.8, i4: 0.88, i5: 0.98, i6: 1.1, i7: 1.25 },
};

/** Zone correspondant à une fraction de PMA (vélo) ou de VMA (course). */
export function zoneForPct(pct, sport = 'bike') {
  const key = sport === 'run' ? 'vma' : 'pma';
  for (const z of ZONES) if (pct < z[key][1]) return z;
  return ZONES[ZONES.length - 1];
}

/** FC max estimée (Tanaka 2001) : 208 − 0,7 × âge. */
export function estimateFcMax(age) {
  return Math.round(208 - 0.7 * age);
}

/**
 * Repères utilisables : ce qui est saisi dans le profil d'abord, puis, pour
 * ce qui manque, les estimations tirées des activités (voir estimate.js),
 * et en dernier recours les formules générales (PMA ↔ FTP, âge → FC max).
 *
 * `est` signale ce qui est estimé, `why` dit d'où vient chaque estimation :
 * { quality: 'test' | 'record' | 'cardio' | 'formule', basis: 'texte' }.
 */
export function resolveRefs(profile, year = new Date().getFullYear(), estimates = null) {
  const raw = profile?.refs ?? {};
  const e = estimates ?? {};
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  const est = {};
  const why = {};
  let pma = num(raw.pma);
  let ftp = num(raw.ftp);
  if (!pma && !ftp) {
    if (e.pma) { pma = e.pma.value; est.pma = true; why.pma = e.pma; }
    if (e.ftp) { ftp = e.ftp.value; est.ftp = true; why.ftp = e.ftp; }
  } else if (pma && !ftp) {
    const derived = Math.round(pma * FTP_PER_PMA);
    // Un record peut dépasser la valeur déduite, sans jamais approcher la PMA elle-même.
    const fromData = e.ftp && !e.ftp.derived ? Math.min(e.ftp.value, Math.round(pma * 0.9)) : 0;
    if (fromData > derived) { ftp = fromData; why.ftp = e.ftp; } else { ftp = derived; why.ftp = { quality: 'formule', basis: `ta PMA (${pma} W) : la FTP en vaut environ 78 %` }; }
    est.ftp = true;
  } else if (ftp && !pma) {
    const derived = Math.round(ftp / FTP_PER_PMA);
    const fromData = e.pma && !e.pma.derived ? e.pma.value : 0;
    if (fromData > derived) { pma = fromData; why.pma = e.pma; } else { pma = derived; why.pma = { quality: 'formule', basis: `ta FTP (${ftp} W), qui vaut environ 78 % de la PMA` }; }
    est.pma = true;
  }
  let fcmax = num(raw.fcmax);
  if (!fcmax) {
    if (e.fcmax) {
      fcmax = e.fcmax.value;
      why.fcmax = e.fcmax;
    } else if (num(profile?.birthYear)) {
      fcmax = estimateFcMax(year - Number(profile.birthYear));
      why.fcmax = { quality: 'formule', basis: 'ton âge (208 − 0,7 × âge)' };
    }
    if (fcmax) est.fcmax = true;
  }
  let fcrest = num(raw.fcrest);
  if (!fcrest) { fcrest = 60; est.fcrest = true; }
  let vma = num(raw.vma);
  if (!vma && e.vma) { vma = e.vma.value; est.vma = true; why.vma = e.vma; }
  return { pma, ftp, fcmax, fcrest, vma, weightKg: num(profile?.weightKg), est, why };
}

const round5 = (w) => Math.round(w / 5) * 5;

/** 12 km/h → '5:00'. */
export function paceStr(kmh) {
  if (!kmh || kmh <= 0) return '–';
  const sec = Math.round(3600 / kmh);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/**
 * Cible lisible pour une étape : watts (vélo) ou allure (course), plus la
 * plage de FC quand elle a un sens (efforts assez longs, zones I1 à I5).
 */
export function stepTarget(sport, step, refs) {
  const out = { main: null, hr: null };
  const from = step.pct;
  const to = step.pctEnd ?? step.pct;
  if (sport === 'bike' && refs.pma && from) {
    if (step.pctEnd != null && Math.abs(to - from) > 0.01) {
      out.main = `${round5(from * refs.pma)} → ${round5(to * refs.pma)} W`;
    } else if (from >= 1.5) {
      out.main = `à fond (${round5(from * refs.pma)} W et +)`;
    } else {
      out.main = `${round5(from * refs.pma * 0.97)}–${round5(from * refs.pma * 1.03)} W`;
    }
  }
  if (sport === 'run' && refs.vma && from) {
    if (step.pctEnd != null && Math.abs(to - from) > 0.01) {
      out.main = `${paceStr(from * refs.vma)} → ${paceStr(to * refs.vma)} /km`;
    } else if (from >= 1.2) {
      out.main = 'vite et relâché';
    } else {
      out.main = `${paceStr(from * refs.vma * 1.02)}–${paceStr(from * refs.vma * 0.98)} /km`;
    }
  }
  const zone = ZONE_BY_ID[step.zone];
  if (refs.fcmax && zone?.fc && (step.sec ?? 0) >= 180) {
    out.hr = `${Math.round(zone.fc[0] * refs.fcmax)}–${Math.round(zone.fc[1] * refs.fcmax)} bpm`;
  }
  return out;
}

/** Tableau complet des zones personnalisées (pour l'écran « Mes zones »). */
export function zoneTable(sport, refs) {
  return ZONES.map((z) => {
    const row = { zone: z, main: null, hr: null };
    if (sport === 'bike' && refs.pma) {
      row.main = z.num === 7
        ? `${round5(z.pma[0] * refs.pma)} W et +`
        : `${round5(z.pma[0] * refs.pma)}–${round5(z.pma[1] * refs.pma)} W`;
    }
    if (sport === 'run' && refs.vma) {
      row.main = z.num === 7
        ? 'sprint'
        : `${paceStr(z.vma[1] * refs.vma)}–${paceStr(z.vma[0] * refs.vma)} /km`;
    }
    if (refs.fcmax && z.fc) {
      row.hr = `${Math.round(z.fc[0] * refs.fcmax)}–${Math.round(z.fc[1] * refs.fcmax)} bpm`;
    }
    return row;
  });
}

/** Petit nom d'une zone selon le sport (I5 = « PMA » à vélo, « VMA » à pied). */
export function zoneNick(zone, sport) {
  return sport === 'run' ? zone.runNick ?? zone.nick : zone.nick;
}

export function zoneHold(zone, sport) {
  return sport === 'run' ? zone.runHold ?? zone.hold : zone.hold;
}
