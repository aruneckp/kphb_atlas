import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During `npm run dev` the API calls go to the Python server on port 8046.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { "/api": "http://127.0.0.1:8046" } },
  build: { outDir: "dist", chunkSizeWarningLimit: 800 },
});
