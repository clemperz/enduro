// Se situer : prédire un chrono, estimer sa VO2max, connaître son profil.
//
// Tout ici est un ordre de grandeur : une prédiction suppose une préparation
// adaptée à la distance, et une formule statistique ne remplace pas un test.

import { enduranceFraction } from './running.js';
import { FORMATS } from './formats.js';
import { paceStr } from './zones.js';

/**
 * Formule de Riegel (1981) : T2 = T1 × (D2 / D1)^1,06. Elle prédit un temps sur
 * une distance à partir d'un chrono sur une autre. Fiable du 5 km au marathon,
 * et d'autant plus que les deux distances sont proches.
 */
export function riegel(sec1, km1, km2, k = 1.06) {
  if (!(sec1 > 0) || !(km1 > 0) || !(km2 > 0)) return null;
  return sec1 * (km2 / km1) ** k;
}

/**
 * Temps probable sur `km` d'après la VMA : la durée pour laquelle la vitesse
 * tenable (VMA × part tenable sur cette durée) couvre juste la distance.
 * Donne environ 86 % de la VMA sur 10 km, 81 % sur semi, 75 % sur marathon.
 */
export function timeFromVma(vma, km) {
  if (!(vma > 0) || !(km > 0)) return null;
  let lo = 0.5;
  let hi = 2400;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if ((vma * enduranceFraction(mid) * mid) / 60 < km) lo = mid; else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 60);
}

/** Chronos probables sur les distances classiques : [{ id, label, km, sec, pace }]. */
export function racePredictions(vma) {
  if (!(vma > 0)) return [];
  return FORMATS.run.map((f) => {
    const sec = timeFromVma(vma, f.km);
    return { id: f.id, label: f.short, km: f.km, sec, pace: paceStr(f.km / (sec / 3600)) };
  });
}

/** VO2max estimée à pied (ml/min/kg) : 3,5 × VMA (Léger et Mercier). */
export function vo2maxFromVma(vma) {
  return vma > 0 ? 3.5 * vma : null;
}

/**
 * VO2max estimée à vélo (ml/min/kg), d'après Hawley et Noakes (1992) :
 * 0,01141 × PMA + 0,435 litres par minute, ramenés au poids.
 */
export function vo2maxFromPma(pma, kg) {
  return pma > 0 && kg > 0 ? ((0.01141 * pma + 0.435) * 1000) / kg : null;
}

/** Repère grossier, tous âges confondus : où se situe une VO2max (ml/min/kg). */
export function vo2Label(vo2) {
  if (!(vo2 > 0)) return null;
  if (vo2 < 35) return 'à construire';
  if (vo2 < 45) return 'correcte';
  if (vo2 < 55) return 'bonne';
  if (vo2 < 65) return 'très bonne';
  return 'de haut niveau';
}

/** Un repère est « sûr » s'il a été saisi ou mesuré lors d'un test — pas déduit ni tiré d'un simple record. */
function solid(refs, key) {
  if (!refs?.[key]) return false;
  if (!refs.est?.[key]) return true;
  const why = refs.why?.[key];
  return why?.quality === 'test' && !why.derived;
}

/**
 * Profil du cycliste d'après le rapport FTP / PMA (en moyenne 78 %) :
 * - au-dessus de 82 % : le seuil est déjà collé au plafond → c'est le plafond (PMA) qu'il faut remonter ;
 * - en dessous de 74 % : gros plafond, seuil en retrait → c'est le seuil qu'il faut pousser ;
 * - entre les deux : équilibré.
 * Renvoie null tant que PMA et FTP ne sont pas toutes deux saisies ou mesurées.
 */
export function bikeProfile(refs) {
  if (!solid(refs, 'pma') || !solid(refs, 'ftp')) return null;
  const ratio = refs.ftp / refs.pma;
  if (!(ratio > 0.5 && ratio < 1)) return null;
  const pct = Math.round(ratio * 100);
  if (ratio >= 0.82) {
    return { key: 'diesel', ratio, pct, bias: 'pma', title: 'Profil diesel', text: `Ta FTP vaut ${pct} % de ta PMA : ton seuil est déjà tout près du plafond. Pour progresser encore, c’est le plafond qu’il faut remonter — le plan donne un peu plus de place à la PMA.` };
  }
  if (ratio <= 0.74) {
    return { key: 'punch', ratio, pct, bias: 'seuil', title: 'Profil puncheur', text: `Ta FTP vaut ${pct} % de ta PMA : tu as un gros plafond, mais ton seuil est en retrait. Il y a de la marge pour le pousser — le plan donne un peu plus de place au travail au seuil.` };
  }
  return { key: 'equilibre', ratio, pct, bias: null, title: 'Profil équilibré', text: `Ta FTP vaut ${pct} % de ta PMA, tout près de la moyenne (78 %) : seuil et plafond avancent ensemble, le plan garde ses proportions habituelles.` };
}

/**
 * Vers quoi pencher le plan d'après les repères SAISIS dans le profil (pas les
 * estimations, qui bougent d'une semaine à l'autre) : 'pma', 'seuil' ou null.
 */
export function planBias(profile) {
  const pma = Number(profile?.refs?.pma);
  const ftp = Number(profile?.refs?.ftp);
  if (!(pma > 0) || !(ftp > 0)) return null;
  return bikeProfile({ pma, ftp, est: {} })?.bias ?? null;
}

/**
 * Le bilan « Mon profil » : VO2max estimée dans chaque sport, lequel est en
 * avance, profil du cycliste, chronos probables à pied.
 */
export function athleteProfile(refs) {
  const bike = vo2maxFromPma(refs?.pma, refs?.weightKg);
  const run = vo2maxFromVma(refs?.vma);
  const out = {
    vo2: { bike: bike ? Math.round(bike) : null, run: run ? Math.round(run) : null },
    wkg: refs?.ftp > 0 && refs?.weightKg > 0 ? Math.round((refs.ftp / refs.weightKg) * 10) / 10 : null,
    bike: bikeProfile(refs),
    predictions: racePredictions(refs?.vma),
    lead: null,
  };
  if (bike && run) {
    const gap = (bike - run) / ((bike + run) / 2);
    out.lead = gap > 0.08 ? 'bike' : gap < -0.08 ? 'run' : 'even';
  }
  return out;
}
