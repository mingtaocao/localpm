import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          editor: [
            "@codemirror/view",
            "@codemirror/state",
            "@codemirror/language",
            "@codemirror/lang-json",
            "@codemirror/lang-javascript",
            "@codemirror/lang-html",
            "@codemirror/lang-xml",
          ],
        },
      },
    },
  },
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
});
