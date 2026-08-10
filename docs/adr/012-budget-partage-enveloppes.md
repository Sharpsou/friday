# ADR-012 — Budget partagé, enveloppes et prévisionnel

Date : 9 août 2026
Statut : accepté et implémenté, seed réel et recette physique en attente

## Décision

`Budget` est la cinquième destination principale, entre `Courses` et `Veille`. Les deux adultes voient et modifient le même budget. Une attribution `Maison` ou profil sert aux filtres et synthèses, jamais aux permissions.

Le modèle sépare cinq objets synchronisés : mouvements réels, modèles récurrents, enveloppes, dépenses futures et paramètres mensuels d'épargne. Tous empruntent l'outbox offline-first existante. Les totaux sont calculés en centimes entiers par des fonctions pures du domaine ; Ollama, les banques, l'OCR et la liste de courses n'interviennent pas.

## Règles de calcul

- Reste réel = revenus réels − dépenses réelles − versements d'épargne + retraits.
- Épargne nette = versements − retraits. Taux = épargne nette / revenus réels ; `—` quand les revenus sont nuls ou négatifs.
- Solde d'enveloppe = report éventuel + allocations mensuelles − dépenses affectées.
- `Courses` et `Perso & loisirs` repartent à zéro ; `Santé`, `Imprévus` et projets peuvent cumuler.
- Les frais fixes sont déduits avant les enveloppes et ne forment pas une enveloppe.
- Une provision projet est virtuelle et n'est ni une dépense réelle ni un versement d'épargne.
- Provision suggérée = montant restant / nombre de mois civils, mois courant et échéance inclus, arrondi au centime supérieur. Le dernier mois absorbe l'ajustement.
- Une provision validée mémorise son mois de départ : Friday affiche le montant déjà réservé, le reliquat et ajuste le dernier versement virtuel au centime près.
- Budget non affecté = revenus prévus − frais fixes prévus − allocations d'enveloppes − provisions de projets − objectif d'épargne. Un résultat négatif signale un plan irréalisable avant toute dépense réelle.
- Une clôture propose seulement le surplus net non déjà réservé dans des provisions cumulables. La confirmation seule crée un versement réel.

Les catégories sont fermées (`fixed`, `groceries`, `health`, `leisure`, `extra`) et indépendantes de la fréquence (`one_off`, `monthly`, `yearly`). Les montants sont positifs en centimes et le type du mouvement donne le sens.

## Récurrence, historique et conflits

Une échéance mensuelle au-delà de la fin du mois tombe le dernier jour ; le 29 février annuel devient le 28 hors année bissextile. À échéance, le client crée automatiquement le mouvement réel. Son identifiant est dérivé de `modèle + date`, donc deux appareils hors ligne convergent vers la même occurrence et le hub rejoue le même résultat sans doublon.

Les paiements d'une dépense future, corrections et clôtures mensuelles portent aussi un identifiant logique déterministe. Deux validations hors ligne du même acte convergent ainsi vers un seul mouvement ; si leurs montants divergent, le hub signale un conflit au lieu de les additionner. Une correction référence `correctionOfId`; les synthèses ignorent le mouvement remplacé, mais l'audit le conserve.

Modifier ou suspendre une série ne touche que ses échéances futures. Les occurrences déjà matérialisées gardent leur montant et leur libellé. Une occurrence ignorée reste sous forme de tombstone et ne peut pas être recréée au prochain démarrage.

Un revenu ou un frais réel peut être supprimé depuis les mouvements récents ; la suppression produit un tombstone synchronisé et conserve donc la trace d’audit. Supprimer une correction supprime aussi le mouvement qu’elle remplaçait afin de ne pas faire réapparaître silencieusement l’ancien montant. Pour une occurrence récurrente, l’adulte choisit entre cette occurrence seule et cette occurrence avec arrêt de la série. L’arrêt retire le modèle récurrent, empêche toute nouvelle matérialisation et conserve les occurrences antérieures déjà comptabilisées. Une série peut également être supprimée directement depuis sa configuration avec la même conservation de l’historique réel.

## UX

La page mensuelle reste verticale : synthèse, enveloppes, échéances/projets puis mouvements. Le `+` propose Dépense, Revenu, Versement/retrait et Dépense future. Montant, libellé et catégorie/enveloppe sont au premier niveau ; date et attribution sont repliées et préremplies.

`Aujourd'hui` ne rend qu'une alerte déterministe liée à un état : enveloppe dépassée, échéance proche sans provision ou clôture disponible. Il n'existe pas de notification répétée sans changement d'état.

Les enveloppes sont créées volontairement par les adultes, sans recréation automatique au démarrage. Leur nom, allocation, catégorie, report et attribution peuvent être modifiés sans réécrire les dépenses historiques. Elles peuvent aussi être supprimées depuis la liste ; la suppression est synchronisée et auditée. Une enveloppe encore liée à une dépense future active doit d'abord être détachée de ce projet.

Pour conserver une page mensuelle courte, les listes `Enveloppes` et `Revenus et frais` sont condensées et repliées par défaut ; leur en-tête conserve le nombre d’éléments. `Mouvements récents` reste ouvert au chargement mais peut également être replié. Une ligne fermée n’affiche que le libellé, le montant utile et une métadonnée courte ; les formulaires et actions détaillées ne prennent de hauteur qu’après ouverture volontaire.

## Reprise initiale

La priorité des sources est :

1. `D:\prog\budget\outputs\budget_simple_v2\Budget_simple_2026_2027.xlsx` pour revenus, frais fixes, prévisionnel et occasionnels ;
2. uniquement `Enveloppes!A1:Q13` de `D:\prog\budget\outputs\budget_2026_27\Budget_familial_2026_2027.xlsx`.

En cas de chevauchement, le classeur simple gagne. Les montants nuls et mentions « à confirmer » deviennent des brouillons inactifs. Les personnes sont rapprochées par nom normalisé ; toute ambiguïté arrête l'import. Le payload normalisé réel reste sous `D:\FridayData`, hors Git, et porte des identifiants déterministes, un digest source et `budget-seed-v1`.

## Conséquences

Le budget fonctionne sans réseau et sans service tiers. Les provisions sont compréhensibles mais demandent une validation humaine. La reprise réelle exige d'abord BitLocker, des ACL minimales et une sauvegarde SQLite ; elle ne peut donc pas être déclarée terminée par les tests automatisés seuls.
