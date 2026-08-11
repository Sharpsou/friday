# Prochaines étapes après le candidat Assistant

Date : 10 août 2026

Statut : **plan actif**

## Point de départ

Le candidat couvre Agenda, Courses, Budget et Chat avec cache local chiffré, authentification fermée et synchronisation offline-first. Le Chat utilise Gemma 4 localement et peut orchestrer une recherche Tavily selon le mode choisi. Les preuves physiques restent distinctes des preuves automatisées.

Le périmètre exact du Chat, ses incidents corrigés et ses limites de recette sont consolidés dans [15-checkpoint-chat-tavily.md](15-checkpoint-chat-tavily.md).

## Ordre de travail

1. Rejouer sur le Galaxy A17 les recettes d’authentification, courses, classement, `En course`, budget et Chat local, sans bloquer les autres travaux automatisés.
2. Lorsque l’iPhone est disponible, confirmer le certificat, l’appairage, le redémarrage hors ligne et la convergence à deux appareils.
3. Valider BitLocker, restreindre les ACL de `D:\FridayData` et prouver la sauvegarde/restauration avant toute donnée financière réelle.
4. Conserver conflits et tombstones en observation conformément à l’ADR-011 ; ne rien implanter sans signal d’usage réel.
5. Maintenir l’[accès extérieur Tailscale `/32`](adr/013-acces-exterieur-tailscale-route-privee.md) en pause. À sa reprise, commencer par un spike réseau sans modification de code, puis ajouter l’enrôlement local uniquement.
6. Discuter avec l’utilisateur avant le prochain lot fonctionnel ; Google Calendar Maison en lecture et cache offline reste l’option naturelle.

## Checkpoint Chat

Sur l’A17 puis l’iPhone :

- créer une conversation en ligne ;
- envoyer un message hors ligne, fermer et rouvrir la PWA, puis vérifier sa conservation ;
- rétablir le hub et vérifier l’envoi sans doublon ;
- confirmer les modes `Local`, `Web léger` et `Web approfondi`, l’annulation et la reprise ;
- confirmer que le Web n’est pas appelé pour un message non factuel, puis contrôler les sources et crédits d’une question actuelle ;
- forcer la réflexion pour un message, vérifier son étiquette et la remise à zéro de l’option ;
- confirmer qu’une panne Ollama ne bloque aucune fonction Maison.

Ne pas déclarer la qualité, la latence ou la compatibilité mobile sans retour physique correspondant.

## Discipline d’exécution

Après toute évolution du runtime : tests ciblés, `pnpm verify`, sauvegarde si migration, redémarrage sans navigateur, healthcheck, documentation de la preuve, commit puis push.
