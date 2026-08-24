# ADR-014 — Agent physique mobile Friday à roues

Date initiale : 21 août 2026

Révision : 23 août 2026

Statut : **orientation acceptée, expérimentation post-MVP uniquement**

Document fondateur :
[19-document-fondateur-agent-physique-friday.md](../19-document-fondateur-agent-physique-friday.md)

## Contexte

La première orientation retenait Otto DIY, un œil fixe et un plafond complet de
200 €. Les échanges de conception ont ensuite précisé une ambition différente :
un compagnon autonome capable de navigation domestique fluide, cartographie,
retour borne, perception locale, appel vocal, reconnaissance consentie,
comportements émergents, domotique bornée et petite préhension.

Un bipède abordable à quatre servos ne peut pas remplir de manière fiable cette
promesse. Le budget initial ne permet pas non plus d’intégrer un vrai LiDAR, une
alimentation protégée, une borne et les capteurs redondants nécessaires.

## Décision

- Le noyau de la V1 privilégie trois résultats : évitement fiable, intelligence
  locale utile et continuité du persona entre PWA, voix et corps.
- La V1 physique utilise une base différentielle à roues avec encodeurs.
- La hauteur cible est d’environ 45 cm, avec un maximum absolu de 50 cm ; un
  prototype peut être plus bas, jusqu’à environ 40 cm. La base vise 32 à 35 cm
  et concentre la masse en partie basse, sous réserve du prototype mécanique.
- Chaque roue est asservie séparément par encodeur sur le microcontrôleur, avec
  correction de cap par IMU et calibration des rayons/entraxe. Une roulette
  passive est retenue ; une roulette activement directrice est écartée.
- Mini Pi reste une inspiration ; Otto DIY n’est plus la base matérielle.
- Le noyau vise 500 à 600 € ; l’estimation prudente actuelle est 490 à 650 € et
  le plafond absolu demeure 700 € livré et fonctionnel. Une configuration
  théorique dépassant 700 € est refusée ou privée de ses options non vitales.
- Un LiDAR 2D, une IMU, des capteurs proches, des capteurs de vide et des
  pare-chocs composent la perception vitale.
- Un microcontrôleur indépendant gère moteurs, watchdog, arrêt, vide et limites.
- Le Raspberry Pi gère SLAM, Nav2, évitement, batterie, docking, commandes
  vocales locales, synthèse, persona compact, routines, tools et perception
  utile hors connexion.
- Le PC Friday enrichit voix, identité, VLM/LLM, recherche et mémoire lourde ;
  son absence ne supprime ni le persona ni l’interaction locale.
- Le PC est l’autorité de la mémoire durable, des consentements et de
  l’administration, jamais de l’arrêt ou de l’évitement. Une reconnaissance
  compacte consentie peut être ajoutée au Pi après benchmark ; à défaut, le
  robot reste générique lorsque le PC est absent.
- Un accélérateur IA est préparé comme extension mais reporté au panier initial
  afin de préserver le budget. La pince basse de 50 à 200 g devient elle aussi
  une extension après preuve du noyau.
- Un modèle de navigation transformer/VLA peut fusionner caméra, LiDAR, état et
  intention pour proposer un mode et une trajectoire courte. Il ne produit
  jamais de PWM ou de commande moteur brute ; sa sortie est bornée, expirable,
  validée par schéma puis filtrée par Nav2, le gateway et le microcontrôleur.
- L’architecture de référence est asynchrone : compréhension sémantique lente
  sur PC ou Pi, politique compacte réactive sur le Pi, navigation déterministe
  et boucle vitale plus rapide. AsyncVLA, OmniVLA, ViNT/NoMaD, SmolVLA,
  TransFuser, MM-Nav et NavWAM sont des références à benchmarker, pas des
  dépendances acceptées.
- Une politique apprise commence en simulation puis en mode observateur. Elle
  ne reçoit une influence limitée et réversible qu’après mesures de latence,
  désaccord, obstacles dynamiques, perte de capteur et retour à Nav2.
- Toute action passe par un Physical Agent Gateway et un registre fermé de
  capacités. Aucun LLM ne contrôle directement moteurs, pince, shell, base ou
  domotique.
- Une bibliothèque de tools versionnés est filtrée selon personne, contexte,
  risque, disponibilité et permissions. Le robot peut composer des recettes
  émergentes avec les tools existants, mais ne peut ni installer un tool, ni
  créer une primitive, ni étendre ses droits.
