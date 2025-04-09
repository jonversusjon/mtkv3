// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", // Ensure this covers your file types
  ],
  theme: {
    extend: {
      lineHeight: {
        'overlap-sm': '0.9',
        'overlap-md': '0.75',
        'overlap-lg': '0.6',
      }
    },
  },
  plugins: [],
};


