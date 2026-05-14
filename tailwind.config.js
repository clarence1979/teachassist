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
        bg: {
          base: '#050a14',
          panel: '#0a1628',
          elevated: '#0f1f3a',
        },
        border: {
          DEFAULT: '#1e3a5f',
          glow: '#2563eb33',
        },
        text: {
          primary: '#e0e6f0',
          secondary: '#94a3b8',
          dim: '#64748b',
        },
        accent: {
          cyan: '#22d3ee',
          purple: '#a855f7',
          amber: '#f59e0b',
          green: '#22c55e',
          red: '#ef4444',
        },
      },
      borderRadius: {
        btn: '4px',
      },
    },
  },
  plugins: [],
};
