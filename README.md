# DaddyLive pour Stremio — v0.2.2

Addon utilisant l’interface HTTP de https://github.com/Lunatic16/daddylive-stream-resolver, avec catalogue, recherche, pagination et lecture HLS intégrée. Aucune clé API nécessaire dans ce mode.

## Installation Docker (Windows, Linux, macOS)

Prérequis : Docker avec Compose et le moteur Linux démarré (Docker Desktop sur Windows/macOS). Depuis le dossier du dépôt :

```sh
docker compose up -d --build
```

Cela construit et démarre les deux services, sans installer Node.js ni télécharger le resolver manuellement. Le resolver est compilé depuis la même révision Git que le script Windows. Aucun fichier `.env` n’est obligatoire pour l’utilisation locale.

Dans les extensions Stremio, ajouter `http://127.0.0.1:7000/manifest.json`. Le resolver est accessible à `http://127.0.0.1:3000`. L’addon attend que le resolver réponde avant de démarrer.

Commandes utiles :

```sh
docker compose ps
docker compose logs -f
docker compose down
```

Les ports 7000 et 3000 doivent être libres : arrêter les anciens serveurs lancés dans les terminaux avant de démarrer Docker. Pour changer les ports, copier `.env.example` vers `.env`, puis modifier `ADDON_PORT` et/ou `RESOLVER_PORT`. Si le port du resolver change, adapter aussi `RESOLVER_PUBLIC_URL` (par exemple `http://127.0.0.1:3001`). Les liens des lecteurs continuent à utiliser cette adresse ; `http://resolver:3000` est uniquement l’adresse interne entre conteneurs.

Pour une TV sur le réseau local, définir `BIND_ADDRESS=0.0.0.0` et `RESOLVER_PUBLIC_URL=http://IP_DU_PC:3000` dans `.env`. Installer alors `http://IP_DU_PC:7000/manifest.json`. Garder les services sur un réseau de confiance. Un accès depuis Internet nécessite HTTPS et un contrôle d’accès ; ne pas publier directement le proxy du resolver.

Les contrôles de santé vérifient les serveurs locaux, pas la disponibilité des chaînes chez le fournisseur. La première construction exige un accès réseau à GitHub, npm et aux images Node. Aucune image n’est publiée dans un registre.

## Installation Windows sans Docker
Prérequis : Node.js 24, Git et une version récente de FFmpeg accessible par la commande `ffmpeg` (avec l’option HLS `extension_picky`). Dans PowerShell, ouvrir ce dossier et exécuter :

    powershell -ExecutionPolicy Bypass -File .\setup-resolver.ps1
    Copy-Item .env.example .env
    powershell -ExecutionPolicy Bypass -File .\start-resolver.ps1

Dans un second terminal ouvert dans ce dossier :

    npm start

Dans les extensions de Stremio Desktop, coller :
http://127.0.0.1:7000/manifest.json

Garder les deux terminaux ouverts. Aucune installation npm pour l’addon lui-même.
Le script télécharge et compile le resolver à la révision cf97fcd382a252f6557d7b85094477eba98e905b. Il évite son script npm start Unix qui tente d’arrêter les processus utilisant son port.

## Configuration
Dans .env :
- RESOLVER_URL : adresse depuis l’addon, http://127.0.0.1:3000 par défaut.
- RESOLVER_PUBLIC_URL : adresse accessible au lecteur Stremio, identique sur ce PC.
- RESOLVER_SERVERS : casting,player,cast,stream,watch. Plus est exclu car signalé indisponible.
- PORT et HOST : 7000 et 127.0.0.1 par défaut.

DLHD_BASE configure le domaine du fournisseur dans le resolver. start-resolver.ps1 utilise https://thedaddy.li sauf si cette variable est déjà définie.

Pour téléphone/TV, les deux services doivent être accessibles depuis cet appareil : adapter HOST et RESOLVER_PUBLIC_URL. Certains clients exigent HTTPS. Le resolver contient un proxy générique : garder les services privés ou protégés par contrôle d’accès.

L’ancien mode API reste disponible en supprimant les variables RESOLVER_URL et RESOLVER_PUBLIC_URL, puis en configurant DADDY_API_KEY et streams.json.

## Fonctionnement
Catalogue via /api/channels, cache de cinq minutes, pages de 100 chaînes. L’addon vérifie les playlists HLS via /api/live en parallèle, avec un délai de 20 secondes par source. Le resolver renouvelle les liens temporaires.
À chaque demande de sources en mode resolver, l’addon tente ensuite de décoder 60 images avec FFmpeg. Il écarte les sources dont le test échoue ou dépasse 12 secondes. Si toutes échouent, aucune source n’est affichée. Docker inclut FFmpeg.
Ce test augmente le délai d’affichage des sources et consomme de la bande passante. Il porte sur un extrait et ne garantit pas la suite du flux ni sa compatibilité avec tous les lecteurs. Stremio conserve la source choisie pendant la lecture. Pour relancer le contrôle après un problème, rouvrir la liste des sources.
Le catalogue inclut les chaînes adultes du fournisseur. Aucun filtre parental implémenté.

## Validation du 9 novembre 2026
- Docker : configuration Compose validée, deux images construites, deux conteneurs sains, manifeste et catalogue (100 résultats sur la première page) vérifiés depuis le conteneur addon.
- Compilation du resolver réussie ; cinq tests automatisés de l’addon réussis (npm test).
- Catalogue réel : 899 chaînes.
- Parcours addon → resolver sur ESPN (44), serveur cast : une source, playlist HLS HTTP 200, première ressource média HTTP 200 avec signature MPEG-TS.
- Stream, watch et player ont résolu une URL mais retourné HTTP 403 pour leur playlist. Casting a échoué à la résolution.

Image, son et stabilité dans l’application Stremio restent à valider. La disponibilité de toutes les chaînes n’est pas garantie.

## Attribution
Resolver : Lunatic16 et contributeurs. Aucune licence explicite trouvée à la racine de cette révision. Son code reste séparé et n’est pas redistribué dans cette archive ; le script télécharge le dépôt original.
