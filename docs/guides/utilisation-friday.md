# Utiliser Friday au quotidien

Statut documentaire : actif. Révision : 6 septembre 2026.

Friday réunit deux adultes dans un foyer. Agenda, Maison et Budget sont partagés ;
Chat, Veille et brouillons IA restent privés. Ce guide décrit les gestes disponibles,
sans présumer que toutes les nouvelles fonctions ont été recettées sur vos téléphones.
Pour les preuves, consulter l'[état courant](../27-etat-canonique-app-robot-2026-08-25.md).

## Première ouverture et appareils

Sur une installation neuve, le premier adulte initialise le foyer avec son nom,
identifiant Friday, phrase secrète et nom d'appareil. L'accès public est ensuite fermé.
Depuis les réglages « Foyer et appareils », le propriétaire génère un code temporaire
pour le second adulte. Celui-ci choisit « J'ai un code » et renseigne ses propres
identifiants. Le code est à usage unique et expire ; ne le publier dans aucun rapport.

Un appareil déjà lié peut utiliser son cache hors connexion. L'identité du profil
ne se change pas offline. La révocation bloque les futures synchronisations, mais
n'efface pas à distance un cache déjà téléchargé. Une déconnexion explicite efface
la copie locale selon le parcours de l'application ; synchroniser les opérations
en attente avant une déconnexion volontaire ou un changement d'origine.

Le [guide Windows](installation-windows.md) explique certificat, LAN et installation
PWA. Android et iPhone utilisent la même application, sans magasin d'applications.

## Comprendre la connexion

« Enregistré sur ce téléphone » et « partagé avec le foyer » sont deux étapes.
Une écriture locale confirmée entre dans l'outbox ; le Hub l'acquitte puis les autres
appareils la reçoivent. Le compteur d'attente et la dernière synchronisation permettent
de suivre cette progression. Internet disponible ne signifie pas que le PC familial
est joignable : la 5G seule ne donne actuellement aucun accès au Hub LAN.

Une panne réseau n'exige pas de réappairer, vider le stockage ou refaire les saisies.
Revenir sur le Wi-Fi du foyer, vérifier le Hub et attendre la synchronisation.
Ne pas effacer les données du site pour débloquer un conflit ou une mise à jour.
Si le stockage local échoue, l'application ne doit pas confirmer une écriture fictive.

## Aujourd'hui et Agenda

Aujourd'hui rassemble les tâches utiles, les menus, l'état des courses, les signaux
Budget et la Veille. Agenda propose liste, semaine et mois. Une tâche peut commencer
par un titre ; date, heure, responsable, récurrence et note complètent au besoin.
Terminer, rouvrir, modifier et supprimer utilisent les mêmes écritures locales offline.

Les récurrences créent des occurrences identifiées, sans doublon à la reconnexion.
Lire le choix proposé lors de la modification ou suppression d'une série : une
occurrence et les échéances futures ne sont pas la même opération.
Les menus peuvent être affichés/masqués dans Agenda et restent des repas, pas des tâches.
Google Calendar n'est pas synchronisé ; aucun rendez-vous Google n'est attendu ici.

## Maison — Courses

Maison ouvre Courses par défaut. Ajouter un libellé et une quantité facultative,
cocher un achat, rouvrir une ligne, corriger ou supprimer fonctionne avec le cache.
Deux articles ressemblants ne fusionnent pas automatiquement.
« En course » fournit le mode magasin et utilise les mêmes opérations offline.

« Classer par rayon » prépare un aperçu sur le Hub. Corriger les propositions puis
appliquer, ou conserver le classement actuel. Les corrections sont partagées et
réutilisées pour les libellés correspondants. Lancer, arrêter et appliquer le classement
exige le Hub ; la liste organisée déjà synchronisée reste disponible offline.

L'import photo transcrit une liste manuscrite en propositions à corriger. Il nécessite
le Hub et le modèle de vision ; ce n'est pas un OCR de tickets Budget ni une saisie
automatique de dépense. Le prix payé n'est pas déduit des courses.
Le [runbook classement](../runbooks/classement-courses.md) détaille arrêt et incidents.

## Maison — Menus, recettes et portions

Menus distingue Planning et Recettes. Créer une recette par son nom est possible ;
les ingrédients manquants restent visibles. Chaque modification produit une version.
Une préparation conserve sa version et n'adopte une autre version qu'explicitement.

Une **préparation** produit des portions ; un **repas** midi/soir en utilise.
Pour cuisiner une fois et manger deux jours, associer les repas à la même préparation.
Les repas extérieurs ou annulés ne demandent pas d'ingrédients. La période de planning
est bornée à 31 jours. Les propositions et copies de planning préservent les créneaux occupés.

Les propositions IA sont privées et peuvent être locales ou Web. Relire ingrédients,
quantités, étapes et sources avant d'enregistrer une recette partagée. Une quantité
inconnue reste inconnue ; une source ou un audit ne garantit pas la qualité culinaire.
Le Chat ne peut pas enregistrer le plat à votre place. L'IA peut attendre le créneau
commun aux autres usages ; l'indicateur ne révèle pas le texte privé d'un autre profil.

## Maison — Réserve et bilans

