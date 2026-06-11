import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        line: "var(--line)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        signal: "var(--signal)",
        "signal-ink": "var(--signal-ink)",
        tier: {
          unstable: "var(--tier-unstable)",
          developing: "var(--tier-developing)",
          somewhat: "var(--tier-somewhat)",
          settled: "var(--tier-settled)",
          stable: "var(--tier-stable)",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.6s cubic-bezier(0.2,0.7,0.2,1) both",
        "scale-in": "scale-in 0.5s cubic-bezier(0.2,0.7,0.2,1) both",
      },
    },
  },
  plugins: [],
} satisfies Config;
