import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Tests LOURDS : les balayages qui font tourner le moteur d'île sur de vraies cartes.
 *
 * Mesuré (`--reporter=json`, 2026-08-22) : ces 11 fichiers pèsent 552 s de CPU sur les
 * 561 s de la suite. Les 46 autres tiennent en 9,2 s À EUX TOUS. La boucle de dev n'a
 * aucune raison de payer les 552 s à chaque sauvegarde — `pnpm test:fast` les écarte,
 * `pnpm test` (et la CI) les garde.
 */
const LOURDS = [
  "src/optimizer/wanted.test.ts",
  "src/optimizer/invariants.test.ts",
  "src/optimizer/islandPlan.test.ts",
  "src/optimizer/slotPlan.test.ts",
  "src/optimizer/patron.test.ts",
  "src/optimizer/workforce.test.ts",
  "src/optimizer/prodPlan.test.ts",
  "src/optimizer/kontor.test.ts",
  "src/optimizer/waterFeasible.test.ts",
  "src/optimizer/multiIslandPlan.test.ts",
  "src/optimizer/planLattice.test.ts",
];

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // workers en ES : le worker du plan d'île fait un import() dynamique (hauteurs
  // d'île chargées à la demande) → code-splitting, incompatible avec le format iife
  worker: { format: "es" },
  // Le chunk eager fait 203 KB gz. MESURÉ, contre l'ancien commentaire de ce fichier qui
  // accusait react-dom : react-dom.production.min.js pèse 42 KB gz, et le gros du chunk est
  // la DONNÉE DE JEU — islands.generated 86 KB gz, catalog 15, economy 15, terrain 11. Les
  // heightmaps (3,6 Mo gz) sont déjà lazy. Le vrai gain restant est de passer
  // islands.generated en import() dynamique (utile au seul sélecteur d'île) ; tant que ce
  // n'est pas fait, on relève le seuil du warning générique de Vite (500 KB).
  build: { chunkSizeWarningLimit: 700 },
  test: {
    // Les agents travaillent dans des worktrees git sous `.claude/worktrees/`. Ils sont
    // gitignorés, mais `.gitignore` ne filtre PAS vitest : sans cette exclusion la suite
    // ramasse les 57 fichiers de test du worktree EN PLUS des 57 de `src/` et tourne
    // deux fois — 561 s de CPU au lieu de 1 295 s. Pire, un worktree périmé fait échouer
    // la suite sur du code déjà abandonné.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      ".claude/**",
      ...(mode === "fast" ? LOURDS : []),
    ],
  },
}));
