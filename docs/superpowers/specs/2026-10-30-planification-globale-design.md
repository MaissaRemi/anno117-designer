# Planification globale d'un monde : conception

Statut : **validée par Rémi le 30/10/2026** (réponses en fin de document). Étapes 1 à 3 faites ; bilan dans `docs/REPRISE.md`.

Demande de Rémi (30/10/2026), reformulée : un outil qui planifie TOUTES les îles d'une partie
sur le long terme, pour un monde « durable et complexe où tout fonctionne ». Il dit combien
d'habitants, d'argent et de Foi le plan permet, il donne le plan de chaque île à reconstruire en
jeu, les échanges de biens entre îles, et il peut proposer d'acheter une île.

## 1. Ce que j'ai compris

**Un nouvel onglet**, qui liste les planifications enregistrées. « Nouvelle planification »
ouvre une grande fenêtre au premier plan, un assistant en étapes :

1. **Nom** de la configuration.
2. **Îles de la carte.** Rémi ne connaît pas le nom interne des îles : il les reconnaît à leur
   forme. Recherche visuelle dans le catalogue des îles (vignettes). Pour chaque île retenue, il
   renseigne ses **fertilités** : minières (gisements), maritimes, terrestres, de rivière.
3. **Propriété** : quelles îles sont à lui. Choix enregistré. Les autres sont à acheter ou à un
   adversaire.
4. **Rôles et calcul.** Rémi choisit une ou plusieurs **îles principales** : uniquement des
   maisons, tous les services, le maximum de gains ; tout y est importé, sauf les mines posées
   sur les emplacements que les aqueducs laissent libres, si la fertilité le permet (or, poisson
   de rivière…). **Toutes les autres îles à lui deviennent des îles de production** : elles
   produisent ce que les îles principales consomment (« 50 000 habitants demandent tant de ceci,
   tant de cela »), réparti au mieux, main-d'œuvre comprise.

**Ce que l'outil rend** : le plan de chaque île (à reconstruire en jeu), les flux entre îles
(« telle île envoie tant de tel bien à telle autre »), le bilan du monde (habitants, argent,
Foi…), et au besoin une **suggestion d'achat** (« acheter cette île débloque tel bien » ou
« augmente la production de tel bien »). Rémi répond si c'est possible, et le moteur recalcule.

## 2. Ce que les données disent déjà (vérifié le 30/10/2026)

- **Un monde, ce sont les deux provinces ensemble.** Parmi les biens que consomment les
  Patriciens du Latium, neuf ne sont produits qu'en Albion (Bière, Fromage, Bœuf rôti, Broches,
  Langues d'oiseau en aspic, Capes, Perruques, Miroirs à main, Chars) ; quatre des Equites, un des
  Plébéiens et des Liberti (Bière). Inversement, sept biens des Nobles ne viennent que du Latium
  (Garum, Savon, Huile d'olive, Statuettes, Toges, Verres précieux, Chaises longues), et le Garum
  manque à tous les paliers d'Albion. Une île principale romaine qui veut « tous les besoins »
  dépend donc d'îles de production EN ALBION : la configuration couvre les deux provinces, et les
  flux traversent de l'une à l'autre.
- **Catalogue des îles** : Latium 27 îles de la réserve + 6 du DLC, Albion 22 (sans les îles
  décoratives, de pirates et de marchands, qui ne se possèdent pas). Leur géométrie (terre, côte,
  relief, emplacements de montagne et de rivière) est déjà chargée.
- **Fertilités, par sorte de terrain** (données du jeu) : terre (lin, raisins, olives, lavande,
  sandaraque ; en Albion orge, herbes, plantes tinctoriales), côte (maquereaux, huîtres, murex ;
  en Albion salicorne, coquillages), montagne (fer, minéral, marbre, or ; en Albion cuivre,
  étain, granite, argent), rivière (esturgeons, or), marais et prairie d'Albion (petits oiseaux,
  castors, poneys), forêt (résine). Le formulaire d'une île ne montre que celles de sa province.
