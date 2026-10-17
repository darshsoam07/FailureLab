export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: { ink: '#090d14', panel: '#101722', edge: '#253244', mint: '#71e4c2' },
      fontFamily: { sans: ['Inter', 'Segoe UI', 'sans-serif'], mono: ['Cascadia Code', 'Consolas', 'monospace'] },
    },
  },
  plugins: [],
};
