import { defineConfig } from 'wxt'
import { resolve } from 'path'

export default defineConfig({
  extensionApi: 'chrome',
  vite: () => ({
    resolve: {
      alias: {
        // Allow extension entrypoints to import from the main src tree.
        '@inkwave/citations': resolve(__dirname, '../src/citations'),
        '@inkwave/types': resolve(__dirname, '../src/types'),
      },
    },
  }),
  manifest: ({ browser }) => ({
    name: 'Inkwave Citation Capture',
    description: 'Capture citations from any page into your Inkwave writing studio — one click for journal articles, AI-assisted for blogs.',
    permissions: ['activeTab', 'storage', 'scripting'],
    commands: {
      capture: {
        suggested_key: {
          default: 'Alt+Shift+C',
        },
        description: 'Capture citation from current page',
      },
    },
    host_permissions: [
      'https://inkwave.me/*',
      'http://localhost:5173/*',
      'https://api.crossref.org/*',
      'https://export.arxiv.org/*',
      'https://openlibrary.org/*',
      'https://eutils.ncbi.nlm.nih.gov/*',
    ],
    ...(browser === 'firefox' ? {
      browser_specific_settings: {
        gecko: {
          id: 'citation-capture@inkwave.me',
          strict_min_version: '109.0',
        },
      },
    } : {}),
  }),
})
