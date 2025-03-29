import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000, // Optional: keep the same port as CRA if you want
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
      "/sse": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});
