/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0b0705",
        char: "#17100c",
        iron: "#2a201a",
        rust: "#7a4326",
        ember: "#ff8a3d",
        flare: "#ffc46b",
        blood: "#8e2b1e",
        parch: "#e8d7b5",
        steel: "#cfd6de",
      },
      fontFamily: {
        display: ['"Cinzel"', '"Trajan Pro"', 'Georgia', 'serif'],
        body: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      letterSpacing: {
        widest2: '0.34em',
      },
    },
  },
  plugins: [],
}
