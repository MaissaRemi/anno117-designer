import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // workers en ES : le worker du plan d'île fait un import() dynamique (hauteurs
  // d'île chargées à la demande) → code-splitting, incompatible avec le format iife
  worker: { format: "es" },
  // le seul gros chunk eager est react-dom (~179 KB gz, irréductible) ; les heightmaps
  // (~4.7 Mo) sont DÉJÀ lazy (import dynamique). Pas de manualChunks (rien d'autre à
  // splitter) — on relève juste le seuil du warning générique de Vite (500 KB).
  build: { chunkSizeWarningLimit: 700 },
});
