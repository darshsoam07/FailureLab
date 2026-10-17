export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Legacy aliases mapped to Stitch palette
        ink: '#0B1020',
        panel: '#121A2F',
        edge: '#1E2942',
        mint: '#00e5ff',
        // Stitch design system tokens
        'surface-lowest': '#080d1d',
        'surface-bg': '#0B1020',
        'surface-card': '#121A2F',
        'surface-border': '#1E2942',
        'surface-border-hover': '#22304D',
        'cyan-glow': '#00e5ff',
        'cyan-dim': '#00daf3',
        'emerald-accent': '#10B981',
        'amber-accent': '#f59e0b',
        'error-accent': '#ef4444',
        'violet-accent': '#8B5CF6',
        'text-primary': '#dee1f9',
        'text-secondary': '#849396',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
