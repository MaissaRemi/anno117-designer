import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // workers en ES : le worker du plan d'île fait un import() dynamique (hauteurs
  // d'île chargées à la demande) → code-splitting, incompatible avec le format iife
  worker: { format: "es" },
});
