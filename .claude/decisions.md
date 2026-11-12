# Décisions structurantes, et pourquoi

Chaque entrée : la décision, sa raison, où elle vit. Détail et mesures : `docs/REPRISE.md` et les
documents datés de `docs/superpowers/`. Les plus récentes en premier.

## Planification d'un monde

- **Les mines d'une île principale s'échangent après coup** (12/11, `reaffecterMines`) : le
  moteur d'île les choisit au prix de vente, sans connaître le monde. Plutôt que de replanifier
  l'île (dix à quarante secondes), on échange le bâtiment posé contre un autre de même
  emplacement, même emprise et même main-d'œuvre, pour le bien qui manque le plus. Les mines
  de montagne d'une province ont toutes la même emprise (8 × 3) et la même main-d'œuvre.
- **Un devis se corrige en le mesurant contre la pose** (11/11) : pour chaque bien, ce que la
  répartition promet à une île seule, puis ce que le moteur pose. Trois erreurs trouvées ainsi,
  aucune sur les fermes que l'on soupçonnait : l'aire libre oubliée, la côte, les emplacements.
- **La côte se compte en bâtiments, sur la carte** (11/11, `capaciteCote`) : un pourcentage de
  la bande d'eau par province promettait 30 marais salants là où 18 tiennent. La pose en tient
  77 à 86 % (`COTE_TENUE` = 0,75) ; côte et emplacements se comptent en bâtiments entiers.
- **L'île principale se conseille en la planifiant** (11/11, exigence E5) : chaque île à moi
  est posée seule en île principale par le vrai moteur, puis classée selon l'objectif de la
  partie. Aucun modèle d'estimation à entretenir ; quelques secondes par île, en parallèle.
- **Le rattrapage part du monde posé** (11/11) : ce qui manque est la consommation moins la
  production des plans réels, réparti sur trois tours au plus. Une île est jugée sur sa terre
  réellement prise et n'est écartée que pour le bien qu'elle n'a pas tenu.
- **La version des moteurs est dans l'empreinte** (11/11, `VERSION_CALCUL`) : à augmenter
  quand un moteur d'île change ce qu'il pose, sinon un monde déjà calculé garde ses vieux plans.

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

- **Le maximum d'une île de production se cherche en posant** (12/11, `commande/maximum.ts`) :
  aucune formule ne donne ce qu'une île tient (formes, côte, emplacements, quartiers
  d'ouvriers). Les débits sont des proportions ; on pose, on lit ce qui a tenu, on monte selon
  la terre restée libre ou on coupe en deux. Les proportions sont strictes : un bien borné
  par les emplacements plafonne tous les autres, et le plan le dit.
- **Un lot de production se coupe en demi-chaînes et se traite par niveau de taille** (11/11) :
  coupé entre ses lignes et en profondeur d'abord, une moitié ne produisait rien sans l'autre
  et le premier bien prenait toute la terre. Faute de rectangle libre, un petit lot est posé
  dans la forme de la terre libre.
- **L'aire libre fait partie du plan** (11/11) : cases de champ de type `AIRE_LIBRE`, limitées
  à l'aire exigée. Avant, elle n'existait que dans le placeur et le joueur voyait une terre vide.

- **Les exigences de Rémi passent avant le nombre d'habitants** (10/11, audit) : elles sont
  écrites dans `.claude/exigences.md` et tenues par le panneau `optimizer/qualite.panneau.test.ts`,
  dont les seuils ne se relâchent qu'avec son accord.
- **Îlots partiels dans « Ma commande », en dernier recours** (10/11) : un îlot entamé par la
  côte entre dans la ville comme îlot de services aux cases hors terre déjà prises, quand plus
  aucun îlot entier n'est rattachable. Sans eux un îlot écarté coupait les routes vers les îlots
  entiers derrière lui (333 Patriciens logés sur 450, 56 % de vide) ; mêlés aux entiers ils
  bordaient le relief et gênaient les aqueducs.
- **Trois façons de poser une commande, la première qui loge tout** (10/11) : copies espacées
  avec îlots partiels, copies resserrées sans, copies resserrées avec. Aucune ne gagne sur
  toutes les îles ; le choix se fait sur les maisons logées, mesurées avec les hauteurs.
- **Une copie de plus doit valoir sa portée** (10/11, `PART_GAIN` = 0,1) : un dixième de la
  capacité d'une copie, sinon elle se posait pour deux maisons de bordure. Loger la commande
  prime sur l'espacement.
- **Une grappe de petits services par tranche de portée** dans `planLattice` (10/11,
  `TRANCHE` = 1,25, choisi par Rémi) : un service moyen n'est plus répété au pas d'un puits, et
  les services de portées différentes ne sont plus collés. Moins de pâtés (75–83 % → 40–65 % en
  pavée) contre des maisons déplacées : autant au palier au total, mais pas île par île.
- **Jamais deux copies d'un même service côte à côte** dans `planLattice` (11/11) : une
  position à moins d'un quart de l'espacement permis d'une copie du même type est écartée
  (deux Temples à 23 cases en chemin de terre). Coût mesuré sur medium_01 en terre : 39 maisons
  au palier.

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

## Documentation

- **`REPRISE.md` ne porte que l'état et la suite** (11/11) : il est chargé à chaque session.
  Le détail d'un chantier terminé part dans `docs/archive/`, avec les anciens audits et les
  anciens documents d'état ; `docs/superpowers/` garde les conceptions et plans datés.

## Campagne du 12/11/2026 (carte blanche de Rémi, code délégué à des agents Opus)

- **Un calage de la trame n'est gardé que sans recul d'exigence.** La recette gagnante de
  « Remplir l'île » est rejouée sous quatre calages ; un candidat doit battre le plan ET ne
  faire reculer ni les maisons au palier, ni les pâtés, ni l'espacement. Raison : les exigences
  de Rémi passent avant le gain d'habitants ; aucune île ne peut y perdre.
- **Services hors grappe calés contre une ligne et une épine, sans anneau de route.** Raison :
  l'anneau coûte 6 à 8 % de la terre et 70 % de ses cases ne bordent aucune maison. Supprimer
  l'anneau SANS caler le service est réfuté (couverture perdue, pâtés, temps triplé).
- **Les champs poussent d'un seul tenant depuis la ferme** (règle du jeu,
  `GAME_MECHANICS.md` §5). Raison : posés par anneaux, ils étaient en morceaux sur 18 fermes
  sur 19, donc inconstructibles. La référence du lot « pain ×2 » passe de 529 à 600 cases,
  avec l'accord de Rémi (12/11).
- **Côtiers et exploitations avant les lots.** Raison : les champs des lots muraient la côte
  et les abords des emplacements.
- **La répartition compte 75 % de la terre** (`REMPLISSAGE`, 65 % avant). Raison : la pose en
  tient 78 à 84 % au débit maximal ; à 80 % des bâtiments restent sans place. Le résultat dit
  quel budget a manqué, parce que « plus assez de place » cachait que la côte et la montagne
  bornent le monde.
- **Le cliquet de la part posée est à 99, pas 100.** La mesure est 99,6 % : un seuil arrondi
  au-dessus casserait au moindre bruit.
