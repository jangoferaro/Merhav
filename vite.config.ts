import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const root = path.resolve(import.meta.dirname);

export default defineConfig({
  root: path.resolve(root, "client"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(root, "client", "src"),
      "@shared": path.resolve(root, "shared"),
    },
  },
  build: {
    outDir: path.resolve(root, "dist", "client"),
    emptyOutDir: true,
  },
});
