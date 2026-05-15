import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        newtab: resolve(__dirname, "newtab.html"),
        aiFloat: resolve(__dirname, "ai-float.html"),
        settings: resolve(__dirname, "settings.html"),
        panelOverlay: resolve(__dirname, "panel-overlay.html"),
      },
    },
  },
});