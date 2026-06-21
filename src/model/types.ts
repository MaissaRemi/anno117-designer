// Modèle de données central de l'éditeur Anno 117.

export type Rotation = 0 | 90 | 180 | 270;

export type RadiusKind = "service" | "boost";

export interface RadiusSpec {
  kind: RadiusKind;
  range: number; // portée en cases
}

export interface FieldSpec {
  tiles: number; // nombre de cases de champ requises
  fieldType: string; // type de champ (ex: "ble", "houblon")
}

export interface ProductionGood {
  good: string;
  amount: number;
}

export interface ProductionSpec {
  cycleTime: number | null; // secondes par cycle
  outputs: ProductionGood[];
  inputs: ProductionGood[];
}

/** Définition catalogue : gabarit réutilisable d'un type de bâtiment. */
export interface BuildingDef {
  id: string;
  name: string;
  category: string; // production | public | residentiel | ornement | militaire | ...
  size: { w: number; h: number };
  rotatable: boolean;
  needsRoad: boolean;
  placement?: "land" | "water"; // "water" = se pose sur l'eau/la côte (défaut land)
  transporterRange?: number; // prod : distance-rue max vers un entrepôt (défaut 30)
  template?: string; // template du jeu (SlotFactoryBuilding7 = mines, Warehouse…)
  freeArea?: { radius: number; area: number }; // prod ∝ cases libres dans le rayon
  unique?: boolean; // BuildingUnique : 1 exemplaire max sur l'île (Colisée…)
  radius?: RadiusSpec;
  field?: FieldSpec;
  color: string; // couleur de rendu (#rrggbb)

  // --- champs issus de l'extraction des données du jeu (optionnels) ---
  guid?: number; // GUID Anno 117
  nameInternal?: string; // nom dev anglais
  region?: string; // Roman (Latium) | Celtic (Albion) | ...
  icon?: string; // chemin relatif vers l'icône (ex: icons/xxx.png)
  streetRange?: number; // portée le long des rues (rayons publics)
  production?: ProductionSpec;
  roadRoot?: boolean; // comptoir/entrepôt : racine du réseau de routes
}

/** Instance d'un bâtiment posé sur la grille. */
export interface PlacedBuilding {
  uid: string;
  defId: string;
  x: number; // coin haut-gauche
  y: number;
  rotation: Rotation;
  locked: boolean; // true => fixe, ignoré par l'optimiseur
}

export interface FieldTile {
  x: number;
  y: number;
  ownerUid: string; // uid du bâtiment propriétaire du champ
  fieldType: string;
}

export interface RoadTile {
  x: number;
  y: number;
  gen?: boolean; // true = route générée par l'optimiseur (remplaçable au re-calcul)
}

/** Tuile de conduite d'aqueduc (réseau d'eau, distinct des routes). */
export interface AqueductTile {
  x: number;
  y: number;
  gen?: boolean; // true = générée par le planificateur (remplaçable au re-calcul)
}

/** Slot de ressource du terrain (montagne/rivière/marais) — extrait du jeu. */
export interface GridSlot {
  type: string; // "mountain" | "river" | "marsh"
  x: number;
  y: number;
}

/** Grille de forme libre : masque des cases utilisables. */
export interface GridShape {
  w: number;
  h: number;
  usable: boolean[]; // longueur w*h, index = y*w + x — cases TERRE constructibles
  water?: boolean[]; // optionnel : cases EAU/mer (pour bâtiments côtiers). Îles surtout.
  rivers?: boolean[]; // optionnel : cases RIVIÈRE (argile, slots river)
  slots?: GridSlot[]; // optionnel : slots de ressource (mines, argile, source d'aqueduc)
  islandId?: string; // optionnel : île d'origine (accès aux données terrain — hauteurs)
}

export interface Layout {
  grid: GridShape;
  buildings: PlacedBuilding[];
  fields: FieldTile[];
  roads: RoadTile[];
  aqueducts?: AqueductTile[]; // optionnel (compat persistance) : conduites d'eau
}

/** Catalogue persistant des définitions de bâtiments. */
export type Catalog = BuildingDef[];

export interface Cell {
  x: number;
  y: number;
}
