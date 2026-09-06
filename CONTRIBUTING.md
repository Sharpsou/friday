# Contribuer à Friday

Statut documentaire : actif. Révision : 6 septembre 2026.

Le dépôt ne possède pas encore de licence de réutilisation ; le choix reste au
propriétaire. Cette méthode de contribution n'ajoute aucun droit ni engagement
de maintenance pour une installation tierce.

## Reprendre

Lire [AGENTS](AGENTS.md), [00](docs/00-reprise-nouveau-chat.md),
[27](docs/27-etat-canonique-app-robot-2026-08-25.md),
[09](docs/09-decision-finale-pwa-mvp.md), [10](docs/10-feuille-de-route-technique-implementation.md)
et le runbook du domaine. Utiliser ensuite la [carte du code](docs/guides/architecture-developpement.md).

```powershell
git status -sb
git log -5 --oneline
pnpm install --frozen-lockfile
```

Préserver le travail local. Pour un lot isolé, employer une branche `codex/` avec
un nom descriptif ; ne pas réinitialiser le dépôt ni modifier les projets sources voisins.
Ne jamais ajouter les données du foyer, secrets, captures privées, modèles ou archives
de rollback. Le dossier de données reste hors Git et hors synchronisation Drive runtime.

## Réaliser un changement

Définir le comportement attendu et le test qui le vérifie. Respecter les frontières
de modules, l'atomicité de l'outbox, les contrats publics et les migrations existantes.
Un refactoring ne doit pas cacher un changement de règle métier, de prompt ou de sécurité.
Documenter séparément les corrections comportementales éventuelles.

Mettre à jour le runbook et l'état canonique si le comportement change. Ajouter un
rapport daté seulement pour une preuve ou décision utile. Classer tout nouveau document
dans l'inventaire et réparer ses liens ; voir la [maintenance](docs/reference/maintenance-documentation.md).

## Vérifier et préparer la revue

Exécuter les tests ciblés puis `pnpm verify` selon le [runbook](docs/runbooks/development.md).
La commande comprend le contrôle documentaire et la garde d'architecture ; elle
n'autorise ni campagne de modèles, ni mouvement Robot, ni déploiement du foyer.

Avant commit : `git diff --check`, puis relire les changements et vérifier les fichiers
non suivis. N'ajouter à l'index que les fichiers du lot, avec des chemins explicites.
Un commit doit décrire problème et résultat. La description de revue donne le
comportement final, les contrôles exécutés et les validations encore ouvertes.
Ne pas confondre commit, publication GitHub, déploiement et recette appareil.