- **Une partie de la mécanique existe déjà** et sera réutilisée telle quelle :
  - île principale : `planIslandImport` (« Remplir l'île ») avec tous les services et l'option
    des emplacements libres après les aqueducs (`exploitSlots`), bornée par les fertilités ;
  - île de production : le moteur de l'île de production (`Commande.objectif`, plusieurs biens,
    productivité du dieu et saisie, imports quand l'île ne peut pas) ;
  - un prototype : l'onglet « Plusieurs îles » (`multiIslandPlan`) répartit déjà population et
    production, avec un profil de ressources par île enregistré (`persist/party.ts`) ;
  - des vignettes d'îles (`IslandPicker`).

## 3. Regard critique : ce que la demande implique, et ses pièges

1. **La demande se nourrit d'elle-même.** Les îles de production logent des ouvriers, qui
   consomment eux aussi des biens (poisson, tuniques, bière…) et réclament leurs services. Ces
   biens doivent être produits quelque part, donc encore des ouvriers. Le calcul est un point
   fixe : quelques tours suffisent, parce que la consommation des ouvriers est faible devant celle
   de la ville. Ces ouvriers comptent aussi dans les habitants, l'argent et la Foi du monde.
2. **Répartir, c'est un problème d'affectation sous contraintes** : chaque bien ne peut aller que
   sur une île de sa province (bâtiments propres à chaque monde), qui a sa fertilité et assez
   d'emplacements de montagne ou de rivière, dans la limite de sa terre et de la main-d'œuvre
   qu'elle peut loger. Un bien rare (une seule île a le gisement) doit passer en premier. Garder
   une chaîne entière sur une île évite des allers-retours, mais une matière première peut devoir
   voyager (minerai d'une île à gisement vers la fonderie d'une autre). Il faut le permettre sans
   en abuser : chaque flux est une route commerciale à entretenir en jeu.
3. **Les routes commerciales ont besoin de distances.** Les quantités par minute se calculent sans
   géographie ; le nombre de navires, non. Sans position des îles sur la carte, le plan donne les
   flux (u/min), pas les navires. Une position approximative (placer les îles sur une mini-carte
   dans l'assistant) permettrait plus tard d'estimer temps de trajet et navires.
4. **L'orientation des îles.** Si le jeu pose une même île tournée d'une partie à l'autre, la
   vignette doit pouvoir pivoter pour qu'on la reconnaisse, et le plan doit être rendu dans
   l'orientation de la partie, sinon le reconstruire en jeu devient un casse-tête. La sauvegarde
   porte un champ de rotation ; à confirmer.
5. **Une mine sur l'île principale n'est pas gratuite** : les exploitations de montagne portent un
   malus de Santé de −2, cumulable, sur les maisons à 20–24 cases, et réclament des ouvriers de
   palier bas. Le moteur doit pouvoir montrer ce qu'elles coûtent en habitants, voire s'abstenir.
6. **Un dieu par île.** Chaque île a son dieu tutélaire. Le moteur peut en proposer un par île de
   production (Cérès pour une île de céréales…). Mais la dévotion suit la Foi de l'île, faible sur
   une île de production peu peuplée : le bonus y sera modeste, et l'outil doit le dire.
7. **Les réglages de la partie changent les chiffres** : consommation des besoins, matières
   premières, taxes, entretien, répartition de la main-d'œuvre (`SetupNeedConsumption`,
   `SetupRawMaterial`, `SetupTaxes`, `SetupMaintenance`, `SetupDistributionWorkforce`… vus dans une
   sauvegarde). Première version : réglages par défaut, signalés. Plus tard : saisie, ou lecture
   d'une sauvegarde.
8. **« Long terme » a deux sens.** Un état final visé (le plan quand tout est construit), ou un
   plan de développement par étapes (les paliers se débloquent peu à peu, l'argent manque au
   début). Première version : l'état final. Les étapes viennent après, sur la même base.
9. **« Maximum de gains » est ambigu** : le plus d'argent, ou le plus d'habitants ? Les deux ne
   donnent pas le même plan (le moteur sait déjà présenter plusieurs plans au choix).
10. **Propriété : quatre états, pas deux** : à moi, achetable, indisponible (adversaire), inconnu.
    Une suggestion d'achat refusée passe l'île en « indisponible », et l'on ne la repropose plus.
    Les fertilités d'une île non possédée peuvent être inconnues : le moteur ne la suggère alors
    que pour sa surface, en le disant.
11. **Deux outils pour la même idée, non.** « Plusieurs îles » est un prototype de ce que décrit
    Rémi. Le nouvel onglet doit le remplacer, pas s'y ajouter (même raisonnement que pour l'île de
    production).

## 4. Performance

- **Deux niveaux de calcul.** La répartition des biens se fait sur des ESTIMATIONS (surface et
  main-d'œuvre par bien, déjà calculées par la nomenclature) : quelques millisecondes, donc on peut
  essayer beaucoup d'affectations. Seules les îles retenues passent par la vraie pose (0,3 à 2 s
  par île de production, plusieurs secondes pour une grande île principale avec recherche de
  recette).
- **Une île par Web Worker, en parallèle** : avec 8 îles, le temps est celui de la plus lente, pas
  la somme. Progression affichée île par île.
- **Cache par île** : le plan d'une île ne dépend que de ses entrées (île, rotation, fertilités,
  biens affectés, dieu, réglages). Une empreinte de ces entrées évite de recalculer ce qui n'a pas
  changé — essentiel pour la boucle « suggestion d'achat → recalcul ».
- **Boucle courte** : pose réelle, écart entre demandé et posé, réaffectation du reste, au plus
  deux ou trois tours.
- **Stockage** : une configuration avec les plans de huit îles pèse quelques mégaoctets ;
  `localStorage` plafonne autour de 5 Mo pour tout le site. Les configurations vont dans
  IndexedDB, avec export et import en fichier JSON (sauvegarde, partage).
