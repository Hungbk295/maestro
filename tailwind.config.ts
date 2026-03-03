import type { Config } from "tailwindcss";

/** Reference a CSS variable RGB triplet with alpha support */
const rgb = (varName: string) =>
  `rgb(var(--maestro-${varName}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        maestro: {
          bg: rgb("bg"),
          surface: rgb("surface"),
          card: rgb("card"),
          border: rgb("border"),
          text: rgb("text"),
          muted: rgb("muted"),
          accent: rgb("accent"),
          green: rgb("green"),
          red: rgb("red"),
          orange: rgb("orange"),
          yellow: rgb("yellow"),
          purple: rgb("purple"),
        },
      },
      fontFamily: {
        sans: [
          "IBM Plex Sans",
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "Fira Code",
          "Cascadia Code",
          "monospace",
        ],
      },
      boxShadow: {
        "elevation-1": "var(--shadow-1)",
        "elevation-2": "var(--shadow-2)",
        "elevation-3": "var(--shadow-3)",
        "elevation-4": "var(--shadow-4)",
        "glow-accent": "var(--shadow-glow-accent)",
      },
    },
  },
  plugins: [],
} satisfies Config;
