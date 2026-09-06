# Friday — décisions produit actives

Statut documentaire : actif. Consolidation : 6 septembre 2026.

Cette référence conserve les décisions encore actives du MVP PWA et l'extension
Maison autorisée. Les promesses remplacées et estimations initiales sont dans
l'[archive des décisions](archives/etats-techniques/09-decision-finale-pwa-mvp.md).
L'[état 27](27-etat-canonique-app-robot-2026-08-25.md) décrit les livraisons ; le
[document 10](10-feuille-de-route-technique-implementation.md) régit l'exécution.

## Produit et navigation

Friday est une PWA familiale auto-hébergée, installable sur PC, Android et iPhone.
Le Hub cible Windows ; aucune application Flutter ni aucun build Apple n'est prévu.
Le foyer comporte deux adultes. Agenda, Maison et Budget sont partagés ; Chat,
Veille et brouillons IA sont privés par profil.

Sept destinations : Aujourd'hui, Agenda, Maison, Budget, Chat, Veille, Robot.
Maison remplace Courses dans la navigation et ouvre Courses par défaut ; Menus et
Réserve complètent cet espace. Les rappels applicatifs ne constituent pas une
garantie de notification système lorsque Friday et le Hub sont indisponibles.

## Usages et simplicité

- Tâches : titre requis ; date, heure, responsable, note et récurrence facultatifs.
- Courses : libellé, quantité libre et état acheté ; classement par rayon et photo
  facultatifs, avec aperçu et confirmation. La liste reste utilisable sans IA.
- Maison : catalogue versionné, préparations distinctes des repas midi/soir,
  portions et restes, réserve souple, seuils et bilans explicites d'achats/préparation.
  Les menus s'affichent dans Agenda sans créer des tâches. La recette couvre les deux téléphones.
- Budget : distinguer réel, prévisionnel, enveloppes, provisions et épargne réellement
  versée. Calculs déterministes en centimes ; une attribution ne rend pas une dépense privée.
- Chat : trois modes visibles Friday, Local et Recherche Web ; historique privé et
  archive séparée. L'activation autorisée ne signifie pas que la qualité est validée.
- Veille : dossiers, sources et fréquence par profil, collecte et synthèses sourcées.
- Robot : prototype expérimental décrit par la décision 30 et le runbook, avec consentement visible.

Le [guide utilisateur](guides/utilisation-friday.md) décrit les gestes et états dégradés.

## Architecture et modèle offline

SQLite sur le PC est canonique. Les appareils conservent une copie Dexie/IndexedDB
chiffrée et une outbox. Les écritures métier suivent la même voie en ligne et offline :
validation, transaction locale, synchronisation idempotente, traitement explicite des conflits.
Un succès local n'est jamais annoncé avant écriture effective.

Le Hub et la PWA utilisent une origine HTTPS stable sur le LAN. Ollama reste sur
localhost et ne bloque jamais Maison, Budget ou sync. Le Chat ne possède aucune
mutation métier ni commande d'actionneur. Les propositions Menus deviennent partagées
uniquement après correction et enregistrement explicites.

La lecture offline dépend d'une première installation/synchronisation réussie et des
données effectivement en cache. Chat, IA, collecte Web et Robot ne deviennent pas des
actions offline parce que la PWA elle-même peut s'ouvrir sans réseau.

## Intégrations et décisions différées

Google Calendar n'est pas implanté ; le calendrier Maison Google décrit dans le MVP
initial n'est pas la source de l'Agenda actuel. Toute intégration doit être discutée
avant réalisation. Drive sert seulement à de futures sauvegardes chiffrées, jamais
au runtime ni à la synchronisation. La restauration portable reste à implanter.

Tailscale reste en pause ; aucune publication Internet du Hub, redirection NAT ou
Funnel n'est autorisée par cette documentation. Pas de banque connectée, RAG, domotique
ou changement de matériel sans reprise produit explicite.

La cible future Robot reste régie par l'[ADR-014](adr/014-agent-physique-otto-diy-oeil-friday.md),
avec plafond livré 700 €. Elle ne doit pas être attribuée à l'AlphaBot2 réel.
Pas de surveillance secrète, reconnaissance faciale ou mémoire durable des personnes.

## Validation produit

Conserver les preuves réelles A17/iPhone existantes à leurs dates. Les nouvelles
capacités Maison et les recettes Robot demandent leurs propres observations ; aucun
test desktop ne les remplace. Les périodes de 7/14 jours sont de l'observation.
Le prochain lot App est choisi par l'utilisateur, sans reprendre automatiquement une
ancienne roadmap. La licence du dépôt reste une décision différée du propriétaire.
