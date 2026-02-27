/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.{js,ts,tsx}', './components/**/*.{js,ts,tsx}', './app/**/*.{js,ts,tsx}'],

  theme: {
    extend: {
      colors: {
        // App palette tokens mapped from CSS variables in global.css @theme.
        primary: {
          950: 'var(--color-primary-950)',
          900: 'var(--color-primary-900)',
          800: 'var(--color-primary-800)',
          700: 'var(--color-primary-700)',
          600: 'var(--color-primary-600)',
          500: 'var(--color-primary-500)',
          400: 'var(--color-primary-400)',
          300: 'var(--color-primary-300)',
          200: 'var(--color-primary-200)',
          100: 'var(--color-primary-100)',
          50: 'var(--color-primary-50)',
          0: 'var(--color-primary-0)',
        },

        // Shade colors (persist across themes)
        shade: {
          100: 'var(--color-shade-100)',
          200: 'var(--color-shade-200)',
          300: 'var(--color-shade-300)',
          400: 'var(--color-shade-400)',
          500: 'var(--color-shade-500)',
        },

        // Red colors
        red: {
          100: 'var(--color-red-100)',
          200: 'var(--color-red-200)',
          300: 'var(--color-red-300)',
          400: 'var(--color-red-400)',
          500: 'var(--color-red-500)',
        },

        // Green colors
        green: {
          100: 'var(--color-green-100)',
          200: 'var(--color-green-200)',
          300: 'var(--color-green-300)',
          400: 'var(--color-green-400)',
          500: 'var(--color-green-500)',
        },

        // Purple colors
        purple: {
          100: 'var(--color-purple-100)',
          200: 'var(--color-purple-200)',
          300: 'var(--color-purple-300)',
          400: 'var(--color-purple-400)',
          500: 'var(--color-purple-500)',
        },

        // Dominant colors (5 visually distinct colors from theme background)
        // Use: bg-dominant-100, text-dominant-300, border-dominant-500, etc.
        dominant: {
          100: 'var(--color-dominant-100)',
          200: 'var(--color-dominant-200)',
          300: 'var(--color-dominant-300)',
          400: 'var(--color-dominant-400)',
          500: 'var(--color-dominant-500)',
        },

        // Gradient colors (light → mid → dark from theme background)
        // Use: bg-gradient-100 (light), bg-gradient-200 (mid), bg-gradient-300 (dark)
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
