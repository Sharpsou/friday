# Runbook Chat — état de reconstruction

Date : 30 août 2026
Statut : moteur retiré, archive historique uniquement

Le Chat n'envoie plus de message et n'appelle plus Ollama, Tavily ou Exa. Les
anciens modes et le sélecteur de modèle ont été supprimés. La PWA permet encore
de consulter, archiver, restaurer ou supprimer les conversations du
profil connecté.

Le document qui fait autorité pour la reprise est
[32 — fondation de la reconstruction du Chat](../32-fondation-reconstruction-chat.md).
Les anciennes recettes du harnais `grounded-claims` / `grounded-answer` sont
historiques et ne doivent pas guider une nouvelle implémentation.

## Contrôles d'exploitation

1. ouvrir Chat et vérifier l'encart « Chat en reconstruction » ;
2. vérifier qu'aucun bouton de création, champ de saisie, mode ou modèle n'est
   proposé ;
3. ouvrir une conversation historique et vérifier messages et sources ;
4. vérifier qu'un autre profil ne voit pas cette conversation ;
5. contrôler `/api/health` et l'intégrité SQLite comme pour le reste du Hub.

L'ancienne route d'envoi répond volontairement HTTP 410 aux PWA encore en
cache. La route de création n'existe plus. Les tables historiques ne sont pas
supprimées : elles contiennent les conversations existantes et assurent la
compatibilité des migrations.

## Configuration restante

Aucune variable `FRIDAY_ASSISTANT_*` n'est utilisée. La Veille possède désormais
son moteur Qwen et son client Tavily propres, configurés par
`FRIDAY_WATCH_MODEL`, `FRIDAY_WATCH_TIMEOUT_MS` et la clé Tavily déjà exploitée
par ce domaine. Cette isolation ne préjuge pas du futur Chat.
