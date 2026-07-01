/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.{js,ts,tsx}', './components/**/*.{js,ts,tsx}', './app/**/*.{js,ts,tsx}'],

  theme: {
    extend: {
      colors: {
        dominant: {
          100: 'var(--color-dominant-100)',
          200: 'var(--color-dominant-200)',
          300: 'var(--color-dominant-300)',
          400: 'var(--color-dominant-400)',
          500: 'var(--color-dominant-500)',
        },
        gradient: {
          100: 'var(--color-gradient-100)',
          200: 'var(--color-gradient-200)',
          300: 'var(--color-gradient-300)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
};
