// Deux outils pour la course à pied : ramener une course vallonnée à son
// équivalent sur le plat, et savoir quelle part de sa VMA on peut tenir
// pendant une durée donnée.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Distance équivalente sur le plat. Sur un parcours roulant, montées et
 * descentes se compensent presque (coût énergétique de Minetti, 2002) ; plus
 * c'est raide, plus le dénivelé coûte, jusqu'à la règle des traileurs
 * « 100 m de D+ = 1 km » en montagne.
 */
export function flatEquivalentKm(km, elevationM = 0) {
  const d = Number(km) || 0;
  const up = Math.max(0, Number(elevationM) || 0);
  if (d <= 0) return 0;
  const perKm = up / d; // mètres de dénivelé par kilomètre
  const metersPerMeter = clamp(1 + perKm / 7, 2, 10);
  return d + (up * metersPerMeter) / 1000;
}

/**
 * Part de la VMA tenable pendant `minutes` d'effort maximal : 100 % sur
 * 6 minutes, puis une baisse régulière avec le logarithme de la durée
 * (modèle d'endurance de Péronnet et Thibault). Environ 92 % sur 20 min,
 * 85 % sur 1 h, 75 % sur 4 h pour un coureur moyen.
 */
export function enduranceFraction(minutes) {
  return clamp(1 - 0.068 * Math.log(Math.max(0.5, minutes) / 6), 0.6, 1.12);
}
