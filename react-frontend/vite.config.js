import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const proxyTarget = process.env.VITE_PROXY_TARGET || "http://localhost:5000";

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  // The production bundle is served by Flask under /static/react/ (see
  // flask_backend/app.py), so asset URLs must carry that prefix. The dev
  // server keeps "/".
  base: command === "build" ? "/static/react/" : "/",
  build: {
    outDir: "../flask_backend/static/react",
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    host: process.env.VITE_HOST || "localhost",
    proxy: {
      "/api": { target: proxyTarget, changeOrigin: true },
      "/sse": { target: proxyTarget, changeOrigin: true },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.js"],
    include: ["src/**/*.test.{js,jsx}"],
  },
}));
