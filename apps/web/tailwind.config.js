export default {
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
        extend: {
            colors: {
                surface: "#092921",
                panel: "#103c31",
                ink: "#f0f7f0",
                cyan: "#9edac1",
                neon: "#80c7a9",
                signal: "#e2c78d"
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
