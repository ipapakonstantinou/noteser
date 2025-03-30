/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        obsidianBlack: "#1b1b1b", // Dark black for background
        obsidianGray: "#242424", // Gray for sidebar
        obsidianAccent: "#3a3a3a", // Accent gray for hover states
      },
    },
  },
  plugins: [],
};
