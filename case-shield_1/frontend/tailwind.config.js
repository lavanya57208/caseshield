/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#0B1F33",
          50: "#EBEEF1",
          100: "#D3DAE1",
          200: "#A7B5C3",
          300: "#7B90A5",
          400: "#4F6B87",
          500: "#2E4A66",
          600: "#1B3350",
          700: "#0B1F33",
          800: "#081827",
          900: "#05101A",
        },
        slateblue: {
          DEFAULT: "#29465B",
          light: "#3E5F76",
          dark: "#1D3140",
        },
        teal: {
          DEFAULT: "#0F766E",
          light: "#14958A",
          dark: "#0B5850",
        },
        success: {
          DEFAULT: "#16803C",
          light: "#1E9A4A",
          bg: "#E7F5EC",
        },
        warning: {
          DEFAULT: "#B7791F",
          light: "#D08F2E",
          bg: "#FBF1E1",
        },
        danger: {
          DEFAULT: "#B42318",
          light: "#D92D20",
          bg: "#FBEAE8",
        },
        surface: "#F5F8FA",
        card: "#FFFFFF",
        ink: "#172B3A",
        "ink-muted": "#4B5D6B",
        "ink-subtle": "#7A8A96",
        border: {
          DEFAULT: "#DCE3E8",
          strong: "#B9C5CC",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(11,31,51,0.06), 0 1px 3px 0 rgba(11,31,51,0.08)",
        panel: "0 4px 12px 0 rgba(11,31,51,0.08)",
      },
      spacing: { 4.5: "1.125rem", 5.5: "1.375rem" },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "pop-in": { from: { opacity: "0", transform: "translateY(6px) scale(0.99)" }, to: { opacity: "1", transform: "none" } },
        "slide-in": { from: { opacity: "0", transform: "translateX(12px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        "pop-in": "pop-in 180ms ease-out",
        "slide-in": "slide-in 200ms ease-out",
      },
      borderRadius: {
        md: "6px",
        lg: "8px",
        xl: "12px",
      },
    },
  },
  plugins: [],
};
