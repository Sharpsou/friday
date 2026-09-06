# Continuité des recherches Chat

Statut documentaire : archive.

Le suivi « Donne moi les liens de podcast que tu as trouvé » du 5 septembre
a expiré en audit après cinq minutes (`CHAT_DEADLINE_EXCEEDED`). La formulation
ne déclenchait pas la résolution de contexte ; les URL précédentes n’étaient
pas transmises au moteur et les extraits n’étaient pas conservés.

À la demande de l’utilisateur, le Hub conserve maintenant une mémoire de
recherche privée liée aux messages. SQLite 47 ajoute une table supprimée en
cascade avec la conversation. Les passages sont des extraits originaux retenus
par la sélection documentaire, pas une reformulation du modèle. Les dates,
URL et identifiants des sources sont conservés. Le dossier est borné à huit
sources, douze passages et 24 000 caractères de texte.

Pour une conversation disposant de recherches, l’orchestrateur reçoit la
demande, l’historique et le dossier. Il choisit de restituer les liens connus,
de rédiger à partir des extraits ou de compléter la recherche Web. Les anciennes
conversations récupèrent les URL déjà enregistrées ; les pages sont relues si
leur contenu est nécessaire. Toute nouvelle rédaction reste auditée. Le mode
Local garde son fonctionnement sans recherche Web.

Les identifiants choisis sont validés par le code. Les anciennes réponses
restent explicitement non fiables et ne servent jamais de preuves. La mémoire
est filtrée par profil, conversation et ordre causal des demandes. Elle n’est
ni exposée dans les messages de l’API ni partagée entre conversations.

La décision de suffisance documentaire reste celle d’un modèle : elle peut
encore mal évaluer un besoin de recherche complémentaire. Les extraits conservés
ne prouvent pas que la page est toujours actuelle ; l’orchestrateur doit lancer
une recherche pour une actualisation. Les budgets de cinq minutes, douze appels
modèle, six recherches et seize lectures restent en vigueur. L’ordonnanceur
Ollama commun reste inchangé. L’ancien message échoué n’est pas réécrit ni
relancé automatiquement.

Les tests ciblés couvrent la restitution de liens sans recherche, la rédaction
auditée depuis les extraits, la relecture des anciennes URL, la recherche
complémentaire, le rejet d’une source inconnue, la persistance après redémarrage,
l’isolation par profil/conversation et la suppression en cascade.

## V�rification et livraison

`pnpm verify` passe : 532 tests (27 Robot, 25 contrats, 40 c�ur, 27 domaine,
191 Hub, 133 PWA, 60 banc et 29 navigateur), format, lint, typage et builds.
Les sept nouveaux sc�narios utilisent des mod�les simul�s ; aucune nouvelle
campagne Ollama ni recette physique n�est d�clar�e.
Preuve : `D:\FridayData\evaluations\chat-harness-v3\verification-continuation.log`.

D�ploiement avec le lanceur Friday, code 0 ; � 23 h 29, sant� locale/LAN et
int�grit� SQLite `ok`, migration 47 et aucune violation de cl� �trang�re. Le
HTML servi correspond au build. Preuves `deployment-continuation.log` et
`deployment-continuation.json` dans le m�me dossier priv�.
Sauvegarde online avant livraison :
`D:\FridayData\backups\chat-continuation-20260905-232301\before.sqlite`
(version 46, int�gre), PWA pr�c�dente dans `web-before`. Aucun retour arri�re
complet du runtime n�est d�clar� test�.
