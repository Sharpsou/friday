# Runbook — sauvegarde et restauration Friday

Date : 9 août 2026

Statut : procédure cible documentée ; commandes et interface non encore implantées

Ce runbook accompagne l'[ADR-008](../adr/008-sauvegarde-portable-chiffree.md).
Le découpage d'implémentation, les tests négatifs et les gates de livraison sont
préparés dans le
[plan de durcissement prioritaire](../31-plan-durcissement-prioritaire.md#5-chantier-p0-b--sauvegarde-chiffrée-et-restauration-prouvée).
Il ne doit pas être interprété comme une fonction déjà disponible.

## But

Produire un fichier chiffré partageable, prouver qu'il est restaurable et permettre à terme son import depuis `Réglages > Sauvegarde`.

## Règles absolues

- ne jamais envoyer `D:\FridayData\friday.sqlite`, son fichier WAL ou `friday.sqlite.auth-secret` ;
- ne jamais partager la clé privée de récupération dans la même conversation que le backup ;
- ne jamais restaurer tant qu'un appareil actif affiche des opérations en attente ;
- ne jamais remplacer la base avant validation complète de la candidate et création d'un retour arrière ;
- ne jamais considérer la présence d'un fichier comme une preuve de sauvegarde : une restauration sur hub vide doit réussir.

## Emplacements cibles

```text
D:\FridayData\friday.sqlite
D:\FridayData\friday.sqlite.auth-secret
D:\FridayData\secrets\backup-age-identity.txt
D:\FridayData\secrets\backup-age-recipient.txt
D:\FridayData\backups\
D:\FridayData\backup-staging\
D:\FridayData\restore-staging\
```

Les répertoires de staging restent sur le même volume protégé que la base. Ils sont nettoyés après réussite ou erreur. La clé de récupération possède au moins une copie hors de `D:\FridayData`.

## Export cible

1. vérifier le propriétaire authentifié et l'espace disque ;
2. créer un snapshot par l'API SQLite de sauvegarde en ligne ;
3. contrôler intégrité et clés étrangères ;
4. créer le manifeste et les empreintes ;
5. empaqueter le snapshot et le secret d'authentification ;
6. chiffrer vers le destinataire `age` du foyer ;
7. supprimer le clair ;
8. conserver une copie locale horodatée et remettre le fichier au navigateur ;
9. proposer la feuille de partage seulement si `navigator.canShare()` accepte réellement le fichier, sinon télécharger.

## Contrôle périodique recommandé

- sauvegarde automatique quotidienne locale : sept versions ;
- sauvegarde hebdomadaire : quatre versions ;
- sauvegarde manuelle portable avant une migration ou une évolution importante ;
- test de restauration sur répertoire vide après la première implantation puis au moins après toute modification du format.

Cette rotation est une cible du Lot 3, pas une fonction actuellement active.

## Import cible

1. sélectionner le fichier chiffré ;
2. déchiffrer et extraire uniquement dans `restore-staging` ;
3. vérifier manifeste, empreintes, tailles, liste de fichiers et version ;
4. exécuter les contrôles SQLite sur une connexion isolée ;
5. afficher l'aperçu sans modifier la base ;
6. confirmer attente à zéro sur les appareils et ressaisir la phrase secrète propriétaire ;
7. créer le backup chiffré de retour arrière ;
8. passer le hub en maintenance, remplacer puis redémarrer ;
9. vérifier healthcheck, authentification et nombres d'objets ;
10. laisser chaque mobile détecter la nouvelle génération et refaire un pull complet.

## Critères de réussite

- healthcheck `database: ok` ;
- propriétaire capable d'ouvrir Friday ;
- nombres du manifeste retrouvés ;
- aucun ancien fichier de staging en clair ;
- téléphones resynchronisés avec zéro attente ;
- sauvegarde de retour arrière encore présente jusqu'à validation humaine.

## Incident

Si le hub ne redémarre pas ou si les contrôles échouent :

1. ne pas ouvrir Friday sur les téléphones afin d'éviter de nouvelles écritures ;
2. arrêter le hub ;
3. remettre le backup de retour arrière par le futur script hors ligne ;
4. redémarrer et vérifier le healthcheck ;
5. conserver l'archive fautive et les journaux non sensibles pour diagnostic, sans publier de secret.
