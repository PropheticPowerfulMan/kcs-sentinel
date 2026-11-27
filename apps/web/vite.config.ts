import{mandatoryUpdatePlugin}from'./client-runtime/vite.mjs';
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_BASE_PATH?.trim() || (process.env.GITHUB_PAGES === "true" ? "/kcs-sentinel/" : "/"),
  plugins: [react(),mandatoryUpdatePlugin('KCS_SENTINEL')],
  server: {
    host: true,
    port: 5173
  },
  preview: {
    host: true,
    port: 4173
  }
});
