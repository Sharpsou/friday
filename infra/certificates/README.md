# Certificats du pilote

La recette HTTPS du Galaxy A17 est active sur `https://192.168.1.14:8443`.

Fichiers installés hors dépôt :

| Fichier                                        | Rôle                                   | Règle                                    |
| ---------------------------------------------- | -------------------------------------- | ---------------------------------------- |
| `D:\FridayData\certificates\friday-rootCA.crt` | certificat public de l’autorité Friday | seul certificat à installer sur l’A17    |
| `D:\FridayData\certificates\friday-lan.pem`    | certificat HTTPS du hub                | reste sur le PC                          |
| `D:\FridayData\secrets\friday-lan-key.pem`     | clé privée HTTPS du hub                | reste sur le PC, hors Drive              |
| `%LOCALAPPDATA%\mkcert\rootCA-key.pem`         | clé privée de l’autorité locale        | ne jamais copier, partager ou versionner |

Le dépôt ne contient aucune clé privée. Si l’adresse IP du PC change, régénérer le certificat serveur pour la nouvelle origine puis reprendre la recette A17. La procédure complète est dans [`docs/recipes/galaxy-a17-p0.md`](../../docs/recipes/galaxy-a17-p0.md).
