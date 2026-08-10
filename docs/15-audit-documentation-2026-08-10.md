# Audit documentaire du 10 août 2026

Statut : **documents actifs réalignés sur le candidat Assistant publié**

## Périmètre contrôlé

- `AGENTS.md`, `README.md` et le handoff `docs/00` ;
- décisions produit `docs/09` et feuille de route `docs/10` ;
- notes de sécurité, modèle de menace, ADR et plans actifs ;
- checkpoints Budget et Assistant ;
- liens Markdown locaux et compteurs de validation.

Les documents historiques 02 à 05 et 07 n’ont pas été réinterprétés ni utilisés pour modifier l’architecture.

## Incohérences corrigées

- navigation encore annoncée à quatre ou cinq destinations au lieu de six ;
- compteurs obsolètes de 85/20 et 121/21 remplacés par la preuve fraîche 142/22 ;
- plan d’après-courses encore présenté comme actif après livraison du Budget et de l’Assistant ;
- note réseau affirmant encore que push/pull étaient sans authentification ;
- modèle de menace présentant idempotence, lockfile et mise à jour PWA comme non implantés ;
- absence de trace canonique du choix Tailscale `/32` et de sa mise en pause ;
- absence de checkpoint consolidé pour le candidat Assistant.

## Limites conservées explicitement

- recettes physiques A17 pour auth, courses, classement, `En course`, budget et Assistant ;
- recette iPhone auth/offline/convergence ;
- qualité et latence réelles de l’Assistant ;
- BitLocker, ACL de `D:\FridayData` et restauration avant données réelles ;
- règles Windows génériques de Node.js à durcir avant accès extérieur ;
- Tailscale non installé et aucune restriction d’enrôlement 5G encore implantée.

## Résultat attendu après publication

Le README, les instructions de reprise et les documents canoniques pointent vers [le plan actif](14-prochaines-etapes-apres-assistant.md), le [checkpoint Assistant](13-etat-assistant-local.md) et l’[ADR Tailscale](adr/013-acces-exterieur-tailscale-route-privee.md). Les affirmations physiques restent limitées aux retours utilisateur déjà consignés.
