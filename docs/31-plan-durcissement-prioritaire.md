# Friday — travaux de durcissement à décider

Statut documentaire : plan. Révision : 6 septembre 2026.

Ce document sépare les travaux livrés des sujets encore ouverts. Il ne lance pas
un nouveau lot. Le prochain chantier est choisi avec l'utilisateur depuis
l'[état canonique](27-etat-canonique-app-robot-2026-08-25.md).
Le [plan détaillé du 27 août](archives/etats-techniques/31-plan-durcissement-prioritaire.md)
conserve les investigations, options, critères et identifiants historiques.

## Déjà traité

Les deux lots du 6 septembre ont réparti les gros fichiers, extrait les socles,
ajouté la garde d'architecture, séparé les tests et différé le chargement Budget.
Le complément a traité les cinq exceptions initiales et corrigé les continuations
Robot après annulation. Le [bilan livré](audits/2026-09-06-complement-cinq-modules.md)
précise les compatibilités et limites ; ne pas recommencer son plan de découpage.

## Sujets encore ouverts

| Sujet                                        | État et condition de reprise                                                                                                           |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Sauvegarde portable chiffrée et restauration | Procédure cible, pas de fonction livrée ; exiger restauration contrôlée avant usage réel                                               |
| Budget réel                                  | Porte BitLocker, ACL et sauvegarde à valider ; aucun seed par ce plan                                                                  |
| Conflits généraux et tombstones              | Maison possède sa résolution de bilans ; pas de centre universel ni purge avancée déduite de ce parcours                               |
| Identités/anciens slots                      | Compatibilité historique conservée ; ne pas migrer les profils par nettoyage documentaire                                              |
| Dépendances                                  | Les avis du 27 août sont des observations datées ; refaire un audit ciblé avant tout lot de correction, sans annoncer leur état actuel |
| CI et exploitation                           | La vérification locale est présente ; aucune CI GitHub ajoutée par le lot documentaire                                                 |
| Chat                                         | Gate qualitative refusée, campagne longue arrêtée ; protocole à rediscuter avant nouvelle campagne                                     |
| Téléphones et Robot                          | Recettes réelles et observation d'usage encore distinctes du code et du déploiement                                                    |

Calendar, Tailscale, banque connectée, RAG, domotique et matériel restent derrière
leurs décisions produit. Un résultat de tests ou un ancien ordre de priorité ne
remplace aucune de ces décisions.
