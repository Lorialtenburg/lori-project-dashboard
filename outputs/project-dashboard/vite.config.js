import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  base: mode === "github-pages" ? "/lori-project-dashboard/" : "/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
}));
