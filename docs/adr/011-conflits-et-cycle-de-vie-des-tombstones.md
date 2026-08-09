# ADR-011 — Conflits explicites et cycle de vie des tombstones

Date : 9 août 2026

Statut : accepté comme filet de sécurité ; implémentation reportée sur signal d'usage

## Contexte

Friday autorise les mêmes écritures locales en ligne et hors ligne. Deux appareils peuvent donc modifier ou supprimer la même tâche ou la même course avant de se reconnecter. Le contrôle `baseRevision` du hub détecte déjà une divergence, mais une détection seule ne suffit pas : aucune version locale ne doit disparaître silencieusement et un appareil en retard ne doit jamais ressusciter un objet supprimé.

Un tombstone est l'objet conservé avec `deletedAt` renseigné. Il circule dans le journal de changements comme une modification ordinaire et masque l'objet dans l'interface.

## Options considérées

- dernière écriture reçue gagnante : simple, mais susceptible de perdre une modification faite hors ligne ;
- fusion automatique champ par champ : séduisante pour certains champs, mais ambiguë pour une date, un responsable, une récurrence ou une suppression ;
- duplication automatique : préserve les données, mais crée des tâches ou produits inattendus ;
- conflit explicite avec deux versions conservées et choix humain borné.

## Décision

### Détection et conservation

Le hub reste l'autorité sur la révision canonique. Une opération dont `baseRevision` ne correspond pas à la révision courante reçoit `revision_mismatch` et n'altère pas la valeur canonique.

Le client conserve alors séparément :

- la proposition locale ayant provoqué le conflit ;
- la dernière version canonique reçue du foyer ;
- l'identifiant de l'opération, la révision attendue et la révision serveur.

Un pull ne peut pas écraser la proposition locale en conflit. Il met à jour seulement la copie canonique associée au conflit. L'interface n'affiche un avertissement que lorsqu'au moins un conflit existe.

### Résolution

Pour une tâche ou une course, l'utilisateur choisit :

- `Garder la version du foyer` : abandonner l'opération locale en conflit et adopter la version canonique ;
- `Garder ma version` : republier la proposition locale avec une nouvelle opération fondée sur la révision canonique courante.

La résolution passe par l'outbox locale, possède un nouvel identifiant idempotent et reste utilisable après une coupure. Si la révision canonique évolue encore avant son application, Friday crée un nouveau conflit au lieu de forcer l'écriture.

Aucune fusion automatique générique n'est effectuée au MVP. Une optimisation métier ultérieure pourra fusionner des champs réellement indépendants, mais seulement avec des tests dédiés et sans modifier la règle de repli explicite.

### Suppression concurrente

Une suppression est une écriture révisionnée, pas un effacement physique. Elle peut donc entrer en conflit comme une modification. La version supprimée et la version active sont toutes deux présentées lors de la résolution. Conserver la suppression republie un tombstone sur la révision canonique courante ; conserver la version active republie explicitement l'objet.

Un tombstone canonique est toujours distribué aux appareils en retard et reste prioritaire sur une ancienne révision. Une opération ancienne ne peut pas recréer implicitement l'objet.

### Purge

Un tombstone devient éligible à une purge physique uniquement si les deux conditions sont réunies :

1. sa suppression canonique date d'au moins 90 jours ;
2. chaque appareil actif et non révoqué du foyer a avancé son curseur au-delà du changement de suppression.

Le hub doit donc enregistrer le dernier curseur acquitté par appareil authentifié. Un appareil révoqué, ou rattaché à un compte explicitement oublié, ne bloque plus la purge. En l'absence de preuve complète d'acquittement, le tombstone est conservé.

La purge sera transactionnelle, journalisée avec le nombre et les identifiants concernés, bornée par lots et d'abord testée sur une copie de base. Aucun job périodique de purge n'est activé tant que le suivi des curseurs et la migration N-1 ne sont pas prouvés.

Les entrées d'idempotence et de changement liées ne sont supprimées que lorsqu'elles ne sont plus nécessaires à un appareil actif et après une rétention au moins équivalente.

## Conséquences

Le stockage temporaire est plus important et la résolution demande une action humaine rare, mais Friday privilégie l'absence de perte. Les suppressions restent récupérables techniquement pendant leur rétention, sans devenir visibles dans les listes ordinaires.

Le bouton `Supprimer` reste directement accessible en mode modification. Les éditeurs de tâche et de course utilisent dès maintenant la même voie locale/outbox ; cela n'anticipe pas silencieusement la résolution d'une éventuelle divergence entre appareils.

Le 9 août 2026, l'utilisateur décide de ne pas bloquer la suite du produit sur l'écran de résolution ni sur la purge physique. Les tombstones restent conservés, ce qui est le choix sûr tant que leur volume est faible. Friday continue de détecter les divergences de révision et d'exposer leur compteur technique, mais l'interface complète de comparaison est différée.

La décision sera rouverte si l'un de ces signaux apparaît : conflit réel pendant l'usage à deux, objet ressuscité ou modification perdue, compteur de conflits non nul persistant, croissance matérielle de SQLite liée aux tombstones, ou besoin de retirer définitivement un historique ancien.

## Preuves attendues

- deux appareils modifient hors ligne le même objet : les versions locale et canonique restent consultables ;
- chacun des deux choix de résolution converge sans doublon ;
- modification contre suppression : aucune résurrection implicite ;
- un appareil en retard reçoit encore un tombstone récent ;
- un tombstone de moins de 90 jours ou non acquitté n'est pas purgé ;
- la révocation d'un appareil cesse de bloquer une purge autrement éligible ;
- migration SQLite N-1, tests Fastify/Dexie, scénario Chrome mobile et `pnpm verify` réussissent.

## Retour arrière

La purge périodique peut rester désactivée indéfiniment : conserver davantage de tombstones est sûr. L'interface de résolution peut être masquée en cas de défaut, à condition de conserver les deux versions et de ne reprendre aucune synchronisation destructive sur l'objet concerné.

## Révision

Après un premier conflit réel observé à deux appareils, après 90 jours d'utilisation si le volume de tombstones devient notable, ou avant l'activation de toute purge physique.
