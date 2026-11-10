# Conventions du dépôt

Ce projet surcharge les préférences globales sur un point : **il est en français** (commentaires,
documentation, messages de commit), parce que tout l'existant l'est. Le README reste en anglais
(vitrine publique).

## Écriture
- Échanges avec Rémi en français. Messages de commit en français **sans accents**, préfixe
  `feat:`, `fix:`, `docs:`, `test:`, `refactor:` ; message multiligne par `git commit -F fichier`.
- Identifiants du code en français pour le domaine (`nomenclature`, `calculerMonde`, `IleDuMonde`),
  en anglais pour l'ancien code et les termes techniques (`GridShape`, `planIslandImport`).
  Ne pas renommer l'existant pour l'uniformiser.
- Un en-tête de fichier dit CE QUE fait le module et POURQUOI, avec les mesures qui ont décidé ;
  les commentaires portent la règle du jeu et sa source (fichier, GUID, ou « vérifié en jeu »).

## Règles de jeu
- Toute règle se vérifie dans les fichiers du jeu (`tools/rda_extract.py`, `assets.xml`,
  `datasets.xml`, `.ifo`, `.a7minfo`), ou se demande à Rémi qui la teste en jeu. Jamais
  d'extrapolation présentée comme un fait ; une hypothèse est marquée comme telle (dans le code et
  dans `GAME_MECHANICS.md`, verdicts [FICHIERS] / [IN-GAME] / [OUVERT]).
- Albion (`celtic_*`) et Latium (`roman_*`) sont distincts : ne jamais transposer une mesure.
- Raisonner à l'échelle de l'île et de l'objectif choisi, pas sur quelques cases locales.

## Code
- Pas de `any` ; types explicites sur les exports. Modules purs (sans React) dans `engine`,
  `economy`, `optimizer`, `commande`, `monde`, `prodlayout`.
- Les moteurs reçoivent le catalogue en paramètre et passent par `makeLookup` ; ils tournent en
  cases entières (`downscaleGrid` / `scaleResultToHalfTile`).
- Un moteur lourd tourne dans un Web Worker (`run*.ts` → `*Worker.ts`).

## Tests
- `*.test.ts` à côté du code. `pnpm test` (~540, ~1 min 50), `pnpm test:fast` sans les
  balayages. Un changement de plan VOULU se recapture (`-u`) sur le golden de la trame droite,
  après mesure sur les vraies îles.
- Une sonde de mesure passe les hauteurs de l'île (`heightsOf`) comme le worker.
- Les tests qui lisent un fichier de la machine (sauvegarde) sont sautés s'il est absent et
  chargent `node:fs` par une chaîne (le projet n'a pas les types de Node).

## Git
- Travail sur `dev` ; commits libres, **push seulement avec l'accord de Rémi**.
- Données générées (`src/data/*.generated.json`) versionnées ; icônes et `graphify-out/` non.

## Machine (Windows)
- PowerShell 5.1 : `R` est un alias réservé ; pas de `&&`.
- Bash (Git Bash) disponible ; Python lancé avec `-I` pour les scripts sur des fichiers extraits.
- Le serveur de développement se lance par le panneau navigateur (`.claude/launch.json`, `dev`).