- **Déterminisme** : mêmes entrées, même plan. Les moteurs le sont déjà.

## 5. Modèle de données (première version)

```ts
interface ConfigurationMonde {
  id: string; nom: string; creeLe: string; modifieLe: string;
  reglages: { productivite?: { globale?: number; parAtelier?: Record<string, number> } };
  iles: IleDuMonde[];
  resultat?: ResultatMonde; // dernier calcul, avec les empreintes pour le cache
}
interface IleDuMonde {
  ileId: string;            // id du catalogue (roman_island_large_03…)
  libelle?: string;         // le nom de l'île dans la partie, pour s'y retrouver
  rotation?: 0 | 90 | 180 | 270;
  propriete: "moi" | "achetable" | "indisponible" | "inconnue";
  fertilites: string[] | null; // null : inconnues
  role: "principale" | "production" | "auto";
  dieu?: string;
}
```

## 6. Le calcul, dans l'ordre

1. **Îles principales** : plan de population (tous les services, objectif à préciser), mines
   sur les emplacements restants. Sortie : population, argent, et la demande de biens.
2. **Demande totale** : celle des îles principales, moins ce que leurs mines produisent.
3. **Affectation** aux îles de production : biens les plus contraints d'abord (moins d'îles
   éligibles), capacité de chaque île estimée (terre, emplacements, main-d'œuvre logeable), un bien
   partageable entre îles. Les ouvriers ajoutent leur demande : on reboucle jusqu'à stabilité.
4. **Pose réelle** de chaque île de production (moteur de l'île de production, plusieurs biens),
   en parallèle. Ce qui n'a pas tenu est réaffecté.
5. **Reste non couvert** → suggestions d'achat : les îles achetables qui couvrent le manque,
   classées par ce qu'elles débloquent. Rémi accepte ou refuse ; recalcul incrémental.
6. **Rapport** : bilan du monde, plan et bilan de chaque île, flux entre îles (u/min, par bien).

## 7. Étapes, chacune livrable et mesurable

1. **L'onglet et l'assistant, sans moteur** : liste des configurations, création, recherche
   visuelle des îles (vignettes, filtre par province et taille, rotation), fertilités par île,
   propriété. Enregistré (IndexedDB), rouvrable, exportable.
2. **Îles principales** : plan et demande de biens, mines sur les emplacements libres.
3. **Répartition et îles de production**, flux entre îles, bilan du monde. Remplace
   « Plusieurs îles ».
4. **Suggestions d'achat** et recalcul incrémental (cache).
5. **Plus tard** : positions sur une mini-carte et navires, plan de développement par étapes,
   réglages de partie, import d'une sauvegarde.

## 8. Questions pour Rémi

1. **« Maximum de gains »** sur l'île principale : le plus d'argent, le plus d'habitants, ou
   plusieurs plans au choix entre les deux ?
2. **Une configuration couvre-t-elle les deux provinces ?** Les données disent que les besoins
   complets des Patriciens passent par l'Albion. On peut bien envoyer des biens d'une province à
   l'autre en jeu, et y a-t-il une contrainte particulière (temps de trajet, comptoir) ?
3. **Les îles sont-elles tournées d'une partie à l'autre** sur la carte ? (Recherche visuelle et
   orientation du plan rendu.)
4. **Remplacer l'onglet « Plusieurs îles »** par le nouvel outil ?
5. **Où placer l'onglet** : dans la barre de gauche à côté d'Éditeur et Planifier (« Monde »),
   ou comme un mode de Planifier ?
6. **Première version sans navires** (flux en u/min seulement) : d'accord ?

## 9. Réponses de Rémi (30/10/2026)

1. **Objectif des îles principales** : trois au choix pour commencer — le maximum de gains
   (argent), le maximum d'habitants, le maximum de maisons. D'autres réglages viendront.
   L'objectif « argent » n'existe pas encore dans `planIslandImport` (il sait « habitants » et
   « maisons ») : à ajouter à l'étape 2.
2. **Biens entre provinces** : oui, dans les deux sens, « c'est tout l'intérêt ». Le temps de
   trajet dépend du navire, du vent, de la cargaison et des objets équipés ; il est IGNORÉ en
   régime établi : la production d'un aller-retour arrive en une fois, la mise en place est plus
   lente mais le débit à terme est le même. Une configuration couvre donc les deux provinces.
3. **Les îles peuvent apparaître tournées.** Première version : reconnaissance visuelle, c'est à
   l'utilisateur de voir si l'île est tournée. Piste pour plus tard : reconnaître les îles sur une
   capture de la mini-carte.
4. **Le nouvel outil remplace « Plusieurs îles »** (à l'étape 3, quand il sait faire mieux).
5. **L'onglet va dans la colonne de gauche**, sous Planifier : « Monde ».
6. **Première version sans navires** : flux en u/min. Les navires plus tard.
