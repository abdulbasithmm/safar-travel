/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist', 'sans-serif'],
        display: ['Special Elite', 'serif'],
      },
      colors: {
        wandor: {
          dark: '#0a0a0a',
          text: '#1a1a1a',
          muted: '#767676',
          prompt: '#905831',
        },
        safar: {
          navy: '#0F2544',
          navyHover: '#1A3A68',
          sky: '#EBF4FF',
          skySoft: '#F4F9FF',
          skyMid: '#DCEBFF',
          border: '#DCE8F7',
          orange: '#F97316',
          orangeHover: '#EA580C',
          orangeSoft: '#FFF4ED',
          slate: '#4B617C',
        },
      },
    },
  },
  plugins: [],
};
