export default {
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
        extend: {
            colors: {
                surface: "#06101f",
                panel: "#0b1930",
                ink: "#ecf8ff",
                cyan: "#30d8ff",
                neon: "#8f7bff",
                signal: "#1ce7b0"
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
};
