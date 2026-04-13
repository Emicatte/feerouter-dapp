const defaultTheme = require('tailwindcss/defaultTheme')

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', ...defaultTheme.fontFamily.sans],
        mono:    ['var(--font-mono)', ...defaultTheme.fontFamily.mono],
        sans:    ['var(--font-display)', ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [],
}