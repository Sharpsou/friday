# Lire le TypeScript avec des réflexes Python R SQL

Statut documentaire : actif. Révision : 6 septembre 2026.

Annexe pédagogique ; pour localiser le code actuel, utiliser la [carte des modules](architecture-developpement.md).

## 9. Lire le TypeScript avec des réflexes Python/R/SQL

### 9.1 TypeScript n’est pas un runtime séparé

Le navigateur et Node.js exécutent du JavaScript. TypeScript ajoute des types contrôlés avant l’exécution. Les types disparaissent au build.

```ts
function cents(value: number): number {
  return Math.round(value * 100);
}
```

Équivalent mental Python :

```python
def cents(value: float) -> int:
    return round(value * 100)
```

Différence : le compilateur TypeScript bloque de nombreuses incohérences avant le lancement, mais il ne valide pas automatiquement un JSON reçu du réseau. C’est le rôle de Zod.

### 9.2 `type`, `interface` et unions

```ts
type Destination =
  'today' | 'agenda' | 'groceries' | 'budget' | 'assistant' | 'watch';
```

C’est l’équivalent d’un `Literal[...]` Python. Une autre chaîne est refusée par le compilateur.

```ts
interface SyncResult {
  conflicts: number;
  cursor: number;
  pending: number;
  syncedAt: string;
}
```

C’est proche d’un `TypedDict` ou d’une dataclass utilisée comme contrat de forme. Dans Friday, `interface` décrit souvent une structure interne ; `type` sert aussi aux unions et aux types dérivés.

### 9.3 `null`, `undefined` et `?`

Avec `strict` et `exactOptionalPropertyTypes` :

- `field: string | null` : le champ existe, mais peut valoir `null` ;
- `field?: string` : le champ peut être absent ;
- `field: string | undefined` : il existe conceptuellement, mais sa valeur peut être `undefined`.

Friday utilise beaucoup `null` dans les objets synchronisés, car JSON et SQL le représentent clairement.

```ts
const dueDate = input.dueDate ?? null;
```

`??` prend la valeur de droite seulement si la gauche vaut `null` ou `undefined`. Contrairement à `||`, il ne remplace pas `0`, `false` ou une chaîne vide.

### 9.4 `const`, `let` et immutabilité

- `const` interdit de réassigner la variable ;
- `let` autorise la réassignation ;
- un objet déclaré `const` peut encore être muté, sauf type `readonly` ou discipline immuable.

Friday privilégie les copies :

```ts
const updatedTask = {
  ...task,
  status: 'done',
  updatedAt: now,
};
```

`...task` est comparable à `{**task}` en Python ou à une copie/tibble transformé en R.

### 9.5 Destructuration

```ts
const { deviceId, key, profileId } = await getDeviceContext();
```

Équivalent : lire trois clés d’un dictionnaire/objet retourné.

```ts
const [tasks, groceries] = await Promise.all([listTasks(), listGroceryItems()]);
```

`Promise.all` lance les deux opérations asynchrones en parallèle et retourne un tableau de résultats.

### 9.6 `async`, `await` et `Promise`

Une fonction `async` retourne toujours une `Promise<T>`, comparable à une coroutine Python :

```ts
async function listTasks(): Promise<LocalTask[]> {
  // ...
}
```

`await` suspend cette fonction sans bloquer l’ensemble du navigateur. Les appels réseau, Web Crypto et IndexedDB sont asynchrones. `better-sqlite3`, lui, expose volontairement des opérations synchrones dans le processus hub.

### 9.7 Tableaux et style fonctionnel

| TypeScript              | Python                                   | R/dplyr                            |
| ----------------------- | ---------------------------------------- | ---------------------------------- |
| `items.map(f)`          | `[f(x) for x in items]`                  | `mutate`/transformation vectorisée |
| `items.filter(p)`       | `[x for x in items if p(x)]`             | `filter`                           |
| `items.reduce(f, init)` | `functools.reduce`                       | `summarise`/accumulate             |
| `items.find(p)`         | `next((x for x in items if p(x)), None)` | premier résultat filtré            |
| `items.some(p)`         | `any(...)`                               | `any(...)`                         |
| `items.every(p)`        | `all(...)`                               | `all(...)`                         |
| `items.toSorted(cmp)`   | `sorted(items, key=...)`                 | `arrange`                          |

