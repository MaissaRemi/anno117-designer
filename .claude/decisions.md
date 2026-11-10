# Décisions structurantes, et pourquoi

Chaque entrée : la décision, sa raison, où elle vit. Détail et mesures : `docs/REPRISE.md` et les
documents datés de `docs/superpowers/`. Les plus récentes en premier.

## Planification d'un monde

- **Lire la sauvegarde plutôt que la graine** (04/11/2026). La graine ne suffit pas : le tirage
  des îles et des fertilités se fait dans l'exécutable ; la sauvegarde contient le monde généré.
  Lecteur écrit dans le navigateur (`monde/sauvegarde/`) pour que l'utilisateur dépose son
  fichier sans rien installer.
- **Un emplacement inactif est retiré de l'île** (05/11). Données du jeu : les « Slot … » sont
  des objets de carte aléatoires, les « Fixed Slot … » toujours actifs. Hypothèse à confirmer en
  jeu : pas de source d'aqueduc sur un emplacement inactif.
- **Réglages de la partie appliqués au monde seulement** (05/11) : consommation et entretien,
  facteurs lus dans `DifficultySettings`. Les outils d'une île restent au cran Faible (données
  brutes) en attendant ; les impôts ne sont pas appliqués, leur effet n'étant pas établi.
- **Le bilan du monde est le total de toutes les îles** (04/11, demandé par Rémi) ; une île de
  production n'est jamais jugée sur son propre argent, seulement sur ce qu'elle pose et loge.
- **Répartir sur des devis, poser ensuite** (30/10). Le devis d'une île coûte moins d'1 ms, la
  pose réelle des secondes : on répartit sur estimations (budgets terre 65 %, côte par province,
  emplacements partagés), on pose en parallèle, on rattrape une fois.
- **Suggestions d'achat au gain net** (30/10) : ce qu'une île couvrirait moins ce qu'elle
  réclamerait en retour ; sinon une île infertile semblait utile.
- **Première version sans navires** (Rémi) : flux en unités par minute, temps de trajet ignoré.
- **Les deux provinces dans une même configuration** : les besoins complets des Patriciens
  passent par l'Albion, ceux des Nobles par le Latium.

## Moteurs d'île

- **« Ma commande » comme chemin principal** (refonte du 26/10) : le joueur dit ce qu'il veut, le
  moteur dresse la nomenclature et dispose en îlots ; l'ancien moteur reste comme « Remplir
  l'île ». Raison : l'ancien décidait seul des services et ne disait pas ce qui manquait.
- **Bâtiments côtiers en trois zones** (04/11) : quai à terre, partie dans l'eau, reste libre ;
  lu dans les `.ifo`. Exiger la terre hors de l'eau interdisait les marais salants partout.
- **Productivité additive** (30/10, confirmé en jeu) : dieu + recherche + objets s'additionnent.
- **Trame mêlée en pause** (30/10) : le gain mesuré d'une île droite ici et en biais là est du
  même ordre que le bruit entre deux plans droits.
- **La portée est une longueur de trajet** (vérifié en jeu) : une case diagonale coûte ~1,4 pas.
  La règle « une case = un pas » était fausse et gonflait le gain de la diagonale.
- **Une maison rasée coûte plus qu'un détour** (`PRIX_CASE_RASEE` = 3) dans le raccordement au
  comptoir ; les poches murées restent vides.
- **Le bilan d'attributs est rapporté, pas imposé** par défaut : l'ancien garde-fou rasait
  jusqu'à neuf maisons sur dix sur une règle jamais vérifiée en jeu.
- **Plans au choix** : le moteur évalue des dizaines de plans ; il en montre jusqu'à trois
  contrastés (front de Pareto) au lieu d'un seul selon une règle fixée d'avance.

## Données et outillage

- **Aucune valeur tapée à la main** : tout vient des archives du jeu (`tools/`). Une règle de jeu
  se vérifie dans les fichiers, ou se demande à Rémi qui la teste en jeu.
- **Emprises = `BuildBlocker`**, pas la boîte englobante du modèle 3D (qui gonflait 74 % des
  bâtiments d'une case par axe).
- **Moteurs en cases entières, éditeur en demi-cases** : les moteurs et leurs golden restent
  inchangés ; un adaptateur fait la conversion.
- **Données extraites versionnées** : l'application et les tests tournent sans le jeu installé.
- **Albion et Latium ne se transposent pas** : jamais appliquer une mesure de l'un à l'autre.
