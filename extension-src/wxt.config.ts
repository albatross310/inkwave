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
        // The reader↔extension wire is declared in src/reader/extensionProtocol.ts and imported
        // here. One definition; the app is where it lives because the app is the only side that
        // can't import from the other.
        '@inkwave/reader': resolve(__dirname, '../src/reader'),
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
      'https://iwzero.me/*', // canonical app domain
      'https://inkwave.studio/*', // legacy alias (301s to iwzero.me)
      'http://localhost:5173/*',
      'https://api.crossref.org/*',
      'https://export.arxiv.org/*',
      'https://openlibrary.org/*',
      'https://www.googleapis.com/*', // Google Books ISBN fallback (citations/lookup.ts)
      'https://eutils.ncbi.nlm.nih.gov/*',
    ],
    // ── FETCHING PAGES FOR THE SOURCE READER ──────────────────────────────────────────────────
    // Peter, 2026-08-28: "is it possible for us to run the window from the user's IP?" It is, and
    // this permission is the whole of what makes it possible: an MV3 worker's `fetch` to some
    // origin needs host permission for THAT origin, and nothing narrower can serve a reader who
    // types an address.
    //
    // ⚠ WHY `<all_urls>` AND WHY *OPTIONAL*, WHICH ARE TWO SEPARATE DECISIONS.
    //
    // `<all_urls>` rather than a list, because the list would be a lie. The reader's whole job is
    // to open whatever the writing cites, and the set of things an honours thesis cites is not
    // enumerable. A list would give the feature TWO behaviours that look identical from the
    // outside — works here, silently falls back to the server there — which is precisely the
    // "mechanism with no surface" failure this codebase keeps writing down. If the address bar
    // accepts anything, the permission has to.
    //
    // OPTIONAL rather than required, because a REQUIRED `<all_urls>` rewrites the install prompt
    // for every user into "Read and change all your data on all websites", including the users who
    // only ever press Alt+Shift+C on a DOI page. The capture extension's own permissions do not
    // change; page fetching is a separate thing you turn on, once, from the popup — and until you
    // do, the reader keeps working exactly as it does today, through the server. Chrome requires
    // `permissions.request()` to run inside a user gesture in an EXTENSION PAGE, which is why the
    // grant lives in the popup and not in the app or the background worker.
    //
    // Firefox (WXT builds MV2 there) has no `optional_host_permissions` key — host patterns go in
    // `optional_permissions` — so the same grant is spelled the way that manifest version spells it.
    ...(browser === 'firefox'
      ? { optional_permissions: ['<all_urls>'] }
      : { optional_host_permissions: ['<all_urls>'] }),
    ...(browser === 'firefox' ? {
      browser_specific_settings: {
        gecko: {
          id: 'citation-capture@inkwave.studio',
          strict_min_version: '109.0',
        },
      },
    } : {}),
  }),
})
