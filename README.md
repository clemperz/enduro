# Enduro

Carnet d'entraînement pour progresser en endurance, à vélo et en course à pied.
Deux façons de s'en servir, avec les mêmes règles :

- **sur ton Mac**, avec un petit serveur local (relié directement à Zwift) ;
- **en ligne, sur ton téléphone** : <https://clemperz.github.io/enduro/>.
  Tout tourne dans le navigateur du téléphone et y reste : rien n'est envoyé
  ailleurs (sauf à Strava ou Withings si tu les connectes).

## Démarrer

Double-clique sur **`Démarrer Enduro.command`**. Une fenêtre de Terminal s'ouvre
(c'est le petit serveur local) et l'application s'affiche dans ton navigateur à
l'adresse <http://localhost:5180>. Pour arrêter : ferme la fenêtre du Terminal.

En ligne de commande, c'est la même chose :

```bash
npm start
```

Il faut [Node.js](https://nodejs.org) 20 ou plus récent. Aucune autre installation.

## Ce que fait l'application

Trois onglets, comme le sous-titre du manuel qui l'a inspirée :

- **S'entraîner** — la séance du jour (avec son profil en couleurs), ta semaine,
  et le profil de ton plan façon profil d'étape. Chaque matin, Momo la marmotte
  te demande comment tu te sens et allège la séance si besoin.
- **Observer** — ta condition, ta fatigue et ta fraîcheur, ton volume semaine
  par semaine, tes records de puissance.
- **Comprendre** — « Mon plan expliqué » (où va le plan, pourquoi cette semaine
  ressemble à ça, ce qui a été ajusté et pourquoi), puis quinze fiches d'une
  minute qui expliquent ce que le plan applique, avec leurs sources.

Le plan tient compte de ton temps disponible jour par jour, de ton niveau, de ta
répartition vélo / course, de tes objectifs et de ce que tu fais réellement.

## Jusqu'à trois objectifs

Dans Profil → Mes objectifs, tu peux donner jusqu'à trois courses datées :
court, moyen et long terme. Pour chacune, son sport et son importance :

- **Objectif majeur** — le plan est construit à rebours depuis sa date :
  blocs de charge, une semaine d'affûtage avant, une semaine de récupération
  après. Après un premier objectif majeur, la préparation suivante repart plus
  vite (la base est déjà là).
- **Étape** — une course de préparation : elle tombe sur une semaine allégée,
  sans affûtage, pour ne pas casser la progression.

Le sport de l'objectif préparé devient prioritaire (sortie longue, séance clé)
et prend un peu plus de place à l'approche du jour J. Sans objectif, le plan
enchaîne des cycles de 12 semaines.

Tu peux aussi indiquer le **format** de chaque objectif (facultatif) :

- il règle la durée de l'affûtage — la seule semaine de course pour une épreuve
  d'une heure ou moins, deux semaines en tout pour un semi ou une cyclosportive,
  trois pour un marathon ou une très longue distance ;
- en course à pied, la séance clé de la phase spécifique se court à l'allure
  visée (10 km, semi ou marathon), et « Mon plan expliqué » annonce le chrono
  que tu vaux aujourd'hui sur cette distance.

## Se situer

- **Profil → Où je me situe** — VO2max estimée dans chaque sport, watts par
  kilo, chronos probables à pied, et ton profil de cycliste (diesel ou
  puncheur, d'après le rapport FTP / PMA). Quand PMA et FTP sont toutes deux
  saisies, le plan donne un peu plus de place à ce qui te manque (PMA ou
  seuil), sans changer l'ordre des phases.
- **Pouls au réveil** (facultatif, sous « Comment tu te sens ? ») — après
  quelques jours, Enduro connaît ton pouls habituel ; sept battements de plus
  et le feu passe à l'orange.
- **Débuter la course à pied** — au niveau « Débutant », les quatre premières
  semaines limitent chaque footing à 30 minutes et la semaine à trois sorties,
  sans séance dure à pied.

## Le plan s'ajuste tout seul

À chaque changement, Momo relit la semaine en cours et la suivante :

- **tu ajoutes une séance** — le reste s'allège pour garder la charge prévue ;
  si ta séance est dure et colle à une séance clé, celle-ci devient facile ;
- **tu fais une grosse sortie imprévue** — même chose ;
- **tu es fatigué un matin** — la séance dure du jour est reportée ou allégée
  (feu rouge : décrassage ; malade : repos). Corrige ton ressenti et tout
  revient en place ;
- **la fatigue dure** (deux jours sur trois) — la fin de semaine devient une
  semaine allégée, et la suivante repart du niveau de base ;
- **tu rates une séance clé** — elle prend la place d'une séance facile plus
  tard dans la semaine ;
- **une nouvelle semaine commence** — elle est recalculée d'après ce que tu as
  vraiment fait.

Chaque ajustement s'affiche sur l'accueil (« Momo a ajusté ton plan ») avec sa
raison et un bouton « Rétablir comme avant », et reste dans le journal de
l'onglet Comprendre. Momo ne touche jamais aux séances que tu as ajoutées ou
réglées toi-même, et ne rajoute jamais de charge pour « rattraper ».

Tu peux aussi **ajouter une séance de ton choix** (bouton « Ajouter une séance »
sous ta semaine, ou en touchant un jour), cette semaine ou la suivante : à la
place d'une séance prévue ou en plus. Elle est construite au niveau de ta
semaine, s'envoie vers Zwift comme les autres, et reste en place quand la
semaine est recalculée — le reste du plan s'organise autour.

## Zwift

Si Zwift est installé sur ce Mac, tout est automatique et sans mot de passe :

- **Zwift → Enduro** : tes sorties (dossier `Documents/Zwift/Activities`) sont
  lues à chaque ouverture de l'application.
- **Enduro → Zwift** : le bouton « Envoyer vers Zwift » dépose la séance dans
  `Documents/Zwift/Workouts/<ton identifiant>/`. Relance Zwift, puis ouvre
  Entraînements → Entraînements personnalisés : elle s'appelle « Enduro Lun … ».
  Il n'y a jamais plus de 7 séances Enduro dans Zwift (une par jour de la semaine).

Zwift calcule les watts à partir de la FTP réglée dans Zwift : mets la même
valeur dans Profil → Mes repères.

## Strava (facultatif)

Depuis juin 2026, Strava réserve l'accès à son API à ses abonnés. Si tu l'es :

1. Ouvre <https://www.strava.com/settings/api> et crée une application.
2. Dans « Authorization Callback Domain », écris `localhost`.
3. Dans Enduro, onglet Profil → Connexions, colle le Client ID et le Client
   Secret, puis clique sur « Enregistrer et connecter ».

Sans abonnement, deux solutions : valider tes séances avec « C'est fait »
(10 secondes, c'est la méthode du ressenti), ou importer des fichiers `.fit` /
`.gpx` depuis Profil → Importer des fichiers.

## Montre Withings (facultatif)

Si tu portes une montre Withings (ScanWatch…), Enduro lit chaque matin ta nuit :
pouls moyen et VFC (variabilité de la fréquence cardiaque). Tu n'as rien à saisir.

1. Ouvre <https://developer.withings.com/dashboard/>, connecte-toi avec ton
   compte Withings et crée une application « Public API integration ».
2. Dans « Callback URL », colle `http://localhost:5180/api/withings/callback`
   (l'adresse exacte est affichée dans Profil → Connexions).
3. Dans Enduro, onglet Profil → Connexions, carte « Montre Withings », colle le
   Client ID et le Client Secret, puis clique sur « Enregistrer et connecter ».

Si Withings refuse cette adresse, ouvre « Withings refuse cette adresse ? » dans
la carte : écris l'adresse que Withings a acceptée ; après l'autorisation, tu
colleras simplement dans Enduro l'adresse de la page où Withings t'a renvoyé.

La première fois, Enduro récupère deux mois de nuits : ton habitude est connue
tout de suite. Ensuite :

- la VFC se compare à **ton** habitude (4 dernières semaines) et se lit sur
  **7 nuits** : une nuit basse isolée donne juste un mot de Momo ;
- le feu passe à l'orange seulement si la VFC reste sous ta normale **et**
  qu'un autre signe va dans le même sens (tu te sens moyen ou fatigué, pouls
  plus haut que d'habitude) ;
- le pouls moyen de la nuit suit la règle du pouls du matin (7 battements de
  plus que d'habitude : orange) ;
- onglet Observer → « Mes nuits » : ta VFC nuit par nuit et ta normale.

### Sans connexion : l'ECG du matin

Pas besoin de connecter Withings pour suivre ta VFC : l'ECG de 30 secondes de la
montre suffit. Chaque matin, au réveil, assis, avant le café :

1. Fais l'ECG sur la montre (les 30 secondes en entier, sans bouger ni parler).
2. Dans l'appli Withings : ouvre l'ECG dans le fil → « Partager le PDF avec mon
   médecin » → envoie le PDF sur le Mac (AirDrop ou Fichiers).
3. Sur l'écran « S'entraîner », clique sur « importe l'ECG de ta montre » (ou
   glisse le PDF dessus).

Enduro relit le tracé du PDF, retrouve chaque battement, écarte les battements
irréguliers et calcule la VFC (RMSSD) et le pouls. Au bout de 7 matins, il
connaît ta normale et s'en sert pour le feu du matin, comme pour la nuit. Rien
ne sort de l'ordinateur : le PDF est lu dans le navigateur, seul le résultat est
gardé.

## Repères estimés

Tant qu'un repère n'est pas renseigné dans Profil → Mes repères, Enduro
l'estime d'après tes activités des quatre derniers mois et dit d'où vient le
chiffre :

- **FTP et PMA** — un test rampe Zwift est reconnu à sa forme (FTP = 75 % de la
  meilleure minute) ; sinon tes records sur 5 et 20 minutes donnent un minimum.
- **VMA** — chaque course donne un minimum (vitesse ÷ part de VMA tenable sur
  cette durée) ; les meilleurs temps Strava (1 km, 5 km…) et les courses
  marquées « compétition » affinent.
- **FC max** — la plus haute fréquence vue en séance si tu portes un cardio,
  sinon la formule de l'âge (208 − 0,7 × âge).

Une valeur saisie passe toujours avant une estimation.

## Sur ton téléphone (version en ligne)

1. Ouvre <https://clemperz.github.io/enduro/> dans Safari (ou Chrome sur Android).
2. Partager → **Sur l'écran d'accueil** : Enduro s'ouvre alors comme une appli,
   même sans réseau, et le téléphone garde ton carnet.
3. Pour reprendre ton carnet du Mac : sur le Mac, Profil → Mes données →
   « Télécharger une sauvegarde », envoie le fichier sur le téléphone (AirDrop),
   puis dans Enduro sur le téléphone : « Restaure ta sauvegarde » (premier
   écran) ou Profil → Mes données → « Restaurer une sauvegarde ». Le chemin
   inverse marche pareil.

Le carnet du téléphone et celui du Mac sont ensuite indépendants : utilise
l'un ou l'autre, et passe de l'un à l'autre avec une sauvegarde.

Ce qui change sur le téléphone :

- **Zwift** : pas d'accès à ses dossiers. Tes sorties Zwift arrivent par
  Strava (Zwift les y envoie). L'envoi des séances vers Zwift reste sur le Mac.
- **Strava** : connecte-le depuis le téléphone (Profil → Connexions). Dans
  <https://www.strava.com/settings/api>, mets `clemperz.github.io` comme
  « Authorization Callback Domain » (Strava accepte toujours `localhost` en plus).
- **Withings** : la « Callback URL » à déclarer est l'adresse de l'appli,
  affichée dans Profil → Connexions.
- **ECG** : le PDF partagé depuis l'appli Withings s'importe directement sur le
  téléphone, sans passer par le Mac.
- **Tes données** sont dans le stockage du navigateur : télécharge une
  sauvegarde de temps en temps (effacer les données de Safari effacerait le
  carnet).

La version en ligne est republiée automatiquement à chaque envoi sur la branche
`main` du dépôt GitHub (`.github/workflows/pages.yml`, après les tests).

## Depuis ton téléphone, avec le Mac allumé

Autre possibilité, sur le même Wi-Fi que le Mac :

```bash
node server.js --host 0.0.0.0
```

L'adresse à ouvrir sur le téléphone s'affiche dans le Terminal. Ne fais ça que
sur un réseau de confiance : l'application n'a pas de mot de passe.

## Tes données

Tout est dans le dossier `data/` :

- `enduro.json` — profil, plan, activités, ressentis ;
- `secrets.json` — tes identifiants Strava (jamais envoyés au navigateur) ;
- `sauvegardes/` — une copie par jour, sur 14 jours (et une copie avant
  chaque restauration ou effacement).

Profil → Mes données permet de télécharger une sauvegarde, d'en restaurer une
ou de tout effacer.

## Pour les curieux

```
server.js          serveur local (aucune dépendance)
server/            stockage sur disque, Zwift
public/core/       ce que fait chaque demande (profil, activités, Strava, Withings,
                   sauvegardes) : le même code sur le Mac et dans le téléphone
public/js/local.js la version sans serveur : stockage du navigateur
public/engine/     le moteur : zones, charge, séances, plan (plan.js), formats d'objectif
                   (formats.js), prédictions et profil (predict.js), ajustements
                   automatiques (coach.js), explications (explain.js), export Zwift, lecture .fit
public/js/         l'interface
test/              tests automatiques
```

```bash
npm test
```

Astuce pour essayer le plan à une autre date : ajoute `?today=2026-12-01` à
l'adresse.

## D'où viennent les règles

- **Zones d'intensité** : échelle ESIE de Frédéric Grappe (I1 à I7, en % de PMA
  et de FC max) ; en course à pied, mêmes niveaux en % de VMA.
- **Charge d'une séance** : 1 h au seuil = 100 points (Coggan) ; sans capteur,
  ressenti × durée (Foster), calé sur la table d'estimation de Joe Friel.
- **Condition, fatigue, fraîcheur** : modèle de Banister (moyennes sur 42 et 7 jours).
- **Plan** : cycles 3/1, périodisation à rebours depuis les objectifs (affûtage,
  récupération), premier seuil d'abord, puis « pousser » et « tirer » le
  seuil — thèmes développés par la chaîne RM Methodic Cycling ; répartition
  facile / dur d'après Stephen Seiler ; 30/30 d'après Véronique Billat.
- **Records de puissance** : Profil de Puissance Record de Pinot et Grappe.
- **Vérifié et affiné avec** « Science of Cycling » de David Bailey (DK, 2025) :
  intensités des séances en % de FTP, affûtage (moins de volume, même intensité,
  même nombre de séances), rappel d'intensité en semaine de course,
  ravitaillement selon la durée, renforcement musculaire selon la phase.
- **Vérifié et affiné avec** « La Bible du running » de Jérôme Sordello
  (Amphora, 2022) : durée de l'affûtage selon la distance, allures de course
  (10 km, semi, marathon), débuts progressifs à pied, délais de récupération,
  pouls de repos, prédiction des chronos (formule de Riegel).
- **Vérifié et affiné avec** « La Nouvelle Bible de la préparation physique »
  de Didier Reiss et Pascal Prévost (Amphora) : évaluer pour individualiser
  (profil, tests reproductibles), estimation de la VO2max, limitation des chocs
  chez le débutant, force et endurance développées ensemble.

Enduro ne remplace ni un entraîneur ni un médecin.
