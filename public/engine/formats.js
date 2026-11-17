// Le format d'un objectif : sa durée d'effort change la longueur de l'affûtage
// et, en course à pied, l'allure à travailler en phase spécifique.
//
// Plus l'épreuve est longue, plus l'affûtage est long : une semaine en tout
// pour un effort d'une heure ou moins, deux pour un semi ou une cyclosportive,
// trois pour un marathon ou une très longue sortie. `taperWeeks` compte les
// semaines d'affûtage AVANT la semaine de course (qui en fait toujours partie).

export const FORMATS = {
  run: [
    { id: 'court', label: '10 km ou moins', short: '10 km', km: 10, taperWeeks: 0, pace: 'allure10' },
    { id: 'semi', label: 'Semi-marathon', short: 'semi', km: 21.0975, taperWeeks: 1, pace: 'allure21' },
    { id: 'marathon', label: 'Marathon ou plus', short: 'marathon', km: 42.195, taperWeeks: 2, pace: 'allure42' },
  ],
  bike: [
    { id: 'court', label: 'Moins de 1 h 30', short: 'course courte', taperWeeks: 0 },
    { id: 'cyclo', label: 'De 1 h 30 à 5 h', short: 'cyclosportive', taperWeeks: 1 },
    { id: 'long', label: 'Plus de 5 h', short: 'longue distance', taperWeeks: 2 },
  ],
};

/** Format d'un objectif, ou null s'il n'est pas précisé (ou ne correspond pas au sport). */
export function formatOf(goal) {
  return FORMATS[goal?.sport]?.find((f) => f.id === goal?.format) ?? null;
}

/** Semaines d'affûtage avant la semaine de course : 1 quand le format n'est pas précisé. */
export function taperWeeksOf(goal) {
  return formatOf(goal)?.taperWeeks ?? 1;
}
