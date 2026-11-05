import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // Override when the API runs elsewhere, e.g. API_PROXY_TARGET=http://localhost:4100
        target: process.env.API_PROXY_TARGET ?? "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": "/src",
    },
  },
});
