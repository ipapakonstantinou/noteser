// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        obsidianBlack: '#1b1b1b',
        obsidianGray: '#242424',
        obsidianDarkGray: '#333333',
        obsidianAccent: '#3a3a3a',
        obsidianHighlight: '#4d4d4d',
        obsidianBorder: '#444444',
        obsidianText: '#dadada',
        obsidianSecondaryText: '#bababa',
        obsidianAccentPurple: 'hsl(254, 80%, 68%)'
      },
      boxShadow: {
        obsidian: '0 2px 8px rgba(0, 0, 0, 0.3)'
      }
    }
  },
  plugins: [require('@tailwindcss/typography')]
}
