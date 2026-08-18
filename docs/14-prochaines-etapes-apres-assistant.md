# Prochaines étapes après le candidat Assistant

Date : 18 août 2026

Statut : **plan actif**

## Point de départ

Le candidat couvre Agenda, Courses, Budget, Chat et la Veille orchestrée avec cache local chiffré, authentification fermée et synchronisation offline-first. Le Chat utilise Qwen 3.5 9B Q4 par défaut ou Gemma 4 en remplacement local ; `Web léger` passe par Tavily et `Web approfondi` combine Tavily et Exa MCP anonyme. La Veille privilégie les flux validés, mémorise concepts/sujets et utilise un complément Tavily borné seulement lorsqu’elle conserve trop peu de flux. Les preuves physiques restent distinctes des preuves automatisées.

Le périmètre exact du Chat, ses incidents corrigés et ses limites de recette sont consolidés dans [15-checkpoint-chat-tavily.md](15-checkpoint-chat-tavily.md).

## Ordre de travail

1. Rejouer sur le Galaxy A17 les recettes d’authentification, courses, classement, `En course`, budget, Chat local et Veille orchestrée/offline, sans bloquer les autres travaux automatisés.
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
- envoyer une demande locale complexe avec Qwen, vérifier les jalons de délibération automatique, puis sélectionner Gemma et confirmer son étiquette de réflexion sur une demande complexe ;
- confirmer qu’une panne Ollama ne bloque aucune fonction Maison.

Ne pas déclarer la qualité, la latence ou la compatibilité mobile sans retour physique correspondant.

## Discipline d’exécution

Après toute évolution du runtime : tests ciblés, `pnpm verify`, sauvegarde si migration, redémarrage sans navigateur, healthcheck, documentation de la preuve, commit puis push.
