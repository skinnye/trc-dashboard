import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:        '#0b0f17',
        surface:   '#111827',
        surface2:  '#1f2937',
        border:    '#263041',
        muted:     '#9ca3af',
        text:      '#e5e7eb',
        accent:    '#6366f1',
        accent2:   '#8b5cf6',
        good:      '#34d399',
        warn:      '#fbbf24',
        bad:       '#f43f5e',
        f1:        '#60a5fa',
        f2:        '#34d399',
        f3:        '#fbbf24',
        f4:        '#f97316',
        perim:     '#6366f1',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 4px 20px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)',
        glow: '0 0 30px rgba(99,102,241,0.25)',
      },
    },
  },
  plugins: [],
};
export default config;
