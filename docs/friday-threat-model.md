# Friday — frontières de sécurité et modèle de menace de référence

Statut documentaire : reference. Révision documentaire : 6 septembre 2026.

Le [modèle de menace daté](archives/etats-techniques/friday-threat-model.md) conserve
les scénarios TM, risques, observations et décisions de son périmètre d'origine.
Il n'est pas une certification de sécurité du runtime actuel. La présente mise à jour
documentaire ne constitue pas un nouvel audit de sécurité.

## Frontières à préserver

- Hub Windows/SQLite canoniques, hors Git ; PWA/Dexie chiffrés avec outbox métier.
- Auth fermée, profils et appareils vérifiés par le serveur ; révocation ne garantissant
  pas l'effacement d'un cache d'appareil offline.
- Maison et Budget partagés ; Chat, Veille, brouillons et mémoire de recherche privés.
- Sources Web hostiles, lecteurs bornés, provenance et validation ; le modèle ne
  devient jamais le mécanisme d'autorisation et ne commande aucun actionneur.
- Ollama loopback, ordonnanceur/budget communs ; indépendance Maison/Budget/sync de l'IA.
- Robot avec consentement visible, watchdog local et commandes expirables ; aucun
  rejeu physique par outbox ni reprise autonome après redémarrage.

## Évolutions à couvrir lors d'une prochaine revue de sécurité

Maison a ajouté des commandes composites et des propositions privées ; SQLite 47
conserve des passages de recherche privés par conversation. Le modèle daté ne doit
plus être cité comme preuve qu'aucun passage n'est persisté ou que RSS est absent.
Le découpage d'authentification conserve les interfaces ; ses caractérisations et
tests de concurrence ne remplacent pas une revue de menace de ces frontières.

La [carte actuelle](guides/architecture-developpement.md) et les [rapports](audits/)
permettent de délimiter cette future revue sans lui attribuer de conclusion à l'avance.
Les portes Budget réel, sauvegarde/restauration, Tailscale et action physique restent
celles de l'état canonique et des runbooks. Ne pas conclure qu'un risque historique
est fermé simplement parce qu'un module a été déplacé.
