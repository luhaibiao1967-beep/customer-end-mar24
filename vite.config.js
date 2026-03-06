import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: [
      "9ff64h-5173.csb.app",
      "improved-space-capybara-69qq5wxp6rrrf5q4g-5173.app.github.dev",
    ],
    proxy: {
      "/supabase": {
        target: "http://127.0.0.1:54321",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/supabase/, ""),
      },
    },
  },
});
