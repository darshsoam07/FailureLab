export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ...Object.fromEntries([
          'background', 'foreground', 'surface', 'surface-elevated', 'surface-dark',
          'primary', 'primary-foreground', 'secondary', 'accent', 'accent-foreground',
          'accent-ink', 'border', 'input', 'focus-ring', 'muted', 'muted-foreground',
          'success', 'warning', 'destructive', 'danger-button', 'on-destructive',
          'simulated', 'chart-series', 'chart-secondary', 'sidebar', 'sidebar-active',
        ].map(role => [role, `var(--${role})`])),
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
