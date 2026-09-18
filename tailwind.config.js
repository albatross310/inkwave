/** @type {import('tailwindcss').Config} */
export default {
  // hover: rules only where a pointer can actually hover. Without this, iOS keeps the :hover
  // state stuck on the last tapped control (the toolbar's S circle stayed dark after its row had
  // retracted), so a touch screen showed a state that was not true.
  future: { hoverOnlyWhenSupported: true },
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