La Réserve Maison représente aliments, produits et restes. Elle est différente de
la réserve **financière** du Budget. Renseigner les entrées utiles seulement :
emplacement, quantité ou état, seuil, date limite facultative, dernière confirmation.
Aucune durée de conservation n'est inventée et le passage du temps ne consomme aucun stock.

1. **Préparer / actualiser les courses** : revoir les ingrédients non quantifiés,
   réserves affectées, lignes existantes, exclusions et réductions avant confirmation.
   Une course libre peut être reliée explicitement au besoin calculé.
2. **Acheter** : cocher dans Courses ; cette coche seule n'ajoute pas de stock.
3. **Ranger les achats** : confirmer quantité reçue et emplacement, ou ignorer l'article.
4. **Préparé** : confirmer les ingrédients utilisés, le rendement réel, le repas éventuellement
   mangé immédiatement et l'emplacement des restes.
5. **Mangé** : consommer les portions restantes ; dans Réserve, utiliser « Mangé / jeté / corriger »
   pour ajuster ce qui s'est réellement passé.

Après une préparation partielle ou une perte, ajuster d'abord les repas qui ne peuvent
plus être servis. L'application conserve la saisie et refuse un bilan incohérent.
Les quantités compatibles se convertissent entre masse ou entre volume ; les autres
correspondances doivent être renseignées par produit, jamais devinées.

Un seuil consolide les lots du produit ; un vieux lot vide ne masque pas un lot reçu.
Une suggestion de réachat doit être confirmée. Les reçus et mouvements conservent
leur trace ; une correction produit un nouveau mouvement.

## Conflits et plusieurs appareils

Une modification concurrente n'autorise pas l'écrasement silencieux des données.
Dans un conflit Maison, ouvrir le bilan puis « Comparer avec le foyer ».
« Reprendre la version du foyer » écarte explicitement les bilans conflictuels liés
aux mêmes objets. Des écritures encore en attente peuvent empêcher cette résolution.
Ressaisir ensuite les quantités voulues depuis la version canonique affichée.

Le bilan et les opérations restent chiffrés ; ne pas vider l'outbox. Pour les domaines
sans centre de résolution complet, conserver les deux versions et demander un diagnostic
au propriétaire. Le futur centre général de conflits et la purge avancée ne sont pas
déduits du parcours spécifique Maison.

## Budget

Le [guide Budget](budget-friday.md) explique les mouvements, enveloppes, provisions,
projection et réserve financière. Le Budget est visible par les deux adultes même
lorsqu'une dépense est attribuée à l'un d'eux. Les calculs fonctionnent sans IA.
L'utilisation de données réelles exige la [porte de protection](../runbooks/reprise-budget.md).

## Chat

Créer une conversation avec le bouton + ; son menu permet de renommer ou supprimer.
Friday choisit le traitement, Local force une réponse locale et Recherche Web demande
des sources. Local exige toujours Hub et Ollama : « local » ne veut pas dire « généré
sur le téléphone offline ». Le suivi affiche les étapes et permet l'annulation.

Une relance reste dans sa conversation. Friday peut réutiliser les passages et liens
déjà lus, ou compléter la recherche ; une ancienne réponse n'est jamais une preuve.
Des sources anciennes ne prouvent pas une mise à jour récente. Une réponse partielle
ou non vérifiée doit se lire avec ses limites. La gate qualitative reste refusée.

Après une réponse réseau perdue, conserver l'envoi incertain et laisser l'application
retrouver son run. L'historique déjà chiffré peut rester lisible sans Hub, mais aucun
message offline n'est automatiquement envoyé plus tard. L'archive Assistant historique
reste une section distincte en lecture seule.

## Veille

Créer un dossier avec ses thèmes et sources, vérifier l'aperçu puis choisir la cadence.
Le premier passage établit une référence ; l'absence de nouveauté initiale est normale.
Les collectes RSS/Atom sont prioritaires ; une découverte Web complémentaire est bornée.
Sources, articles, concepts suivis et synthèses appartiennent au profil courant.

Lire provenance et date avant de suivre un sujet. Les éléments déjà synchronisés
restent lisibles offline. Une collecte réussie peut attendre l'analyse Ollama.
Une échéance manquée est rattrapée une fois ; le redémarrage ne doit pas multiplier
les collectes. Voir le [diagnostic Veille](../runbooks/veille-rss.md).

## Robot et mises à jour

Le Robot est expérimental. Aucune commande physique n'est mise en attente offline.
Observer d'abord roues OFF ; tout essai exige utilisateur présent, zone sûre et arrêt
accessible. Manuel, Autonome, Repères, Va là, Récup et manette sont décrits dans le
[runbook Robot](../runbooks/robot-alphabot2.md). Le réveil réseau revient en Manuel,
roues et servos désactivés ; son cycle physique reste à recetter.

Quand Friday propose « Mettre à jour », vérifier l'état de synchronisation puis
suivre la proposition sans effacer le stockage. Une mise à jour serveur disponible
ne signifie pas que tous les téléphones l'ont déjà acceptée. En cas d'incident,
noter écran, heure, appareil, version et attente, sans publier de secret ni donnée privée.
