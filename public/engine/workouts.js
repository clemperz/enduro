// Bibliothèque de séances : chaque séance est une liste d'étapes exprimées en
// zone d'intensité + fraction de PMA (vélo) ou de VMA (course à pied).
//
// Étape simple   : { kind: 'steady'|'warmup'|'cooldown'|'free', sec, zone, pct, pctEnd?, label?, cadence? }
// Répétitions    : { kind: 'intervals', reps, on: {sec, zone, pct, …}, off: {sec, zone, pct}, label? }

import { DEFAULT_PCT, FTP_PER_PMA, RUN_THRESHOLD } from './zones.js';

const P = DEFAULT_PCT;
const sec = (minutes) => Math.round(minutes * 60);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------
// Outils sur les étapes
// ---------------------------------------------------------------------------

/** Déroule les répétitions : renvoie la suite des segments réellement enchaînés. */
export function flatten(steps) {
  const out = [];
  for (const s of steps) {
    if (s.kind === 'intervals') {
      for (let i = 0; i < s.reps; i++) {
        out.push({ ...s.on, kind: 'on', rep: i + 1, of: s.reps });
        const last = i === s.reps - 1;
        if (s.off?.sec > 0 && !(last && s.skipLastOff)) out.push({ ...s.off, kind: 'off' });
      }
    } else {
      out.push(s);
    }
  }
  return out;
}

export function totalSec(steps) {
  return flatten(steps).reduce((t, s) => t + s.sec, 0);
}

/** Secondes passées dans chaque zone. */
export function zoneSeconds(steps) {
  const out = {};
  for (const s of flatten(steps)) out[s.zone] = (out[s.zone] ?? 0) + s.sec;
  return out;
}

/**
 * Charge prévue d'une séance : on simule l'intensité seconde par seconde,
 * on lisse sur 30 s puis on prend la moyenne des puissances 4 (comme une
 * puissance normalisée). 1 h au seuil = 100 points.
 */
export function plannedLoad(sport, steps) {
  const threshold = sport === 'run' ? RUN_THRESHOLD : FTP_PER_PMA;
  const series = [];
  for (const s of flatten(steps)) {
    const a = (s.pct ?? P[sport][s.zone]) / threshold;
    const b = (s.pctEnd ?? s.pct ?? P[sport][s.zone]) / threshold;
    for (let t = 0; t < s.sec; t++) {
      series.push(Math.min(2.2, a + ((b - a) * t) / Math.max(1, s.sec - 1)));
    }
  }
  if (!series.length) return 0;
  const win = 30;
  let sum = 0;
  let acc = 0;
  for (let i = 0; i < series.length; i++) {
    sum += series[i];
    if (i >= win) sum -= series[i - win];
    acc += (sum / Math.min(i + 1, win)) ** 4;
  }
  const intensity = (acc / series.length) ** 0.25;
  return Math.round((series.length / 3600) * intensity * intensity * 100);
}

// ---------------------------------------------------------------------------
// Descriptions (le « pourquoi » et le « comment » de chaque séance)
// ---------------------------------------------------------------------------