- La liberté comportementale peut être large, mais le noyau de sûreté,
  l’autorité et les limites d’énergie ne sont pas apprenables.
- Un caractère joueur, curieux et espiègle constitue une exigence fonctionnelle :
  le robot peut initier et composer de nouveaux comportements réversibles, avec
  intensité réglable, budget d’attention et veto rétrospectif.
- Une consigne vocale explicitement répétitive peut devenir une préférence,
  routine ou règle structurée après identification suffisante, reformulation et
  confirmation ; une voix inconnue, la télévision ou un contenu externe ne peut
  créer de mémoire persistante.
- La lecture musicale par commande vocale est une capacité fermée : haut-parleur
  embarqué pour la proximité ou enceinte locale autorisée pour la qualité, avec
  source configurée, volume, horaires, durée, arrêt et veto bornés.
- La reconnaissance des habitants et amis exige consentement, suppression et
  état d’incertitude ; elle ne constitue jamais seule une authentification.
- Modèles, adaptateurs et données d’apprentissage portent provenance, licence,
  version et hash ; le code distant implicite et les formats exécutables non
  revus sont refusés. Images, sons, pages, QR codes et sorties de modèles restent
  des entrées hostiles et ne peuvent accorder une capacité.

## Conséquences

- L’agent physique reste post-MVP et facultatif pour toutes les fonctions
  Maison.
- Aucun achat n’est autorisé par cette ADR ; le panier livré doit être revalidé
  avant commande.
- La réalisation est découpée en simulation, base sûre, navigation, présence,
  identité, comportements/domotique, politique neuronale facultative puis pince.
- Les logiciels et firmwares robotiques restent séparés du runtime PWA/hub tant
  que leurs contrats, licences et procédures de mise à jour ne sont pas établis.
- La caméra et les microphones sont visibles, locaux par défaut et sans
  conservation continue.
- L’enfant ou l’aspirateur n’a pas besoin d’être classifié pour provoquer
  ralentissement et arrêt : tout obstacle mobile proche reçoit la même
  protection géométrique. Un mode ménage permet au robot de rejoindre une zone
  refuge et de suspendre ses initiatives.

## Options écartées

### Petit bipède Otto DIY

Très expressif et économique, mais locomotion trop limitée pour une navigation
domestique autonome, le docking et une pince utile.

### Bipède Mini Pi ou équivalent de recherche

Plus proche de l’image initiale, mais coût, contrôle d’équilibre, énergie et
complexité disproportionnés pour la première version.

### Robot à roues sans LiDAR

Moins cher, mais la caméra et les seuls capteurs de proximité ne donnent pas le
niveau de cartographie et de retour borne recherché.

### LLM entièrement embarqué

Possible avec du matériel plus coûteux, mais inutile pour les fonctions vitales
et défavorable au budget. La séparation Pi/PC fournit un meilleur compromis.

### Transformer end-to-end commandant directement les roues

La fusion perception–intention peut améliorer l’anticipation, mais une sortie
neuronale brute est périssable, difficile à borner et sensible au décalage entre
données d’entraînement et maison réelle. Elle reste une proposition de
trajectoire derrière les contrôles déterministes.

## Preuves attendues

La décision sera considérée prête à implanter seulement après :

1. panier complet inférieur ou égal à 700 € ;
2. simulation des contrats et capacités ;
3. revue électrique et mécanique ;
4. preuve d’arrêt indépendante de Linux ;
5. essais répétés de navigation, vide, perte capteur et docking ;
6. mesure locale des erreurs voix/visage ;
7. recette du veto comportemental et des actions domotiques réversibles ;
8. banc de pince avant activation sur la base mobile ;
9. benchmark en observateur et retour automatique à Nav2 avant toute influence
   d’une politique neuronale.

## Retour arrière

Chaque phase peut être arrêtée sans migration des données Maison. Si la
navigation autonome ou le budget échoue, Friday revient à un périphérique fixe
expressif ou à une base téléopérée. Si la pince n’est pas sûre, elle reste
absente tout en conservant la plateforme mobile.

Cette décision ne modifie ni la priorité du MVP PWA, ni la pause Tailscale, ni
les recettes physiques A17/iPhone encore ouvertes.
