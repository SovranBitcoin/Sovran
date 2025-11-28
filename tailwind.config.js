const { hairlineWidth } = require('nativewind/theme');
const { THEMES } = require('./themes');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.{js,ts,tsx}', './components/**/*.{js,ts,tsx}', './app/**/*.{js,ts,tsx}'],

  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Existing shadcn/ui colors
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },

        // NativeWind Primary Color System (dynamic using CSS variables)
        // These will be updated by the ThemeProvider at runtime
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

        // All theme colors - dynamically includes all themes from themes.js
        ...THEMES,
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      borderWidth: {
        hairline: hairlineWidth(),
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  future: {
    hoverOnlyWhenSupported: true,
  },
  plugins: [require('tailwindcss-animate')],
};
