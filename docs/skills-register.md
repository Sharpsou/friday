# Registre des skills Friday

Date de validation initiale : 8 août 2026

Les commits sont épinglés à l'installation. Les résultats skills.sh sont des signaux d'audit, pas une garantie de sécurité.

| Nom                              | Source                     | Commit/tag                                 | Licence    | Audit au 2026-08-08                                | Phase  | But                                                           | Permissions observées                                                                                      | Validateur          | Décision                                                                                     |
| -------------------------------- | -------------------------- | ------------------------------------------ | ---------- | -------------------------------------------------- | ------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| `security-threat-model`          | `openai/skills`, curated   | `49f948faa9258a0c61caceaf225e179651397431` | Apache-2.0 | Gen Agent Trust Hub, Socket et Snyk : pass         | 0A, 3  | Produire un modèle de menace ancré dans le dépôt              | Lecture du dépôt et écriture d'un rapport Markdown ; aucun script                                          | utilisateur + Codex | installé                                                                                     |
| `security-best-practices`        | `openai/skills`, curated   | `49f948faa9258a0c61caceaf225e179651397431` | Apache-2.0 | Gen Agent Trust Hub : fail ; Socket et Snyk : pass | 0B, 3  | Guider React/TypeScript, CSP, stockage et secrets             | Lecture des références et du code ; rapport/corrections seulement dans le périmètre demandé ; aucun script | utilisateur + Codex | installé, conclusions revues manuellement                                                    |
| `playwright`                     | `openai/skills`, curated   | `49f948faa9258a0c61caceaf225e179651397431` | Apache-2.0 | Gen Agent Trust Hub et Snyk : fail ; Socket : pass | 0B     | Inspection navigateur et preuve offline                       | Wrapper shell lançant `npx --yes --package @playwright/cli` et écrivant des artefacts navigateur           | utilisateur + Codex | installé ; wrapper flottant interdit dans `pnpm verify`, qui utilise une version verrouillée |
| `vercel-react-best-practices`    | `vercel-labs/agent-skills` | `7c180d9044c9ae2b442b567aad4e42a28dd5ed62` | MIT        | Gen Agent Trust Hub, Socket et Snyk : pass         | 0B, 1  | Éviter waterfalls, bundles inutiles et rerenders coûteux      | Références Markdown uniquement ; aucun script exécutable                                                   | utilisateur + Codex | installé                                                                                     |
| `verification-before-completion` | `obra/superpowers`         | `44c9b2d6e889982ac18c27d05a19fefe335194e1` | MIT        | Gen Agent Trust Hub, Socket et Snyk : pass         | toutes | Exiger une preuve fraîche avant toute déclaration de réussite | Exécution des commandes de vérification du dépôt ; aucun script fourni                                     | utilisateur + Codex | installé                                                                                     |

## Essais non destructifs

- catalogue curated listé avec le script officiel `skill-installer` ;
- chaque `SKILL.md` et l'unique script exécutable du pack ont été lus avant installation ;
- sources clonées sous `.analysis/` pour audit, hors dépôt ;
- installations réalisées par le helper officiel avec les commits ci-dessus ;
- les cinq répertoires d'installation ont été vérifiés après copie.
