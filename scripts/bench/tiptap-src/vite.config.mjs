import { defineConfig } from 'vite'
// Relative base so the built assets load under /tiptap/ on the static server.
export default defineConfig({
  base: './',
  build: { outDir: '../static/tiptap', emptyOutDir: true },
})
