var _a;
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
    base: ((_a = process.env.VITE_BASE_PATH) === null || _a === void 0 ? void 0 : _a.trim()) || (process.env.GITHUB_PAGES === "true" ? "/kcs-sentinel/" : "/"),
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