`toSorted` retourne une copie ; `sort` modifie le tableau d’origine.

### 9.8 Génériques

```ts
async function parse<T>(
  response: Response,
  schema: { parse(input: unknown): T },
): Promise<T> {
  /* ... */
}
```

`T` est un paramètre de type. La fonction peut retourner plusieurs formes, mais le schéma passé fixe la forme précise pour chaque appel. C’est comparable à un `TypeVar` Python.

### 9.9 Réduction de type et unions discriminées

`SyncOperation` est une union discriminée par `entityType` :

```ts
if (operation.entityType === 'grocery_item') {
  // Ici TypeScript sait que operation est GroceryItemOperation.
}
```

C’est un pattern matching contrôlé par le compilateur. Les `switch` sur les types métier doivent rester exhaustifs ; la configuration interdit les chutes involontaires entre `case`.

### 9.10 Zod : l’équivalent pratique de Pydantic

```ts
export const TaskStatusSchema = z.enum(['todo', 'done']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
```

Le schéma sert à deux choses :

- valider une valeur réelle à l’exécution ;
- dériver le type TypeScript statique.

```ts
const parsed = PushRequestSchema.safeParse(request.body);
if (!parsed.success) {
  return reply.code(400).send({ error: 'invalid_sync_payload' });
}
```

`safeParse` ne lève pas d’exception. `parse` retourne la valeur validée ou lève une erreur. Utiliser les schémas aux frontières : HTTP, stockage déchiffré, JSON Ollama/Tavily et migrations.

### 9.11 React et JSX

Un composant est une fonction qui retourne du JSX :

```tsx
function NavButton({ active, label, onClick }: Props) {
  return <button aria-current={active}>{label}</button>;
}
```

Le JSX ressemble au HTML, mais :

- les expressions JavaScript sont entre `{}` ;
- les événements reçoivent des fonctions, par exemple `onClick={() => ...}` ;
- `className` remplace `class` ;
- les composants commencent par une majuscule.

#### Hooks importants

- `useState` : état qui provoque un nouveau rendu ;
- `useEffect` : effet après rendu, avec fonction de nettoyage éventuelle ;
- `useMemo` : valeur recalculée seulement si ses dépendances changent ;
- `useCallback` : identité de fonction stable selon les dépendances ;
- `useRef` : référence mutable sans nouveau rendu, souvent vers un élément DOM ;
- `useSyncExternalStore` : abonnement sûr à un état externe, ici le signal de mise à jour PWA ;
- `lazy` + `Suspense` : chargement différé du gros écran Chat et du rendu Markdown.

Attention : le tableau de dépendances d’un hook est fonctionnel, pas décoratif. Oublier une dépendance peut capturer une ancienne valeur ; en ajouter une instable peut relancer un effet en boucle.

### 9.12 Classes et champs privés

Le hub utilise des classes de service :

```ts
class SyncService {
  readonly #database: Database.Database;

  #apply(operation: SyncOperation) {
    /* ... */
  }
}
```

`#database` et `#apply` sont réellement privés en JavaScript. Dans d’autres classes, `private` est surtout une contrainte TypeScript.

### 9.13 Imports ESM et suffixe `.js`

Le dépôt est en modules ES (`"type": "module"`). Vous verrez :

```ts
import { buildHub } from './app.js';
```

Le fichier source s’appelle pourtant `app.ts`. Le suffixe `.js` décrit le module produit au runtime ; TypeScript sait le résoudre vers le `.ts` source. Cette règle concerne ce module compilé. Le package `@friday/contracts` exporte au contraire ses sources TypeScript et utilise des imports internes `.ts` ; respecter chaque configuration.

`import type` charge seulement un type et disparaît au build :

```ts
import type { TaskRecord } from '@friday/contracts';
```

### 9.14 Assertions à éviter

Vous rencontrerez `as Type`, `!` et parfois `as const` :

- `as const` conserve des littéraux précis et rend souvent les valeurs readonly ;
- `value!` affirme au compilateur que la valeur n’est pas nulle ;
- `value as Type` force une interprétation de type sans validation réelle.

Privilégier Zod ou une vérification explicite aux frontières. Une assertion ne rend jamais un JSON correct à l’exécution.
