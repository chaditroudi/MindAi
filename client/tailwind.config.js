/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{html,ts}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'Segoe UI', 'Noto Sans Arabic', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
