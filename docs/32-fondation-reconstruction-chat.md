# Friday — fondation du Chat actuel

Statut documentaire : actif. Consolidation : 6 septembre 2026.

Le Chat v2 est activé sur décision utilisateur et livré ; sa gate qualitative reste
refusée. Le document décrit le harnais courant, sans relancer la campagne longue
arrêtée le 5 septembre. Les [anciennes étapes](archives/etats-techniques/32-fondation-reconstruction-chat.md)
et [rapports d'essais](audits/) restent des preuves datées.

## Interfaces et responsabilités

La PWA expose Friday, Local et Recherche Web. Le plugin `/api/chat` authentifie le
profil et contrôle l'origine des mutations. L'envoi répond 202 avec un run suivi et
annulable. L'ancienne API `/api/assistant` conserve l'archive privée ; son envoi est
retiré (410). Il n'existe aucune outbox d'envoi Chat ni outil de mutation métier.

Le Hub injecte recherche Tavily, lecteur Web protégé et Ollama dans `SharedChatEngine`.
Le banc appelle le même cœur et partage ses types ; le Hub n'importe jamais le banc.
Le dossier DOM figé vérifie la parité technique, pas la qualité sémantique.

## Pipelines et configuration effective

Dans le Hub, `FRIDAY_CHAT_PIPELINE=unified` sélectionne le pipeline actif.
Pour le rollback axes, définir `FRIDAY_CHAT_PIPELINE=axes` **et**
`FRIDAY_CHAT_AXES_ENABLED=true`. En dehors d'unified, un flag axes faux conduit au
chemin legacy conservé. Une valeur inconnue de pipeline n'est pas une validation
de configuration : elle suit ce même mécanisme. Le cœur seul a son propre défaut
unified ; ne pas l'assimiler au défaut de l'adaptateur Hub.

Les trois fonctions distinctes sont dans `runtime/unified-pipeline.ts`,
`withaxes-pipeline.ts` et `legacy-pipeline.ts`. Publication et récupération des preuves
ont leurs modules. Le découpage conserve leurs décisions distinctes.

## Harnais unifié et budgets

Routage, contexte causal, recherche bornée, lecture de pages originales, sélection de
passages, rédaction, audit et corrections constituent la voie Web. Les plafonds
sont six recherches, seize pages, douze générations et cinq minutes depuis la mise
en file, avec jusqu'à trois corrections contrôlées selon le budget restant.
Le dossier utile conserve au plus huit sources, douze passages et 24 000 caractères.
Une limite est un plafond de travail, pas une promesse de latence mesurée sur téléphone.

Gemma `gemma4:e4b-it-qat` rédige ; Qwen `qwen3.5:9b-q4_K_M` audite et participe
à l'orchestration ; `qwen3-embedding:0.6b` assure la sélection sémantique éphémère,
avec repli lexical. Les générations et embeddings partagent l'ordonnanceur FIFO
Chat/Menus/Veille/classement/photo. La recherche Tavily partage le budget Hub.

Les sources illisibles restent des pistes non vérifiées, sans devenir des citations.
Le code valide identifiants et citations, conserve la meilleure réponse auditée selon
les critères du moteur et empêche de publier librement un brouillon non audité après
panne. Une réponse partielle acceptée peut être conservée ; l'annulation reste prioritaire.
Cela ne garantit pas que l'auditeur repère une condition manquante ou une erreur réelle.

## Continuité et confidentialité

SQLite 47 ajoute `chat_research_memory` : sources et passages originaux bornés, privés
au profil et à la conversation, supprimés avec le message/conversation. Le dossier
survit au redémarrage. Une relance peut réutiliser les preuves, restituer les liens
connus ou rechercher un complément. Les identifiants doivent exister ; une décision
invalide reprend la recherche normale. Les dates de collecte restent visibles dans
la provenance ; une actualisation exige une nouvelle recherche.

Une réponse passée est du contexte non fiable, jamais une preuve. Aucun index
vectoriel global ni RAG n'est ajouté. Prompts, embeddings et raisonnement ne sont
pas stockés comme mémoire. Les affirmations pré-migration 47 interdisant tout passage
persisté appartiennent à l'archive historique.

L'ordre causal exclut les questions futures. Le client conserve les envois incertains
avec leur identifiant pour éviter de créer aveuglément un nouveau run après réponse
perdue. Le cache est chiffré avant transaction, réconcilie les suppressions et distingue
authentification, désactivation et indisponibilité réseau.

## Gate et suites autorisées

Les [120 réponses revues](audits/2026-09-05-implementation-chat.md) n'ont pas validé
la qualité. Le [harnais suivant](audits/2026-09-05-harnais-chat-v3.md), la
[simplification](audits/2026-09-05-simplification-harnais-chat.md) et la
[continuité de recherche](audits/2026-09-05-continuite-recherche-chat.md) décrivent
les étapes et limites ultérieures. La modularisation ne change ni prompts ni modèles.

Ne pas relancer les corpus ou téléchargements historiques par une simple reprise.
Avant nouvelle campagne : reprendre explicitement objectif, corpus non consommé,
critères, méthode de revue et budget avec l'utilisateur. Les contrôles déterministes
et simulés de `pnpm verify` restent autorisés ; ils ne ferment pas la gate qualitative.
Voir le [runbook Chat](runbooks/assistant-gemma.md) pour exploitation et diagnostic.