export const LIBRARY = {
  bike: {
    recup: {
      title: 'Décrassage', zone: 'i1', hard: 0, rpe: 2,
      why: 'Faire tourner les jambes pour mieux récupérer. Si tu forces, c’est raté !',
      tips: ['Petit braquet, cadence souple (85–95 tr/min).', 'Tu dois finir plus frais qu’au départ.'],
    },
    endurance: {
      title: 'Endurance', zone: 'i2', hard: 0, rpe: 3,
      why: 'Le socle : tu construis ton moteur aérobie sans te fatiguer. Tu dois pouvoir discuter tout du long.',
      tips: ['Reste en I2 même dans les bosses.', 'Au-delà d’1 h : bois régulièrement et mange un peu.'],
    },
    long: {
      title: 'Sortie longue', zone: 'i2', hard: 1, rpe: 4,
      why: 'Apprendre à durer. C’est le temps passé en selle qui compte, pas la vitesse.',
      tips: ['Mange dès la première heure, par petites prises toutes les 15 à 20 min.', 'Garde de la marge : tu dois pouvoir finir en forme.'],
    },
    sv1: {
      title: 'Endurance haute', zone: 'i2', hard: 1, rpe: 4,
      why: 'Rouler juste sous ton premier seuil (SV1) : la base solide qui permet d’encaisser tout le reste.',
      tips: ['Respiration ample mais maîtrisée : tu peux encore faire des phrases.', 'Si le souffle s’emballe, tu es au-dessus : ralentis un peu.'],
    },
    tempo: {
      title: 'Tempo', zone: 'i3', hard: 1, rpe: 5,
      why: 'Un rythme soutenu et régulier (I3) pour apprendre à tenir longtemps.',
      tips: ['Régularité avant tout : même puissance du début à la fin.', 'Cadence 85–95 tr/min.'],
    },
    sweetspot: {
      title: 'Sweet spot', zone: 'i3', hard: 2, rpe: 6,
      why: 'Juste sous le seuil : beaucoup de bénéfices pour une fatigue raisonnable. On « pousse » le seuil par le bas.',
      tips: ['Tu dois finir chaque bloc en te disant « j’aurais pu continuer un peu ».', 'Bois pendant les récupérations.'],
    },
    seuil: {
      title: 'Seuil', zone: 'i4', hard: 2, rpe: 7,
      why: 'Travail au seuil (I4) : tu apprends à tenir fort, longtemps. C’est l’allure d’un contre-la-montre.',
      tips: ['Pars prudemment : le premier bloc doit sembler presque facile.', 'La brûlure monte doucement, elle ne doit pas exploser.'],
    },
    pma3030: {
      title: '30/30', zone: 'i5', hard: 2, rpe: 7,
      why: '30 s vite, 30 s tranquille : beaucoup de temps près de ta PMA sans exploser. On « tire » le seuil par le haut.',
      tips: ['Les 30 s rapides sont vives mais pas en sprint.', 'Sur home trainer : laisse le mode ERG faire le travail.'],
    },
    pma: {
      title: 'PMA', zone: 'i5', hard: 2, rpe: 8,
      why: 'Des efforts de 2 à 5 min près de ta PMA (I5) : c’est la cylindrée du moteur que tu augmentes.',
      tips: ['Vise la même puissance sur toutes les répétitions.', 'Si tu perds plus de 5 % sur une répétition, arrête la série.'],
    },
    force: {
      title: 'Force', zone: 'i3', hard: 2, rpe: 6,
      why: 'Gros braquet, cadence basse, assis : de la musculation spécifique directement sur le vélo.',
      tips: ['Cadence 50–60 tr/min, buste gainé, mains relâchées.', 'Mouline (95 tr/min et +) pendant les récupérations.', 'Genou sensible ? Remplace par du tempo.'],
    },
    activation: {
      title: 'Déblocage', zone: 'i2', hard: 0, rpe: 3,
      why: 'La veille du jour J : réveiller la machine sans entamer les réserves.',
      tips: ['Quelques accélérations franches, puis on rentre.', 'Ce soir : pâtes, eau, dodo.'],
    },
    test: {
      title: 'Tests PMA + FTP', zone: 'i5', hard: 2, rpe: 9,
      why: '5 min à fond (ta PMA), puis 20 min à fond (ta FTP = 95 % de la moyenne). Tes zones seront recalibrées.',
      tips: ['Arrive reposé : c’est pour ça qu’on teste en fin de semaine de récup.', 'Sur le 20 min, pars 5 % en dessous de ce que tu crois pouvoir tenir.', 'Note les deux puissances moyennes dans « Mes repères ».'],
    },
    course: {
      title: 'Jour J', zone: 'i4', hard: 2, rpe: 9,
      why: 'C’est aujourd’hui ! Fais-toi plaisir.',
      tips: ['Pars moins vite que ton envie.', 'Mange et bois avant d’avoir faim ou soif.'],
    },
  },
  run: {
    recup: {
      title: 'Footing récup', zone: 'i1', hard: 0, rpe: 2,
      why: 'Un footing très lent : on fait circuler le sang, rien de plus.',
      tips: ['Si tu as l’impression d’aller trop lentement, c’est la bonne allure.'],
    },
    endurance: {
      title: 'Footing', zone: 'i2', hard: 0, rpe: 3,
      why: 'L’endurance fondamentale : l’allure où tu peux parler. C’est elle qui te fait progresser sans casser.',
      tips: ['Test de la parole : tu dois pouvoir dire une phrase entière.', 'Marche dans les côtes raides si le souffle monte.'],
    },
    long: {
      title: 'Sortie longue', zone: 'i2', hard: 1, rpe: 4,
      why: 'Habituer le corps à durer. Allure tranquille : c’est le temps qui compte.',
      tips: ['Emporte de l’eau au-delà d’1 h.', 'Terrain souple si possible : tes articulations te diront merci.'],
    },
    tempo: {
      title: 'Endurance active', zone: 'i3', hard: 1, rpe: 5,
      why: 'Un rythme « confortablement difficile » (I3) : tu apprends à tenir une allure soutenue.',
      tips: ['Tu peux dire quelques mots, pas tenir une conversation.'],
    },
    seuil: {
      title: 'Seuil', zone: 'i4', hard: 2, rpe: 7,
      why: 'Allure seuil (I4) : rapide mais maîtrisée. Tu repousses le moment où ça se dégrade.',
      tips: ['Allure d’une course d’environ 1 h.', 'Récupération en trottinant, sans s’arrêter.'],
    },
    vma3030: {
      title: '30/30', zone: 'i5', hard: 2, rpe: 7,
      why: 'Le grand classique : 30 s vite, 30 s en trottinant. Beaucoup de temps à haute intensité sans s’effondrer.',
      tips: ['Vite mais relâché : pas un sprint.', 'La dernière répétition doit ressembler à la première.'],
    },
    vma: {
      title: 'VMA', zone: 'i5', hard: 2, rpe: 8,
      why: 'Des fractions de 1 à 3 min proches de ta VMA : tu agrandis ton moteur.',
      tips: ['Régularité : même allure sur toutes les répétitions.', 'Terrain plat ou piste.'],
    },
    allure10: {
      title: 'Allure 10 km', zone: 'i4', hard: 2, rpe: 7,
      why: 'Des fractions à l’allure que tu vises sur 10 km : le corps et la tête apprennent le rythme du jour J.',
      tips: ['Cale-toi dès la première fraction : ni plus vite, ni plus lentement.', 'Récupération en trottinant, sans marcher.'],
    },
    allure21: {
      title: 'Allure semi', zone: 'i3', hard: 2, rpe: 6,
      why: 'De longues fractions à ton allure de semi-marathon, juste sous le seuil : tu apprends à la tenir longtemps.',
      tips: ['Tu dois finir chaque bloc en te disant que tu aurais pu continuer.', 'Récupérations courtes, en footing : c’est ce qui fait la séance.'],
    },
    allure42: {
      title: 'Allure marathon', zone: 'i3', hard: 1, rpe: 5,
      why: 'De longs blocs à ton allure de marathon : le rythme doit devenir automatique, et économe.',
      tips: ['Régularité avant tout : cette allure doit te sembler facile au début.', 'Profites-en pour tester ce que tu boiras et mangeras le jour J.'],
    },
    cotes: {
      title: 'Côtes', zone: 'i5', hard: 2, rpe: 7,
      why: 'Des côtes courtes : de la force et de la technique, avec moins de chocs que sur le plat.',
      tips: ['Pente de 5 à 8 %, foulée dynamique, regard devant.', 'Redescends en trottinant très lentement.'],
    },
    activation: {
      title: 'Déblocage', zone: 'i2', hard: 0, rpe: 3,
      why: 'La veille du jour J : réveiller les jambes sans entamer les réserves.',
      tips: ['Quelques lignes droites, puis on rentre.'],
    },
    test: {
      title: 'Test VMA', zone: 'i5', hard: 2, rpe: 9,
      why: '6 min à fond sur du plat : la distance en mètres ÷ 100 = ta VMA en km/h (test demi-Cooper).',
      tips: ['Idéalement sur une piste (400 m par tour).', 'Pars vite mais pas en sprint : il faut tenir 6 min.', 'Note ta VMA dans « Mes repères ».'],
    },
    course: {
      title: 'Jour J', zone: 'i4', hard: 2, rpe: 9,
      why: 'C’est aujourd’hui ! Fais-toi plaisir.',
      tips: ['Pars moins vite que ton envie.'],
    },
  },
};

