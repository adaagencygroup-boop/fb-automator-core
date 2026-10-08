/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        cyber: {
          darkest: "#080a0f",
          dark: "#0b0e14",
          card: "#111827",
          cardHover: "#162032",
          border: "#1e293b",
          cyan: "#00f0ff",
          blue: "#38bdf8",
          green: "#10b981",
          amber: "#f59e0b",
          red: "#ef4444",
        },
      },
    },
  },
  plugins: [],
};
