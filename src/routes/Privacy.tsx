// Privacy policy — covers Inkwave Solo (web app) and the Citation Capture browser extension.
// Prerendered to static HTML; no client-side data fetching.

import { Link } from 'react-router'

const INK = '#5c2d8a'
const LIGHT = '#9b5ccc'
const UPDATED = '4 July 2026'

export function Privacy() {
  return (
    <div className="min-h-screen font-serif" style={{ background: '#fbfaf6', color: '#3a3a3a' }}>
      <div className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
        <Link to="/about" className="text-sm text-stone-400 hover:text-[#5c2d8a]">← About Inkwave</Link>

        <header className="mt-8">
          <h1 className="text-3xl tracking-tight" style={{ color: INK }}>Privacy Policy</h1>
          <p className="mt-2 text-sm text-stone-400">Inkwave Solo · Last updated {UPDATED}</p>
        </header>

        <div className="mt-10 space-y-8 text-[1rem] leading-relaxed text-stone-700">

          <section>
            <p>
              Inkwave Solo is designed so your writing never leaves your device unless you
              choose to export it. This policy explains exactly what data the app and its
              companion browser extension handle.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2" style={{ color: INK }}>Inkwave Solo — web app</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>All document data is stored in your browser only</strong> — in the
                browser's Origin Private File System (OPFS) and IndexedDB. Nothing is sent
                to Inkwave's servers.
              </li>
              <li>
                <strong>Provenance signing.</strong> When you write, Inkwave contacts
                its signing service at <code className="text-xs bg-stone-100 px-1 rounded">iwzero.me</code> to
                sign composition receipts. The service receives only cryptographic hashes —
                never your text, your identity, or any personally identifiable information.
              </li>
              <li>
                <strong>Bitcoin timestamping.</strong> Document hashes are sent to the
                OpenTimestamps public service to anchor them to the Bitcoin blockchain.
                No personal data is included.
              </li>
              <li>
                <strong>Citation lookup.</strong> If you enter a DOI, ISBN, arXiv ID, or
                URL in the citation panel, Inkwave queries the relevant public API
                (CrossRef, OpenLibrary, arXiv, PubMed, or Google Books) to fetch
                bibliographic metadata. Those queries go directly from your browser to
                the third-party API — Inkwave does not proxy or log them.
              </li>
              <li>
                <strong>No analytics, no cookies, no advertising.</strong> Inkwave does
                not use tracking scripts, third-party analytics, or advertising networks.
              </li>
              <li>
                <strong>No account required.</strong> There is no sign-up for the free
                tier. No name, email address, or credentials are collected.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2" style={{ color: INK }}>Citation Capture — browser extension</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>What it reads.</strong> When you click the extension icon on a
                web page, the extension reads that page's URL and visible metadata
                (title, author, date, publisher) to create a citation. It does not read
                other tabs, your browsing history, or any other data.
              </li>
              <li>
                <strong>What it sends.</strong> The page URL and extracted metadata are
                sent to <code className="text-xs bg-stone-100 px-1 rounded">iwzero.me/api/summarise</code> so
                the server can extract structured bibliographic fields using an AI model.
                The page's full text is not retained after processing.
              </li>
              <li>
                <strong>Local storage.</strong> Captured citation metadata is queued in
                the browser's <code className="text-xs bg-stone-100 px-1 rounded">chrome.storage.local</code> until
                it is delivered to your open Inkwave tab, then deleted. Nothing is sent
                to a remote server other than the active-tab metadata described above.
              </li>
              <li>
                <strong>No background tracking.</strong> The extension does not run
                continuously, does not monitor your browsing, and does not collect data
                when you have not clicked its icon.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2" style={{ color: INK }}>Data sharing</h2>
            <p>
              Inkwave does not sell, trade, or transfer your data to third parties.
              The only external services contacted are those listed above
              (OpenTimestamps, bibliographic APIs, the Inkwave signing and
              summarisation endpoints), each receiving only the minimum data necessary
              to perform its function.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2" style={{ color: INK }}>Contact</h2>
            <p>
              Questions about this policy:{' '}
              <a href="mailto:hello@iwzero.me" style={{ color: LIGHT }} className="underline">
                hello@iwzero.me
              </a>
            </p>
          </section>

        </div>

        <footer className="mt-14 border-t pt-6 flex items-center justify-between text-sm" style={{ borderColor: '#eee' }}>
          <Link to="/" style={{ color: INK }} className="underline">Start writing</Link>
          <Link to="/about" style={{ color: LIGHT }} className="underline">About Inkwave</Link>
        </footer>
      </div>
    </div>
  )
}
