/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b1220",
        panel: "#0f172a",
        panel2: "#111a2e",
        line: "#1f2a44",
        accent: "#7dd3fc",
      },
    },
  },
  plugins: [],
};