/** Progressions : du plus accessible au plus costaud. */
const VARIANTS = {
  bike: {
    sv1: [[2, 15], [2, 20], [3, 15], [3, 20], [2, 30], [3, 25], [2, 40]],
    tempo: [[2, 12], [2, 15], [3, 12], [3, 15], [2, 25], [3, 20]],
    sweetspot: [[2, 10], [2, 12], [3, 10], [3, 12], [2, 20], [3, 15], [2, 25]],
    seuil: [[3, 6], [3, 8], [4, 8], [3, 10], [3, 12], [2, 20], [3, 15]],
    pma3030: [[2, 6], [2, 8], [2, 10], [3, 8], [3, 10]],
    pma: [[5, 2, 0.96], [6, 2, 0.96], [5, 3, 0.93], [4, 4, 0.9], [5, 4, 0.9], [5, 5, 0.87]],
    force: [[4, 4], [5, 4], [5, 5], [6, 5]],
  },
  run: {
    tempo: [[2, 8], [2, 10], [3, 10], [2, 15], [3, 12], [2, 20]],
    seuil: [[3, 5], [3, 6], [3, 8], [4, 8], [3, 10], [2, 15]],
    vma3030: [[1, 8], [2, 6], [2, 8], [2, 10], [2, 12]],
    vma: [[6, 1, 1.0], [5, 2, 0.97], [6, 2, 0.97], [5, 3, 0.94], [6, 3, 0.94]],
    cotes: [[6, 30], [8, 30], [8, 45], [10, 45], [8, 60]],
    // Allures d'objectif : fractions d'autant plus longues que la course visée est longue.
    // La première version, courte, sert de rappel d'allure pendant l'affûtage (elle tient en 35 min).
    allure10: [[3, 4], [4, 4], [5, 4], [4, 5], [5, 5], [4, 6], [3, 8]],
    allure21: [[2, 6], [3, 8], [3, 10], [2, 15], [3, 12], [3, 15], [2, 20]],
    allure42: [[1, 15], [2, 12], [2, 15], [2, 20], [3, 15], [2, 25], [3, 20]],
  },
};

