# Exploitation de la Veille RSS

La Veille utilise maintenant l'orchestration décrite dans
`docs/17-etat-veille-orchestree.md`. Les diagnostics RSS ci-dessous restent
applicables.

## Diagnostic

1. Ouvrir `Veille`, puis la veille concernée.
2. Vérifier la date et l'heure de prochaine mise à jour affichées sur sa carte et
   dans `Sources et réglages`.
3. Un premier lancement sans digest est normal : il constitue la référence.
4. `Analyse en attente` indique que la collecte a réussi mais qu’Ollama doit reprendre.

## Source refusée

- Friday accepte uniquement une URL HTTPS publique sur le port standard.
- Une page doit annoncer un flux RSS/Atom avec `link rel="alternate"`, ou l’URL fournie doit être directement un flux.
- Les redirections vers un réseau privé, les pages trop grosses et les types de contenu inattendus sont refusés.
- Ne pas contourner le refus avec une recherche Tavily périodique ; choisir un autre flux vérifié.

## Reprise

- Après un redémarrage, les runs `collecting` ou `analyzing` reviennent dans la file.
- Un redémarrage sans run interrompu et avant l'échéance ne collecte ni n'analyse.
- Une échéance manquée produit un seul rattrapage, puis Friday revient à l'heure
  quotidienne ou hebdomadaire configurée.
- Un flux inchangé peut répondre `304` et ne crée aucun doublon.
- Une panne de source ou d'analyse attend la prochaine échéance configurée, sauf
  lancement manuel explicite.
- Une panne Ollama ne bloque ni les données Maison ni la lecture des articles déjà collectés.

## Recette A17

1. Créer une veille avec un flux de test HTTPS et vérifier l’aperçu validé.
2. Confirmer que le premier passage n’ajoute pas de compteur de nouveauté.
3. Publier ou injecter un nouvel élément de flux, puis lancer `Actualiser`.
4. Vérifier source, résumé, justification et lien.
5. Marquer l’article `À suivre`, couper le réseau, fermer et rouvrir la PWA.
6. Vérifier que la carte Veille reste présente dans `Aujourd’hui`, ouvrir la veille, contrôler le digest et l’état hors ligne, puis reconnecter et confirmer la convergence sans doublon.
7. Refaire avec Ollama arrêté : l’article doit rester lisible et l’analyse être signalée en attente.
8. Redémarrer deux fois avant l'heure prévue et confirmer qu'aucune nouvelle
   analyse n'apparait.
9. Faire manquer une échéance, relancer le hub et confirmer un seul rattrapage.
