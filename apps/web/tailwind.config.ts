import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#2a2032",
        panel: "#36283d",
        ink: "#f3ebf5",
        cyan: "#d2b4dc",
        neon: "#bc9acb",
        signal: "#d9c89f"
      },
      boxShadow: {
        glow: "0 0 40px rgba(48, 216, 255, 0.18)"
      },
      backgroundImage: {
        grid: "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)"
      }
    }
  },
  plugins: []
} satisfies Config;
