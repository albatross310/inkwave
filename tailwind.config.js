/** @type {import('tailwindcss').Config} */
export default {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          blue: '#2a3b5f',
          light: '#4a5f8a',
        },
        parchment: {
          DEFAULT: '#f7f2e8',
          dark: '#f5f0e4',
        },
      },
      fontFamily: {
        serif: ['"EB Garamond"', '"IM Fell DW Pica"', 'Georgia', 'serif'],
      },
      lineHeight: {
        reading: '1.65',
      },
    },
  },
  plugins: [],
}
