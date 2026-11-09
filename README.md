# DaddyLive pour Stremio — v0.2

Addon utilisant l’interface HTTP de https://github.com/Lunatic16/daddylive-stream-resolver, avec catalogue, recherche, pagination et lecture HLS intégrée. Aucune clé API nécessaire dans ce mode.

## Installation Windows
Prérequis : Node.js 24 et Git. Dans PowerShell, ouvrir ce dossier et exécuter :

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
Catalogue via /api/channels, cache de cinq minutes, pages de 100 chaînes. Résolution parallèle via /api/resolve avec délai de 20 secondes. Sources HLS via /api/live pour laisser le resolver renouveler les liens temporaires.
Une résolution réussie ne garantit pas l’accès aux playlists/segments. Essayer une autre source en cas d’échec. WebM exclu ; pas de programme des événements.
Le catalogue inclut les chaînes adultes du fournisseur. Aucun filtre parental implémenté.

## Validation du 9 novembre 2026
- Compilation du resolver réussie ; cinq tests automatisés de l’addon réussis (npm test).
- Catalogue réel : 899 chaînes.
- Parcours addon → resolver sur ESPN (44), serveur cast : une source, playlist HLS HTTP 200, première ressource média HTTP 200 avec signature MPEG-TS.
- Stream, watch et player ont résolu une URL mais retourné HTTP 403 pour leur playlist. Casting a échoué à la résolution.

Image, son et stabilité dans l’application Stremio restent à valider. La disponibilité de toutes les chaînes n’est pas garantie.

## Attribution
Resolver : Lunatic16 et contributeurs. Aucune licence explicite trouvée à la racine de cette révision. Son code reste séparé et n’est pas redistribué dans cette archive ; le script télécharge le dépôt original.
