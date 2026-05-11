import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
    base: process.env.GITHUB_PAGES === "true" ? "/kcs-sentinel/" : "/",
    plugins: [react()],
    server: {
        host: true,
        port: 5173
    },
    preview: {
        host: true,
        port: 4173
    }
});
