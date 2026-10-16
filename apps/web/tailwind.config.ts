import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: "#052c4e",
        panel: "#073d5e",
        ink: "#ecf8ff",
        cyan: "#20b8d8",
        neon: "#27c6a7",
        signal: "#f2b84b"
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
