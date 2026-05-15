/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        orbitron: ['Orbitron', 'sans-serif'],
        rajdhani: ['Rajdhani', 'sans-serif'],
        inter: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        // All color tokens reference CSS variables so theme switching works globally.
        // Tailwind generates e.g. `background-color: rgb(var(--bg-base))` which
        // responds instantly when the html[data-theme] attribute changes.
        bg: {
          base:    'rgb(var(--tw-bg-base) / <alpha-value>)',
          panel:   'rgb(var(--tw-bg-panel) / <alpha-value>)',
          elevated:'rgb(var(--tw-bg-elevated) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--tw-border) / <alpha-value>)',
          glow:    'rgb(var(--tw-border-glow) / <alpha-value>)',
        },
        text: {
          primary:   'rgb(var(--tw-text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--tw-text-secondary) / <alpha-value>)',
          dim:       'rgb(var(--tw-text-dim) / <alpha-value>)',
        },
        accent: {
          cyan:   'rgb(var(--tw-accent-cyan) / <alpha-value>)',
          purple: 'rgb(var(--tw-accent-purple) / <alpha-value>)',
          amber:  'rgb(var(--tw-accent-amber) / <alpha-value>)',
          green:  'rgb(var(--tw-accent-green) / <alpha-value>)',
          red:    'rgb(var(--tw-accent-red) / <alpha-value>)',
        },
      },
      borderRadius: {
        btn: '4px',
      },
    },
  },
  plugins: [],
};
