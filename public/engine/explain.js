// Le « pourquoi » du plan, en phrases simples.
//
// Rien n'est enregistré ici : tout est déduit du profil, du plan et de la
// semaine au moment de l'affichage, pour que l'explication colle toujours à
// ce qui est réellement prévu.

import { addDays, mondayOf, dayIndex, diffDays, fmtDuration, fmtDate, fmtShort, DAYS } from './dates.js';
import { LEVELS, PHASES, RUN_START, upcomingGoals, weekInfo, normalizeAvail, primarySport } from './plan.js';
import { formatOf, taperWeeksOf } from './formats.js';
import { timeFromVma } from './predict.js';
import { paceStr } from './zones.js';
import { fmtClock } from './estimate.js';

const dayName = (date) => DAYS[dayIndex(date)].name.toLowerCase();
const sportName = (sport) => (sport === 'bike' ? 'vélo' : 'course à pied');
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`);
const isHard = (s) => s.hard >= 2 || s.role === 'key';

/** Ce que chaque phase cherche à faire, et pourquoi elle est là. */
export const PHASE_WHY = {
  intro: 'Une semaine pour prendre le rythme, sans séance dure : on installe la routine avant de charger.',
  fondations: 'On construit la base : beaucoup d’endurance facile, le premier seuil (endurance haute) et un peu de force. C’est ce socle qui permet d’encaisser la suite sans se blesser.',
  developpement: 'On « pousse » le seuil par le bas avec du sweet spot et du seuil : c’est la phase qui fait monter l’allure que tu tiens longtemps.',
  specifique: 'On « tire » le plafond avec la PMA / VMA, en entretenant le seuil. Les séances ressemblent de plus en plus à l’effort de l’objectif, et son sport prend un peu plus de place.',
  affutage: 'Le volume baisse d’environ un tiers, mais ni l’intensité ni le nombre de séances : des séances plus courtes, à la même allure. La fatigue s’en va, la forme reste. C’est là que le travail des semaines précédentes « sort ».',
  objectif: 'Semaine de la course : très peu de volume, un court rappel d’intensité en début de semaine quand la course est assez loin, un déblocage la veille ou l’avant-veille, et le jour J.',
  recup: 'Coupure après l’objectif : très peu de volume, aucune séance dure. On recharge les batteries, physiques et mentales, avant de repartir.',
};

/** Les règles que le plan applique toujours. */
export function planRules(profile) {
  const lvl = LEVELS[profile?.level] ?? LEVELS.intermediaire;
  const growth = Math.round((lvl.growth - 1) * 100);
  return [
    { title: 'À rebours depuis tes objectifs', text: 'Les dates de tes objectifs fixent tout le reste : affûtage juste avant, phase spécifique avant l’affûtage, et ainsi de suite jusqu’à aujourd’hui.' },
    { title: 'Des blocs de 2 ou 3 semaines, puis une semaine allégée', text: 'On ne progresse pas pendant l’effort mais quand on l’assimile. Jamais plus de trois semaines de charge d’affilée, jamais un bloc d’une seule semaine.' },
    { title: 'Un volume qui part de ce que tu fais vraiment', text: `Il monte de 8 % puis 15 % dans un bloc, et la référence n’augmente que de ${growth} % d’un bloc au suivant — seulement si tu as suivi au moins 80 % du précédent. En dessous de 60 %, elle baisse.` },
    { title: 'Beaucoup de facile, un peu de dur', text: `${lvl.label} : ${profile?.level === 'debutant' ? 'une séance dure' : profile?.level === 'confirme' ? 'deux à trois séances dures' : 'deux séances dures'} par semaine au plus, jamais deux jours de suite. Tout le reste est facile : c’est ce qui rend les séances dures vraiment utiles.` },
    { title: 'Chaque séance tient dans ton créneau', text: 'La sortie longue va sur ton plus gros créneau, les séances dures sur des jours où tu as le temps de bien les faire, si possible après un jour facile.' },
    { title: 'Un garde-fou', text: 'Jamais plus d’une fois et demie la charge à laquelle ton corps est habitué, même si ton emploi du temps le permettrait.' },
    { title: 'Des repères remis à jour', text: 'Un test revient en semaine allégée, un bloc sur deux par sport. Quand ta FTP, ta PMA ou ta VMA bougent, toutes les cibles suivent : des zones périmées, c’est s’entraîner trop doucement ou trop fort.' },
    { title: 'Un affûtage qui garde le rythme', text: 'Les deux dernières semaines avant un objectif majeur, le volume baisse nettement, mais on garde l’intensité et le nombre de séances : plus court, pas plus mou.' },
  ];
}

/** Ce que Momo ajuste tout seul, et pourquoi. */
export const AUTO_RULES = [
  { title: 'Tu ajoutes une séance', text: 'Le reste de la semaine s’allège d’autant (d’abord les décrassages, puis l’endurance, puis un peu de sortie longue) pour garder la charge prévue. Si ta séance est dure et colle à une séance clé, celle-ci lui laisse la place.' },
  { title: 'Tu fais une grosse sortie imprévue', text: 'Même logique : pas de séance dure le lendemain, et du volume facile en moins sur les jours qui restent.' },
  { title: 'Tu es fatigué un matin', text: 'La séance dure du jour est reportée à un jour où elle servira (ou devient facile s’il n’y en a pas). Feu rouge : décrassage. Malade : repos. Si tu corriges ton ressenti, tout revient en place.' },
  { title: 'La fatigue dure', text: 'Deux jours fatigué sur trois : la fin de semaine devient une semaine allégée, et la suivante repart du niveau de base au lieu de continuer à monter.' },
  { title: 'Tu rates une séance clé', text: 'Elle prend la place d’une séance facile plus tard dans la semaine, loin des autres séances dures. Le volume manqué, lui, n’est jamais rattrapé.' },
  { title: 'Une nouvelle semaine commence', text: 'Elle est recalculée d’après ce que tu as vraiment fait : une semaine presque blanche et on ne reprend pas la montée en charge comme si de rien n’était.' },
  { title: 'Tu changes un objectif', text: 'Tout le calendrier est reconstruit à rebours depuis les nouvelles dates.' },
];

// ---------------------------------------------------------------------------
// Le plan dans son ensemble
// ---------------------------------------------------------------------------

/**
 * Les étapes du plan à partir de cette semaine : une entrée par phase
 * (semaines consécutives), avec les courses qui s'y trouvent.
 */
export function planStages(profile, plan, today, maxWeeks = 60) {
  const monday = mondayOf(today);
  const goals = upcomingGoals(profile, today);
  const lastGoal = goals.length ? goals[goals.length - 1] : null;
  const count = lastGoal
    ? Math.min(maxWeeks, diffDays(monday, mondayOf(lastGoal.date)) / 7 + 1 + (lastGoal.major ? 1 : 0))
    : 12;
  const stages = [];
  for (let i = 0; i < count; i++) {
    const ws = addDays(monday, 7 * i);
    const info = weekInfo(profile, plan, ws);
    const last = stages[stages.length - 1];
    if (last && last.phase === info.phase) {
      last.weeks += 1;
      last.to = addDays(ws, 6);
    } else {
      stages.push({ phase: info.phase, from: ws, to: addDays(ws, 6), weeks: 1, races: [], light: 0, current: i === 0 });
    }
    const stage = stages[stages.length - 1];
    if (info.isRecovery && !info.etape) stage.light += 1;
    for (const r of info.races ?? []) stage.races.push(r);
  }
  return stages.map((s) => ({ ...s, label: PHASES[s.phase].label, color: PHASES[s.phase].color, why: PHASE_WHY[s.phase] }));
}

/** Tes objectifs à venir, et la façon dont le plan traite chacun. */
/** L'affûtage d'un objectif, en une phrase, selon la durée de l'épreuve. */
function taperText(goal) {
  const n = taperWeeksOf(goal);
  if (n === 0) return 'pas de semaine d’affûtage à part — pour une épreuve courte, la semaine de course suffit (peu de volume, un rappel d’allure)';
  if (n === 2) return 'deux semaines d’affûtage juste avant (épreuve longue : le volume baisse par paliers, on garde du rythme)';
  return 'une semaine d’affûtage juste avant (un tiers de volume en moins, on garde du rythme)';
}

/**
 * @param {object} [refs]  repères résolus (pour annoncer le chrono probable d'un objectif à pied)
 */
export function goalNotes(profile, plan, today, refs = null) {
  const goals = upcomingGoals(profile, today);
  const majors = goals.filter((g) => g.major);
  return goals.map((g) => {
    const when = fmtDate(g.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const left = g.daysLeft === 0 ? 'c’est aujourd’hui' : g.daysLeft < 14 ? `dans ${plural(g.daysLeft, 'jour')}` : `dans ${g.weeksLeft} semaines`;
    const info = weekInfo(profile, plan, mondayOf(g.date));
    let how;
    if (g.major) {
      const prepared = majors.indexOf(g) > 0 ? majors[majors.indexOf(g) - 1] : null;
      if (g.weeksLeft <= 1) {
        how = 'Trop proche pour construire quoi que ce soit : l’idée est d’arriver frais. Peu de volume, un déblocage avant la course.';
      } else if (g.weeksLeft <= 3) {
        how = 'Il reste peu de temps : on entretient ce que tu as, puis une semaine d’affûtage pour arriver frais.';
      } else if (prepared) {
        how = `Après ${prepared.name || 'l’objectif précédent'} : une semaine de récupération, puis une nouvelle préparation plus courte — ta base est déjà là, on repart vite sur le seuil et la PMA / VMA. Ensuite, ${taperText(g)}, et une semaine de récupération après.`;
      } else {
        how = `Le plan est construit à rebours depuis cette date : des blocs de charge qui montent, ${taperText(g)}, une semaine de récupération juste après.`;
      }
    } else if (info.phase === 'affutage') {
      how = 'Course de préparation placée pendant l’affûtage de ton objectif majeur : à courir sans se vider, comme un dernier réglage.';
    } else if (info.phase === 'recup') {
      how = 'Course placée dans la semaine de récupération qui suit ton objectif majeur : à faire pour le plaisir, sans objectif de temps.';
    } else {
      how = 'Étape de préparation : elle tombe sur une semaine allégée, sans affûtage complet, pour ne pas casser la progression vers ton objectif majeur. Une répétition générale : allure, ravitaillement, matériel.';
    }
    // Objectif à pied dont on connaît la distance : le chrono probable et l'allure à travailler.
    const fmt = formatOf(g);
    if (fmt?.km && refs?.vma) {
      const sec = timeFromVma(refs.vma, fmt.km);
      how += ` Aujourd’hui, d’après ta VMA${refs.est?.vma ? ' estimée' : ''}, tu vaux environ ${fmtClock(Math.round(sec / 60) * 60)} sur ${fmt.short} (${paceStr(fmt.km / (sec / 3600))} /km)${g.major && g.weeksLeft > 3 ? ' : c’est l’allure que tu travailleras à l’approche du jour J' : ''}.`;
    }
    return { ...g, when, left, role: g.major ? 'Objectif majeur' : 'Étape de préparation', formatLabel: fmt?.label ?? null, how };
  });
}

// ---------------------------------------------------------------------------
// Une semaine
// ---------------------------------------------------------------------------

const ORDINAL = ['', '1re', '2e', '3e'];

function volumeNote(profile, week) {
  const info = week.info ?? {};
  const b = week.basis ?? null;
  const parts = [];
  if (info.index === -1) {
    parts.push('Le plan a démarré en cours de semaine : seuls les jours restants ont été planifiés, en douceur.');
  } else if (info.races?.length) {
    parts.push(info.phase === 'objectif'
      ? 'Semaine de l’objectif : le volume est minimal, tout ce qui compte est d’arriver frais.'
      : 'Semaine de course : volume réduit pour arriver frais, sans casser le rythme.');
  } else {
    let ref = `Ta référence est de ${fmtDuration(week.refMin)} par semaine`;
    if (b?.from === 'declared') ref += ` : c’est le volume que tu as déclaré au départ`;
    else if (b?.from === 'recent') ref += ` : la moyenne de ce que tu as réellement fait ces quatre dernières semaines`;
    else if (b?.from === 'rebase') ref += ` : le volume que tu as indiqué dans ton profil`;
    else if (b?.growth > 1) ref += ` : +${Math.round((b.growth - 1) * 100)} % par rapport au bloc précédent${b.compliance != null ? `, que tu as suivi à ${Math.round(b.compliance * 100)} %` : ', que tu as bien suivi'}`;
    else if (b?.growth === 1) ref += ` : inchangée, parce que le bloc précédent n’a été suivi qu’à ${Math.round((b.compliance ?? 0) * 100)} %`;
    else if (b?.growth < 1) ref += ` : abaissée de 10 %, parce que le bloc précédent n’a été suivi qu’à ${Math.round((b.compliance ?? 0) * 100)} %`;
    parts.push(`${ref}.`);
    if (week.eased === 'fatigue') parts.push('La semaine dernière a été allégée pour cause de fatigue : on repart du niveau de base du bloc au lieu de continuer à monter.');
    else if (week.eased) parts.push('La semaine dernière a été presque blanche : on repart du niveau de base du bloc au lieu de continuer à monter.');
    else if (info.phase === 'intro') parts.push('Mise en route : 15 % de moins, le temps d’installer la routine.');
    else if (info.phase === 'affutage' && info.taperLen === 2) parts.push(info.toGoal >= 2 ? 'Affûtage long, première semaine : un quart de volume en moins. La baisse se fait par paliers.' : 'Affûtage long, deuxième semaine : 40 % de volume en moins pour faire le plein de fraîcheur.');
    else if (info.phase === 'affutage') parts.push('Affûtage : un tiers de volume en moins pour faire le plein de fraîcheur.');
    else if (info.phase === 'recup') parts.push('Récupération après l’objectif : 60 % de moins.');
    else if (info.lead) parts.push('Semaine de reprise après une course : 15 % de moins avant de recharger.');
    else if (info.isRecovery) parts.push('Semaine allégée : un tiers de volume en moins, pour assimiler le bloc qui se termine.');
    else if (info.cycleWeek === 1) parts.push('Première semaine du bloc : pile la référence.');
    else if (info.cycleWeek === 2) parts.push('Deuxième semaine du bloc : 8 % de plus.');
    else if (info.cycleWeek === 3) parts.push('Troisième semaine du bloc : 15 % de plus, c’est la plus grosse.');
    if (week.capped) parts.push('Garde-fou : le volume a été réduit pour ne pas dépasser une fois et demie la charge à laquelle ton corps est habitué.');
  }
  return parts.join(' ');
}

function whereNote(profile, week, goal) {
  const info = week.info ?? {};
  const phase = PHASES[info.phase] ?? PHASES.fondations;
  let where = `Phase « ${phase.label} »`;
  if (info.etape) where += ', semaine de course de préparation';
  else if (info.lead) where += ', semaine de reprise';
  else if (info.isRecovery) where += ', semaine allégée';
  else if (info.cycleWeek) where += `, ${ORDINAL[info.cycleWeek] ?? `${info.cycleWeek}e`} semaine de charge sur ${info.cycleLen ?? 3}`;
  let text = `${where}. ${PHASE_WHY[info.phase] ?? ''}`;
  if (goal && info.toGoal > 0) {
    text += ` Cap sur ${goal.name ? `« ${goal.name} »` : 'ton objectif'} dans ${plural(info.toGoal, 'semaine')}.`;
  }
  return text.trim();
}

function intensityNote(profile, week) {
  const info = week.info ?? {};
  const lvl = LEVELS[profile.level] ?? LEVELS.intermediaire;
  const live = week.sessions.filter((s) => s.status !== 'skipped' && s.role !== 'race');
  const hard = live.filter(isHard);
  const test = live.find((s) => s.kind === 'test');
  if (week.relief) return 'Plus de séance dure d’ici la fin de la semaine : tu as signalé de la fatigue plusieurs jours de suite.';
  if (info.races?.length) return 'Pas de séance dure cette semaine : la course en tient lieu. Le déblocage, lui, ne fatigue pas : il réveille les jambes.';
  if (!hard.length) {
    if (info.phase === 'intro') return 'Aucune séance dure : c’est une semaine de mise en route.';
    if (info.phase === 'recup') return 'Aucune séance dure : c’est une semaine de récupération.';
    if (profile.level === 'debutant' && info.step === 0) return 'Aucune séance dure pour cette toute première semaine : on commence par du facile.';
    return 'Aucune séance dure cette semaine : le temps disponible ne permet pas d’en placer une sans rogner sur l’endurance.';
  }
  let text = `${plural(hard.length, 'séance')} dure${hard.length > 1 ? 's' : ''} sur ${live.length} (${list(hard.map((s) => `${s.title.toLowerCase()} ${dayName(s.date)}`))})`;
  text += info.phase === 'affutage' ? ' : pendant l’affûtage on garde l’intensité, mais en plus court — moins de répétitions, à la même allure.'
    : info.isRecovery ? ' : une seule, c’est une semaine allégée.'
    : info.lead ? ' : une seule, c’est une semaine de reprise.'
      : hard.length >= ({ debutant: 1, intermediaire: 2, confirme: 2 }[profile.level] ?? 2)
        ? ` : à ton niveau (${lvl.label.toLowerCase()}), c’est le maximum utile. Le reste est facile, pour que ces séances-là soient vraiment faites à fond.`
        : ` : avec ${plural(live.length, 'séance')} dans la semaine, une de plus rognerait trop sur l’endurance. Le reste est facile, pour que cette séance-là soit vraiment faite à fond.`;
  if (test) text += ' Le test est en semaine allégée parce que c’est là que tu es le plus frais : c’est le moment de mesurer tes progrès.';
  return text;
}

function sportNote(profile, week, goal) {
  const split = Number(profile.split ?? 0.5);
  if (split >= 0.999 || split <= 0.001) return null;
  const info = week.info ?? {};
  const live = week.sessions.filter((s) => s.status !== 'skipped');
  const bikes = live.filter((s) => s.sport === 'bike').length;
  const runs = live.filter((s) => s.sport === 'run').length;
  if (!bikes && !runs) return null;
  const mix = bikes && runs ? `${plural(bikes, 'séance')} à vélo, ${runs} en course à pied`
    : bikes ? `Que du vélo cette semaine (${plural(bikes, 'séance')})` : `Que de la course à pied cette semaine (${plural(runs, 'séance')})`;
  if (info.index === -1) return `${mix}.`;
  const main = primarySport(profile, info.focus);
  if (goal && info.focus) {
    const near = info.phase === 'specifique' || info.phase === 'affutage';
    return `${mix}. La priorité va ${main === 'bike' ? 'au vélo' : 'à la course à pied'} (sortie longue, séance clé principale) : c’est le sport de ${goal.name ? `« ${goal.name} »` : 'ton prochain objectif'}.${near ? ' À l’approche de l’objectif, ce sport prend un peu plus de place que d’habitude.' : ''}`;
  }
  return `${mix}, selon la répartition choisie dans ton profil.`;
}

function placeNote(profile, week) {
  if (week.info?.index === -1) return ''; // semaine entamée : rien à dire sur le placement
  const avail = normalizeAvail(profile.avail);
  const live = week.sessions.filter((s) => s.status !== 'skipped' && !s.manual && !s.auto);
  const long = live.find((s) => s.role === 'long');
  const parts = [];
  if (long) {
    const slot = avail[dayIndex(long.date)];
    const biggest = slot >= Math.max(...avail);
    parts.push(`Sortie longue ${dayName(long.date)}${biggest ? ` : c’est ton plus gros créneau (${fmtDuration(slot)})` : ''}.`);
  }
  const keys = live.filter((s) => s.role === 'key' && s.kind !== 'activation');
  if (keys.length) {
    const rested = keys.filter((k) => !week.sessions.some((s) => s.status !== 'skipped' && s.date === addDays(k.date, -1)));
    parts.push(`Séance${keys.length > 1 ? 's' : ''} dure${keys.length > 1 ? 's' : ''} ${list(keys.map((k) => dayName(k.date)))} : ${keys.length > 1 ? 'espacées, ' : ''}loin de la sortie longue${rested.length === keys.length ? ', et après un jour de repos pour avoir des jambes fraîches' : ''}.`);
  }
  const rest = [0, 1, 2, 3, 4, 5, 6].filter((d) => !week.sessions.some((s) => s.status !== 'skipped' && dayIndex(s.date) === d));
  if (rest.length && rest.length <= 4) parts.push(`Repos ${list(rest.map((d) => DAYS[d].name.toLowerCase()))}${rest.some((d) => avail[d] < 25) ? ' (dont tes jours sans créneau)' : ''}.`);
  return parts.join(' ');
}

/**
 * Renforcement hors du vélo conseillé cette semaine : beaucoup en début de
 * préparation, de l'entretien ensuite, plus rien à l'approche de la course.
 */
export function strengthNote(week) {
  const info = week.info ?? {};
  if (week.relief) return 'Pas de renforcement tant que la fatigue est là : la priorité est de récupérer.';
  if (info.races?.length) return 'Pas de renforcement cette semaine : rien qui laisse des courbatures avant une course.';
  if (info.phase === 'recup') return 'Pas de charges cette semaine. Un peu de mobilité et d’étirements doux, si ça te fait du bien.';
  if (info.phase === 'affutage') return 'Une seule séance courte et légère en début de semaine, pour entretenir sans fatiguer — ou rien du tout si tu n’en fais pas d’habitude.';
  if (info.isRecovery) return 'Une séance légère (gainage, mobilité) : c’est une semaine pour assimiler.';
  if (info.phase === 'intro' || info.phase === 'fondations') return 'Deux séances de 20 à 30 min (squat, fente, pont fessier, gainage). C’est maintenant, loin de l’objectif, qu’on construit la force. Évite la veille d’une séance dure.';
  if (info.phase === 'developpement') return 'Une à deux séances de 20 à 30 min : on entretient la force pendant que le vélo se durcit. Évite la veille d’une séance dure.';
  return 'Une séance d’entretien de 20 min suffit : la priorité va aux séances dures.';
}

/**
 * Pourquoi cette semaine ressemble à ça : [{ title, text }].
 * `journal` : ajustements du plan (pour rappeler ceux de la semaine).
 */
export function explainWeek(profile, plan, week, today) {
  if (!week) return [];
  const info = week.info ?? {};
  const goal = info.goalId ? upcomingGoals(profile, week.weekStart).find((g) => g.id === info.goalId) ?? null : null;
  const out = [
    { title: 'Où on en est', text: whereNote(profile, week, goal) },
    { title: `Le volume : ${fmtDuration(week.targetMin)}`, text: volumeNote(profile, week) },
    { title: 'L’intensité', text: intensityNote(profile, week) },
  ];
  const sport = sportNote(profile, week, goal);
  if (sport) out.push({ title: 'Les sports', text: sport });
  if (week.gentleRun) {
    out.push({ title: 'La course à pied en douceur', text: `Tes ${RUN_START.weeks} premières semaines : des footings de ${RUN_START.sessionMin} minutes au plus, ${RUN_START.perWeek} par semaine au maximum et pas de séance dure à pied. Le cœur progresse vite, les tendons et les articulations beaucoup moins : on leur laisse le temps. Le vélo complète, sans les chocs.` });
  }
  const place = placeNote(profile, week);
  if (place) out.push({ title: 'Les jours', text: place });
  out.push({ title: 'Hors du vélo', text: strengthNote(week) });
  const mine = week.sessions.filter((s) => s.manual && s.status !== 'skipped');
  if (mine.length) {
    out.push({
      title: 'Tes séances ajoutées',
      text: `${list(mine.map((s) => `« ${s.title} » ${dayName(s.date)}`))} : Momo n’y touche pas, et organise le reste autour.`,
    });
  }
  const changes = (plan?.journal ?? []).filter((e) => e.weekStart === week.weekStart && !e.undone && e.rule !== 'profil');
  if (changes.length) {
    out.push({ title: 'Ce qui a été ajusté', text: `${changes.map((e) => e.title).join(' · ')}. Le détail est dans le journal.` });
  }
  return out.filter((x) => x.text);
}

// ---------------------------------------------------------------------------
// Une séance
// ---------------------------------------------------------------------------

/** Pourquoi cette séance, ce jour-là. */
export function explainSession(profile, week, s) {
  const info = week?.info ?? {};
  const avail = normalizeAvail(profile.avail);
  if (s.auto) {
    const what = s.auto.what === 'déplacée' && s.auto.prev ? `déplacée (prévue ${dayName(s.auto.prev.date)})` : `${s.auto.what} — à l’origine : ${s.auto.from}`;
    return `Séance ajustée par Momo : ${what}.`;
  }
  if (s.manual) return 'Séance que tu as ajoutée toi-même. Momo n’y touche pas : le reste de la semaine s’organise autour.';
  if (s.role === 'race') {
    return s.major === false
      ? 'Course de préparation : une répétition générale sur une semaine allégée, sans affûtage complet.'
      : 'Ton objectif. Tout le plan a été construit à rebours depuis ce jour.';
  }
  if (s.kind === 'activation') return 'Placé la veille ou l’avant-veille de la course : quelques accélérations pour réveiller les jambes sans les fatiguer.';
  if (s.kind === 'test') return 'Placé en semaine allégée, quand tu es frais : c’est le bon moment pour mesurer tes progrès et recaler tes zones.';
  const prevDay = week?.sessions.some((x) => x.status !== 'skipped' && x.date === addDays(s.date, -1));
  if (s.role === 'long') {
    const slot = avail[dayIndex(s.date)];
    const biggest = slot >= Math.max(...avail);
    return `La plus longue de la semaine, placée ${dayName(s.date)}${biggest ? ` parce que c’est ton plus gros créneau (${fmtDuration(slot)})` : ''}. C’est elle qui construit l’endurance de fond${s.detail === 'fin en tempo' ? ' ; elle finit en tempo pour apprendre à appuyer sur des jambes fatiguées' : ''}.`;
  }
  if (s.role === 'key') {
    const phase = PHASES[info.phase]?.label ?? 'en cours';
    return `Séance clé de la phase « ${phase} » : c’est elle qui fait progresser cette semaine. Placée ${dayName(s.date)}, ${prevDay ? 'à distance des autres séances dures' : 'après un jour de repos pour avoir des jambes fraîches, et à distance des autres séances dures'}.`;
  }
  if (s.role === 'recup') return 'Lendemain de grosse séance : un décrassage aide à récupérer sans ajouter de fatigue. Facultatif — c’est la première séance retirée si la semaine se charge.';
  return `Séance facile : elle apporte du volume sans fatigue, et c’est ce volume qui construit l’endurance${s.detail?.includes('sprints') || s.detail?.includes('lignes droites') ? '. Les quelques accélérations entretiennent la vélocité sans rien coûter' : ''}.`;
}

/** Résumé d'une étape du plan pour l'affichage : « du 16 nov. au 13 déc. · 4 semaines ». */
export function stageSpan(stage) {
  return `du ${fmtShort(stage.from)} au ${fmtShort(stage.to)} · ${plural(stage.weeks, 'semaine')}`;
}
