// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Theme tokens are driven by CSS variables defined in
      // src/styles/globals.css (th3m). Users can override them at
      // runtime via Settings → Appearance — the override hook
      // writes new values to document.documentElement.style.
      // The var() fallback ensures the build still renders even
      // before the runtime hook has mounted.
      colors: {
        obsidianBlack: 'var(--obsidian-black, #1b1b1b)',
        obsidianGray: 'var(--obsidian-gray, #242424)',
        obsidianDarkGray: 'var(--obsidian-dark-gray, #333333)',
        obsidianAccent: 'var(--obsidian-accent, #3a3a3a)',
        obsidianHighlight: 'var(--obsidian-highlight, #4d4d4d)',
        obsidianBorder: 'var(--obsidian-border, #444444)',
        obsidianText: 'var(--obsidian-text, #dadada)',
        obsidianSecondaryText: 'var(--obsidian-secondary-text, #bababa)',
        obsidianAccentPurple: 'var(--obsidian-accent-purple, hsl(254, 80%, 68%))',
      },
      boxShadow: {
        obsidian: '0 2px 8px rgba(0, 0, 0, 0.3)'
      }
    }
  },
  plugins: [require('@tailwindcss/typography')]
}
