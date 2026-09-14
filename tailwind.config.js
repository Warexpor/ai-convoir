export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        xai: {
          canvas: "#151515",
          "canvas-soft": "#1c1c1c",
          "canvas-card": "#151515",
          ink: "#f4f4f4",
          body: "#dcdcdc",
          mute: "#a3a3a3",
          hairline: "#2a2a2a",
          accent: "#f4f4f4",
          live: "#f54e00",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: {
        pill: "9999px",
      },
      letterSpacing: {
        mono: "0.1em",
      },
      animation: {
        "fade-in": "fade-in 0.15s ease-out",
        "fade-in-up": "fade-in-up 0.22s ease-out",
        "slide-in": "slide-in 0.18s ease-out",
        "pulse-dot": "pulse-dot 1.4s ease-in-out infinite",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          from: { transform: "translateX(8px)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" },
        },
        "pulse-dot": {
          "0%, 80%, 100%": { opacity: "0.3" },
          "40%": { opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
