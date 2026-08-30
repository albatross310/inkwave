import { defineConfig } from 'wxt'
import { resolve } from 'path'
import { INKWAVE_URL_PATTERNS } from './utils/constants'

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
    // ⚠ THE BRIDGE MUST BE DECLARED HERE, AND FOR YEARS IT WAS NOT (found 2026-08-30).
    // `content-inkwave.ts` says `defineContentScript({ matches: [...] })`, which LOOKS like a
    // declarative registration and is not one: WXT recognises a content script by FILENAME
    // (`*.content.ts`), so this file is built as an UNLISTED SCRIPT — compiled to
    // content-inkwave.js, never named in the manifest, its `matches` inert. The manifest simply
    // had no `content_scripts` key at all.
    //
    // Nothing noticed because the background worker ALSO injects it with `scripting.executeScript`
    // — but only when flushing a captured citation. So the bridge existed exactly after you pressed
    // Alt+Shift+C and at no other time, and the source reader's ping (which happens on page load,
    // long before any capture) got silence. Silence on that channel is indistinguishable from "no
    // extension installed", which is why live view stayed dark with everything else correct.
    //
    // Declared here rather than by renaming the entrypoint because the built filename is a
    // load-bearing string: background.ts injects 'content-inkwave.js' by name in three places, and
    // a rename would move the file out from under them silently.
    content_scripts: [{
      matches: [...INKWAVE_URL_PATTERNS],
      js: ['content-inkwave.js'],
      run_at: 'document_idle',
    }],
    // Renamed from "Inkwave Citation Capture" (2026-08-30, Peter). The old name described what
    // this was when it shipped; it now also fetches sources for the reader from the writer's own
    // connection and lets the reader show pages that refuse to be framed. A name that describes
    // one of three jobs sends the writer looking for a second extension for the other two.
    name: 'Inkwave',
    description: 'Capture citations from any page into Inkwave, and read your sources inside it — fetched from your own connection.',
    // `declarativeNetRequestWithHostAccess` rather than `declarativeNetRequest`: it grants rule
    // installation only where host access is ALREADY held, so the framing rule inherits the
    // optional `<all_urls>` grant below instead of being a second, broader permission the writer
    // never agreed to. Its install prompt is also silent, where the plain form warns about reading
    // browsing activity — which would be a warning about something this extension does not do
    // (no rule here observes a request; they only strip framing headers from a frame WE created).
    permissions: ['activeTab', 'storage', 'scripting', 'declarativeNetRequestWithHostAccess'],
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
          // ⚠ CHANGED WHILE IT IS STILL FREE TO CHANGE. A gecko id is permanent once an add-on
          // is published — AMO keys the update path to it — and this one has never been submitted,
          // so today is the last moment it costs nothing. Renaming it after publication would mean
          // a new listing and every user reinstalling.
          id: 'inkwave@inkwave.studio',
          strict_min_version: '109.0',
        },
      },
    } : {}),
  }),
})
