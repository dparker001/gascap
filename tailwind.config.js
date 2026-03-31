/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          50:  '#f0f4fa',
          100: '#dce6f4',
          200: '#b8cce9',
          300: '#8aadd8',
          400: '#5b8bc4',
          500: '#3a6daf',
          600: '#2c5491',
          700: '#1e3a5f',
          800: '#172d4a',
          900: '#0f1f34',
        },
        amber: {
          50:  '#fffbeb',
          100: '#fef3c7',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
        },
      },
      boxShadow: {
        card:  '0 2px 14px 0 rgba(30,58,95,0.07)',
        amber: '0 4px 16px 0 rgba(245,158,11,0.35)',
        lift:  '0 8px 28px 0 rgba(30,58,95,0.13)',
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto',
          '"Helvetica Neue"', 'Arial', 'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
