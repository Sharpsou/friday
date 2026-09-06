# Maintenir la documentation

Statut documentaire : reference. Révision : 6 septembre 2026.

## Autorité et publics

AGENTS fixe les règles du workspace. Le handoff 00 donne le point de départ ; 27
décrit l'état actuel avec preuves ; 09 porte les décisions produit et 10 les gates.
Runbooks et références détaillent une responsabilité. Les guides expliquent les
usages ; une archive n'impose pas une prochaine action.

Le README dirige vers utilisation, installation et développement/reprise.
L'[index](../README.md) dirige vers chaque famille ; l'[inventaire](inventaire-documentaire.md)
classe exhaustivement les artefacts avec un registre JSON contrôlé automatiquement.

## Quel document modifier

| Changement                            | Documents concernés                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| Geste utilisateur ou état dégradé     | Guide utilisateur et runbook du domaine                                               |
| Responsabilité ou déplacement de code | Carte d'architecture, exemples, liens et tests concernés                              |
| Variable ou commande                  | Configuration, installation, runbook ; vérifier la lecture effective dans le code     |
| Décision produit                      | 09, ADR concernée et limites visibles dans 27                                         |
| Livraison/runtime                     | Rapport daté, 27 ; 00 si le checkpoint change                                         |
| Recette physique                      | Ligne de recette avec appareil/date/résultat ; aucun remplacement par un test desktop |
| Nouveau document ou déplacement       | Inventaires JSON/Markdown et références entrantes                                     |

Ne pas recopier partout les nombres de tests, PID, tailles de bundles ou chemins de
backup. Les preuves datées restent dans leur rapport ; le document 27 y renvoie.
Un commit, un déploiement et une installation téléphone constituent trois faits distincts.

## Classement et archives

Chaque Markdown porte une ligne `Statut documentaire : actif.` ou un statut parmi
`archive`, `recette`, `vision`, `plan`, `reference`, `redirection`.
Le JSON associe chemin final, public, rôle, statut, revue, action, informations propres
au document (`informationUnique`) et liens relevés lors de l'audit (`references`).
Actualiser ces champs quand le périmètre du document change. Les versions d'origine
archivées conservent leur texte et leurs résultats ; ajouter un bandeau d'autorité,
réparer les références et conserver la correspondance de chemin. Les liens vers du
code disparu sont indiqués comme références historiques textuelles, pas comme API actuelle.

Pour un guide Word inchangé, conserver sa date, ses captures et son statut de version.
Après modification, relire le contenu et vérifier le rendu des pages avant livraison.
Les données financières et captures du foyer ne doivent jamais être ajoutées à Git.

## Contrôles

`pnpm docs:check` exécute les tests du vérificateur puis analyse Markdown via MDAST/GFM :
liens/images inline ou par référence, HTML href/src, ancres de titres et ancres HTML,
chemins et casse exacte. Les liens présents dans les blocs de code sont des exemples,
pas des liens navigables. Les chemins opérationnels hors dépôt restent du texte.

Les liens Internet sont hors du contrôle déterministe ; les vérifier séparément quand
ils conditionnent une procédure. Le vérificateur n'effectue aucun appel réseau, ne
lit pas les données privées et ne prouve pas la justesse des affirmations de prose.
L'inventaire couvre Markdown, Word et exemples d'environnement hors sorties générées.
Les images internes sont vérifiées comme destinations ; leur contenu est revu humainement.

Utiliser `pnpm verify` dans l'environnement du runbook ; ne pas lancer le build
de production ou le déploiement pour vérifier un lot uniquement documentaire.
