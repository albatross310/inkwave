/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          blue: '#2a3b5f',
          light: '#4a5f8a',
        },
        parchment: {
          DEFAULT: '#fdfaf3',
          dark: '#f5f0e4',
        },
      },
      fontFamily: {
        serif: ['"IM Fell DW Pica"', '"EB Garamond"', 'Georgia', 'serif'],
      },
      lineHeight: {
        reading: '1.65',
      },
    },
  },
  plugins: [],
}
