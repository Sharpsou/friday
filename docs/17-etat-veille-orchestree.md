# Etat de la Veille orchestree

Date : 18 aout 2026

Statut : **candidat automatise ; recette Galaxy A17 requise**

## Produit

La page `Veille` est une liste de dossiers prives par profil. Le bouton global `+`
ouvre la creation d'une veille dans cette destination. Une veille affiche sa
synthese avant les sujets, concepts et articles justificatifs. Les anciennes vues
`Digest`, `Tous les articles` et `Mes veilles` sont retirees.

Le panneau `Sources et reglages` reprend les controles compacts de Friday. Il
permet de modifier l'heure locale, la recurrence quotidienne ou hebdomadaire et le
jour de la semaine. La prochaine echeance est recalculee sans lancer d'analyse.
Les sources, actions manuelles et suppression sont separees visuellement pour
eviter les erreurs de manipulation sur mobile.

L'ajout depuis une recherche de sources utilise une operation dediee et
idempotente : seuls les candidats valides appartenant a la recherche privee du
profil peuvent etre rattaches. Cette action ne modifie plus les concepts de la
veille et confirme directement dans le panneau combien de sources ont ete
ajoutees.

La creation lance quatre recherches complementaires : sources officielles,
recherche, presse specialisee et presse generaliste. Friday conserve les sites
examines, les flux valides, les refus et leur motif, puis l'utilisateur confirme la
selection. Une veille existante peut relancer cette decouverte depuis ses reglages.

## Orchestrateur

La migration SQLite 17 ajoute decouvertes, candidats, concepts, sujets,
chronologies, liens vers les articles, progression et quota Web. La migration Dexie
7 etend l'outbox chiffree aux etats des concepts.

La migration SQLite 18 rend chaque declenchement explicite et persistant :
initialisation, mise a jour planifiee, rattrapage, action manuelle ou reprise. Une
creation constitue sa reference immediatement, puis respecte strictement son heure
locale. Un redemarrage avant l'echeance ne collecte et n'analyse rien. Si le PC a
manque l'echeance, Friday effectue un seul rattrapage ; un traitement interrompu
reprend le meme run. La reprise de memoire des anciennes veilles est marquee comme
terminee et ne peut plus etre relancee a chaque demarrage.

Le pipeline persistant est : collecte, extraction, rapprochement FTS5, fusion des
sujets et synthese. Qwen extrait un JSON contraint : concepts, entites, faits,
importance, pertinence, nouveaute et titre de theme durable. Un mot-cle isole ne
suffit plus a rendre un article pertinent. Le code choisit les candidats, valide
la sortie et effectue les transactions. Le modele ne dispose d'aucun outil et ne
produit aucun identifiant ou SQL.

Les articles a analyser sont echantillonnes par rotation entre les sources afin
qu'un flux tres prolifique ne monopolise pas les trente places d'un run. Chaque
veille recoit a sa creation entre cinq et huit themes larges et durables. Les runs
suivants classent chaque article dans l'un de ces themes sans pouvoir en creer un
a partir d'un titre d'article ou d'un numero de version. Un article sans theme
compatible est ecarte par precaution. Les concepts secondaires generes sont eux
aussi bornes, entre vingt et trente-deux par veille. Les concepts explicitement
suivis ou masques par l'utilisateur ne sont jamais evinces par ce plafond.

Seuls les flux encore rattaches a la veille peuvent fournir des candidats a
l'analyse. Un flux retire ne vide pas l'historique, mais ses articles en attente ne
sont plus traites. Pour une veille configuree en francais et anglais, un document
domine par une autre ecriture est ecarte avant l'inference ; l'interface force par
ailleurs le retour a la ligne des titres sans espaces.

Un sujet classe chaque nouvel apport en nouveau sujet, evolution importante,
complement, confirmation, contradiction, doublon ou bruit. Les concepts ont trois
etats prives : suivi, secondaire et masque. Une file d'inference commune dans le
moteur empeche Chat et Veille d'utiliser Ollama simultanement.

L'activite de cette file est visible dans toute la PWA sans reveler le contenu
prive : Friday indique si l'IA travaille pour le Chat ou la Veille et combien de
traitements de l'autre usage attendent. Dans la Veille, l'etape et la progression
du run sont rechargees automatiquement. Une sortie article invalide est retentee
une fois puis remplacee par une qualification deterministe bornee ; elle ne fait
plus echouer tout le lot. Une synthese invalide retombe de la meme facon sur les
resumes factuels des articles.

La collecte RSS, le complement Web et l'analyse sont tous attaches a un run
autorise. Le minuteur d'une minute ne fait que constater les echeances ; il ne
telecharge aucun flux en l'absence d'un run. Une erreur revient a la prochaine
heure configuree, sans relance arbitraire une heure plus tard.

## Couverture des sources

RSS/Atom reste prioritaire et mutualise techniquement. La detection essaie aussi
les chemins usuels lorsqu'une page n'annonce pas son flux. Si une veille conserve
moins de six flux, un complement Tavily peut collecter jusqu'a cinq articles de
sites sans RSS, au plus une fois par jour et dans un plafond de 30 credits par mois
et par profil.

## Securite et limites

- URL HTTPS publique, port standard, redirections revalidees et reseaux prives
  bloques ;
- documents Web isoles comme donnees externes hostiles et texte borne ;
- sorties Qwen validees par Zod et jamais interpretees comme HTML, SQL ou URL a
  visiter ;
- quatre recherches de decouverte, vingt sites examines, quinze sources activables,
  trente articles analysables par run, cinq a huit themes memorises, vingt a
  trente-deux concepts secondaires et dix themes par synthese ;
- veilles, concepts, sujets, syntheses, retours et quota Web separes par profil.

## Validation restante

La preuve automatisee du 18 aout 2026 couvre migration, decouverte diversifiee,
motifs de rejet, profil, cache/outbox et parcours Chrome mobile. `pnpm verify`
reussit avec 192 tests unitaires/integration, les builds PWA/hub et 23 scenarios
Chrome mobile. La reception PWA, la lisibilite a 360 px et la pertinence reelle de
la veille IA doivent etre confirmees sur le Galaxy A17 avant de declarer le lot
physiquement valide.