/**
 * Part de la VMA tenue en course selon la distance, pour un coureur moyen :
 * 10 km ≈ 87 %, semi ≈ 81 %, marathon ≈ 76 % (cohérent avec predict.js).
 */
export const RUN_PACE = { allure10: 0.87, allure21: 0.81, allure42: 0.76 };

export function variantCount(sport, kind) {
  return VARIANTS[sport]?.[kind]?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Briques
// ---------------------------------------------------------------------------

const steady = (minutes, zone, pct, extra = {}) => ({ kind: 'steady', sec: sec(minutes), zone, pct, ...extra });
const reps = (n, on, off, label) => ({ kind: 'intervals', reps: n, on, off, label });
/** Répétitions longues : pas de récupération après la dernière (le retour au calme suffit). */
const blocks = (n, on, off, label) => ({ kind: 'intervals', reps: n, on, off, label, skipLastOff: true });

function warmup(sport, hard, short) {
  if (sport === 'bike') {
    const w = [{ kind: 'warmup', sec: sec(short ? 8 : 12), zone: 'i1', pct: 0.4, pctEnd: 0.62, label: 'Échauffement progressif' }];
    if (hard) {
      w.push(reps(2, { sec: 60, zone: 'i4', pct: 0.78, label: 'Réveil des jambes' }, { sec: 60, zone: 'i1', pct: 0.45 }, 'Réveil des jambes'));
    }
    return w;
  }
  const w = [{ kind: 'warmup', sec: sec(short ? 10 : 15), zone: 'i1', pct: 0.58, pctEnd: 0.7, label: 'Footing d’échauffement' }];
  if (hard) {
    w.push(reps(3, { sec: 20, zone: 'i5', pct: 0.95, label: 'Ligne droite' }, { sec: 40, zone: 'i1', pct: 0.55 }, 'Lignes droites'));
  }
  return w;
}

function cooldown(sport, short) {
  if (sport === 'bike') {
    return [{ kind: 'cooldown', sec: sec(short ? 5 : 8), zone: 'i1', pct: 0.55, pctEnd: 0.4, label: 'Retour au calme' }];
  }
  return [{ kind: 'cooldown', sec: sec(short ? 5 : 8), zone: 'i1', pct: 0.62, pctEnd: 0.55, label: 'Retour au calme en trottinant' }];
}

function mainSet(sport, kind, v) {
  if (sport === 'bike') {
    switch (kind) {
      case 'sv1':
        return [blocks(v[0], { sec: sec(v[1]), zone: 'i2', pct: 0.6, label: 'Haut de l’endurance' }, { sec: 300, zone: 'i1', pct: 0.48 }, `${v[0]} × ${v[1]} min sous le 1er seuil`)];
      case 'tempo':
        return [blocks(v[0], { sec: sec(v[1]), zone: 'i3', pct: 0.7, label: 'Tempo' }, { sec: 300, zone: 'i1', pct: 0.48 }, `${v[0]} × ${v[1]} min tempo`)];
      case 'sweetspot':
        return [blocks(v[0], { sec: sec(v[1]), zone: 'i3', pct: 0.72, label: 'Sweet spot' }, { sec: 300, zone: 'i1', pct: 0.48 }, `${v[0]} × ${v[1]} min sweet spot`)];
      case 'seuil': {
        const rest = Math.max(180, sec(v[1] / 2));
        return [blocks(v[0], { sec: sec(v[1]), zone: 'i4', pct: v[1] >= 15 ? 0.76 : 0.78, label: 'Seuil' }, { sec: rest, zone: 'i1', pct: 0.48 }, `${v[0]} × ${v[1]} min au seuil`)];
      }
      case 'pma3030': {
        const out = [];
        for (let s = 0; s < v[0]; s++) {
          out.push(reps(v[1], { sec: 30, zone: 'i5', pct: 1.02, label: 'Vite' }, { sec: 30, zone: 'i1', pct: 0.45 }, `Série ${s + 1} : ${v[1]} × 30 s / 30 s`));
          if (s < v[0] - 1) out.push(steady(5, 'i1', 0.45, { label: 'Récupération entre les séries' }));
        }
        return out;
      }
      case 'pma':
        return [blocks(v[0], { sec: sec(v[1]), zone: 'i5', pct: v[2], label: 'PMA' }, { sec: sec(v[1]), zone: 'i1', pct: 0.45 }, `${v[0]} × ${v[1]} min à PMA`)];
      case 'force':
        return [blocks(v[0], { sec: sec(v[1]), zone: 'i3', pct: 0.72, cadence: 55, label: 'Force (50–60 tr/min)' }, { sec: 240, zone: 'i1', pct: 0.48, cadence: 95 }, `${v[0]} × ${v[1]} min en force`)];
      default:
        return [];
    }
  }
  switch (kind) {
    case 'tempo':
      return [blocks(v[0], { sec: sec(v[1]), zone: 'i3', pct: 0.8, label: 'Endurance active' }, { sec: 120, zone: 'i1', pct: 0.62 }, `${v[0]} × ${v[1]} min en endurance active`)];
    case 'seuil': {
      const rest = v[1] >= 10 ? 150 : 120;
      return [blocks(v[0], { sec: sec(v[1]), zone: 'i4', pct: 0.88, label: 'Allure seuil' }, { sec: rest, zone: 'i1', pct: 0.6 }, `${v[0]} × ${v[1]} min au seuil`)];
    }
    case 'vma3030': {
      const out = [];
      for (let s = 0; s < v[0]; s++) {
        out.push(reps(v[1], { sec: 30, zone: 'i5', pct: 1.02, label: 'Vite' }, { sec: 30, zone: 'i1', pct: 0.55 }, `Série ${s + 1} : ${v[1]} × 30 s / 30 s`));
        if (s < v[0] - 1) out.push(steady(3, 'i1', 0.58, { label: 'Récupération en trottinant' }));
      }
      return out;
    }
    case 'vma': {
      const rest = Math.min(150, sec(v[1]));
      return [blocks(v[0], { sec: sec(v[1]), zone: 'i5', pct: v[2], label: 'Allure VMA' }, { sec: rest, zone: 'i1', pct: 0.55 }, `${v[0]} × ${v[1]} min à VMA`)];
    }
    case 'allure10': {
      // Allure 10 km ≈ 87 % de la VMA ; récupération d'un peu moins de la moitié de l'effort.
      const rest = Math.max(90, Math.round(sec(v[1]) * 0.4 / 15) * 15);
      return [blocks(v[0], { sec: sec(v[1]), zone: 'i4', pct: RUN_PACE.allure10, label: 'Allure 10 km' }, { sec: rest, zone: 'i1', pct: 0.6 }, `${v[0]} × ${v[1]} min à allure 10 km`)];
    }
    case 'allure21':
    case 'allure42': {
      // Semi ≈ 81 % de la VMA, marathon ≈ 76 % ; récupération d'un quart de l'effort, en footing.
      const rest = Math.max(120, Math.round(sec(v[1]) / 4 / 30) * 30);
      const label = kind === 'allure21' ? 'Allure semi' : 'Allure marathon';
      return [blocks(v[0], { sec: sec(v[1]), zone: 'i3', pct: RUN_PACE[kind], label }, { sec: rest, zone: 'i2', pct: 0.66 }, `${v[0]} × ${v[1]} min à ${label.toLowerCase()}`)];
    }
    case 'cotes':
      return [reps(v[0], { sec: v[1], zone: 'i5', pct: 1.0, label: 'Montée dynamique', effortOnly: true }, { sec: 90, zone: 'i1', pct: 0.5, label: 'Descente en trottinant' }, `${v[0]} × ${v[1]} s en côte`)];
    default:
      return [];
  }
}

function variantLabel(sport, kind, v) {
  if (kind === 'pma3030' || kind === 'vma3030') return v[0] > 1 ? `${v[0]} × (${v[1]} × 30/30)` : `${v[1]} × 30/30`;
  if (kind === 'cotes') return `${v[0]} × ${v[1]} s`;
  return `${v[0]} × ${v[1]} min`;
}

/** Complète une séance trop courte par de l'endurance pour atteindre `minutes`. */
function pad(sport, steps, minutes) {
  const missing = Math.floor(minutes - totalSec(steps) / 60);
  if (missing < 5) return steps;
  const filler = steady(missing, 'i2', P[sport].i2 - 0.02, { label: sport === 'bike' ? 'Endurance pour finir' : 'Footing' });
  const out = steps.slice();
  if (sport === 'bike') out.splice(out.length - 1, 0, filler);
  else out.splice(1, 0, filler);
  return out;
}

/** Séance clé : choisit la plus grosse variante (≤ `step`) qui tient dans le temps. */
function buildKey(sport, kind, minutes, step, recovery) {
  const table = VARIANTS[sport][kind];
  let idx = clamp(step, 0, table.length - 1);
  if (recovery) idx = Math.max(0, idx - 2);
  for (; idx >= 0; idx--) {
    for (const short of [false, true]) {
      const steps = [...warmup(sport, true, short), ...mainSet(sport, kind, table[idx]), ...cooldown(sport, short)];
      if (totalSec(steps) / 60 <= minutes) {
        return { steps: pad(sport, steps, minutes), detail: variantLabel(sport, kind, table[idx]) };
      }
    }
  }
  return null;
}

function buildEndurance(sport, minutes, { sprints = false, finish = false, zone = 'i2' } = {}) {
  const pct = zone === 'i1' ? P[sport].i1 : P[sport].i2;
  const steps = [];
  if (sport === 'bike') {
    const warm = zone === 'i1' ? 0 : Math.min(10, Math.round(minutes * 0.2));
    const cool = minutes >= 40 && zone !== 'i1' ? 5 : 0;
    let core = minutes - warm - cool;
    if (warm) steps.push({ kind: 'warmup', sec: sec(warm), zone: 'i1', pct: 0.42, pctEnd: pct, label: 'Mise en route' });
    if (sprints && core >= 40) {
      const n = core >= 60 ? 6 : 4;
      steps.push(steady(10, 'i2', pct, { label: 'Endurance' }));
      steps.push(reps(n, { sec: 10, zone: 'i7', pct: 2.0, label: 'Sprint assis-debout' }, { sec: 230, zone: 'i2', pct: pct - 0.02 }, `${n} sprints de 10 s`));
      core -= 10 + n * 4;
    }
    if (finish && core >= 70) {
      steps.push(steady(core - 34, 'i2', pct, { label: 'Endurance' }));
      steps.push(reps(2, { sec: sec(12), zone: 'i3', pct: 0.68, label: 'Finir fort' }, { sec: 300, zone: 'i2', pct: 0.54 }, '2 × 12 min tempo pour finir'));
    } else if (core > 0) {
      steps.push(steady(core, zone, pct, { label: zone === 'i1' ? 'Très souple' : 'Endurance' }));
    }
    if (cool) steps.push({ kind: 'cooldown', sec: sec(cool), zone: 'i1', pct: pct - 0.05, pctEnd: 0.4, label: 'Retour au calme' });
    return steps;
  }
  const warm = zone === 'i1' ? 0 : Math.min(8, Math.round(minutes * 0.2));
  let core = minutes - warm;
  if (warm) steps.push({ kind: 'warmup', sec: sec(warm), zone: 'i1', pct: 0.58, pctEnd: pct, label: 'Départ en douceur' });
  if (sprints && core >= 25) {
    steps.push(steady(core - 9, 'i2', pct, { label: 'Footing' }));
    steps.push(reps(6, { sec: 20, zone: 'i5', pct: 0.95, label: 'Ligne droite' }, { sec: 40, zone: 'i1', pct: 0.55 }, '6 lignes droites de 20 s'));
    steps.push(steady(3, 'i1', 0.58, { label: 'Retour au calme' }));
  } else {
    steps.push(steady(core, zone, pct, { label: zone === 'i1' ? 'Très lent' : 'Footing' }));
  }
  return steps;
}

function buildTest(sport, minutes = 999) {
  if (sport === 'bike') {
    // Version complète (~70 min) ou compacte (~1 h) selon le temps disponible.
    const full = minutes >= 70;
    return [
      { kind: 'warmup', sec: sec(full ? 14 : 12), zone: 'i1', pct: 0.4, pctEnd: 0.65, label: 'Échauffement progressif' },
      reps(full ? 3 : 2, { sec: 60, zone: 'i4', pct: 0.8, cadence: 100, label: 'Accélération en vélocité' }, { sec: 60, zone: 'i1', pct: 0.45 }, `${full ? 3 : 2} accélérations d’1 min`),
      steady(full ? 5 : 2, 'i1', 0.45, { label: 'Récupération' }),
      { kind: 'free', sec: sec(5), zone: 'i5', pct: 1.0, label: '5 min À FOND → ta PMA', test: 'pma' },
      steady(full ? 10 : 8, 'i1', 0.42, { label: 'Récupération complète' }),
      { kind: 'free', sec: sec(20), zone: 'i4', pct: 0.8, label: '20 min À FOND, régulier → ta FTP', test: 'ftp' },
      { kind: 'cooldown', sec: sec(full ? 10 : 8), zone: 'i1', pct: 0.5, pctEnd: 0.38, label: 'Retour au calme' },
    ];
  }
  const full = minutes >= 37;
  return [
    { kind: 'warmup', sec: sec(full ? 15 : 12), zone: 'i1', pct: 0.58, pctEnd: 0.7, label: 'Footing d’échauffement' },
    reps(3, { sec: 20, zone: 'i5', pct: 0.95, label: 'Ligne droite' }, { sec: 40, zone: 'i1', pct: 0.55 }, 'Lignes droites'),
    steady(full ? 3 : 2, 'i1', 0.55, { label: 'Récupération' }),
    { kind: 'free', sec: sec(6), zone: 'i5', pct: 1.0, label: '6 min À FOND → distance ÷ 100 = VMA', test: 'vma' },
    { kind: 'cooldown', sec: sec(full ? 10 : 6), zone: 'i1', pct: 0.6, pctEnd: 0.55, label: 'Retour au calme' },
  ];
}

function buildActivation(sport) {
  if (sport === 'bike') {
    return [
      { kind: 'warmup', sec: sec(12), zone: 'i1', pct: 0.4, pctEnd: 0.6, label: 'Échauffement' },
      reps(3, { sec: 60, zone: 'i5', pct: 0.9, label: 'Accélération franche' }, { sec: 180, zone: 'i2', pct: 0.52 }, '3 × 1 min dynamique'),
      reps(2, { sec: 8, zone: 'i7', pct: 2.0, label: 'Sprint' }, { sec: 172, zone: 'i1', pct: 0.48 }, '2 sprints'),
      { kind: 'cooldown', sec: sec(10), zone: 'i1', pct: 0.5, pctEnd: 0.4, label: 'Retour au calme' },
    ];
  }
  return [
    { kind: 'warmup', sec: sec(15), zone: 'i1', pct: 0.58, pctEnd: 0.68, label: 'Footing tranquille' },
    reps(4, { sec: 20, zone: 'i5', pct: 0.95, label: 'Ligne droite' }, { sec: 60, zone: 'i1', pct: 0.55 }, '4 lignes droites'),
    steady(5, 'i1', 0.58, { label: 'Retour au calme' }),
  ];
}

// ---------------------------------------------------------------------------
// Fabrique
// ---------------------------------------------------------------------------

/** Durée minimale (en minutes) pour qu'une séance clé garde son sens. */
export function minMinutes(sport, kind) {
  if (kind === 'test') return sport === 'bike' ? 59 : 29;
  if (kind === 'activation') return sport === 'bike' ? 40 : 26;
  const table = VARIANTS[sport]?.[kind];
  if (!table) return 20;
  const steps = [...warmup(sport, true, true), ...mainSet(sport, kind, table[0]), ...cooldown(sport, true)];
  return Math.ceil(totalSec(steps) / 60);
}

/**
 * Construit une séance.
 * @param {object} o
 * @param {'bike'|'run'} o.sport
 * @param {string} o.kind   recup | endurance | long | sv1 | tempo | sweetspot | seuil | pma3030 | pma | force
 *                          | vma3030 | vma | cotes | allure10 | allure21 | allure42 | test | activation | course
 * @param {number} o.minutes  temps visé
 * @param {number} [o.step]   cran de progression (0 = le plus accessible)
 * @param {boolean} [o.recovery]  semaine de récupération : version allégée
 * @param {boolean} [o.sprints]   ajoute des sprints (vélo) ou des lignes droites (course)
 * @param {boolean} [o.finish]    sortie longue terminée par un peu de tempo
 */
/**
 * Conseils de ravitaillement selon la durée : 30 à 60 g de glucides par heure
 * jusqu'à 2 h 30, 60 à 90 g au-delà — et la sortie longue sert à s'y exercer.
 */
function fuelTips(kind, minutes, tips) {
  if (kind !== 'long' && kind !== 'endurance') return tips;
  if (minutes >= 150) {
    return [...tips, 'Plus de 2 h 30 : vise 60 à 90 g de glucides par heure, et profites-en pour tester ce que tu mangeras le jour J.'];
  }
  if (minutes >= 75) return [...tips, 'Compte 30 à 60 g de glucides par heure (une banane ou une barre, plus un bidon sucré).'];
  return tips;
}

export function buildSession({ sport, kind, minutes, step = 0, recovery = false, sprints = false, finish = false }) {
  let steps;
  let detail = '';
  let actualKind = kind;
  let fallback = false;

  if (kind === 'course') {
    steps = [];
  } else if (kind === 'test') {
    steps = buildTest(sport, minutes);
  } else if (kind === 'activation') {
    steps = buildActivation(sport);
  } else if (kind === 'recup') {
    steps = buildEndurance(sport, minutes, { zone: 'i1' });
  } else if (kind === 'endurance' || kind === 'long') {
    steps = buildEndurance(sport, minutes, { sprints, finish });
    if (sprints && flatten(steps).some((s) => s.zone === 'i7' || s.zone === 'i5')) {
      detail = sport === 'bike' ? '+ sprints' : '+ lignes droites';
    } else if (finish && steps.some((s) => s.kind === 'intervals')) {
      detail = 'fin en tempo';
    }
  } else {
    const built = buildKey(sport, kind, minutes, step, recovery);
    if (built) {
      steps = built.steps;
      detail = built.detail;
    } else {
      // Pas assez de temps pour la séance prévue : on fait simple.
      actualKind = 'endurance';
      fallback = true;
      steps = buildEndurance(sport, minutes, {});
    }
  }

  const meta = LIBRARY[sport][actualKind];
  const minutesDone = Math.round(totalSec(steps) / 60);
  return {
    sport,
    kind: actualKind,
    title: meta.title,
    detail,
    zone: meta.zone,
    hard: meta.hard,
    rpe: meta.rpe,
    why: meta.why,
    tips: fuelTips(actualKind, minutesDone, meta.tips),
    steps,
    durationMin: Math.round(totalSec(steps) / 60),
    load: plannedLoad(sport, steps),
    fallback,
  };
}
