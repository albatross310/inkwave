// Privacy policy — covers Inkwave Zero (web app) and the Citation Capture browser extension.
// Prerendered to static HTML; no client-side data fetching.

import { Link } from 'react-router'
import { PAGE_GRADIENT, PAGE_PARCHMENT, PAGE_CARD_SHADOW, PAGE_CARD_RADIUS } from './pageChrome'

const INK = '#5c2d8a'
const UPDATED = '7 July 2026'

const pill = 'inline-flex items-center rounded-full px-4 py-1.5 no-underline font-medium transition-colors hover:brightness-110'

export function Privacy() {
  return (
    <div className="min-h-screen font-serif py-8 sm:py-14 px-4" style={{ background: PAGE_GRADIENT, color: '#3a3a3a' }}>
      <div className="mx-auto max-w-2xl px-6 sm:px-10 py-12 sm:py-16" style={{ background: PAGE_PARCHMENT, borderRadius: PAGE_CARD_RADIUS, boxShadow: PAGE_CARD_SHADOW }}>
        <Link to="/about" className="inline-flex items-center rounded-full px-3.5 py-1 text-sm no-underline transition-colors hover:brightness-110" style={{ background: INK, color: '#fff' }}>← About Inkwave</Link>

        <header className="mt-8 flex items-center gap-4">
          <img src="/inkwave-logo-v7.png" alt="Inkwave" width={64} height={64} style={{ display: 'block', flexShrink: 0 }} />
          <div>
            <h1 className="text-4xl tracking-tight" style={{ color: INK }}>Privacy Policy</h1>
            <p className="mt-2 text-sm text-stone-500">Inkwave Zero · Last updated {UPDATED}</p>
          </div>
        </header>

        <div className="mt-10 space-y-8 text-[1.1rem] leading-relaxed text-stone-700">
          <p>
            Inkwave Zero keeps your writing on your device. It works without an account, and your
            documents are never sent to our servers. This policy covers the web app and the optional
            Citation Capture browser extension.
          </p>

          <section>
            <h2 className="text-xl mb-2" style={{ color: INK }}>The web app</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>Your documents are stored only in your browser (OPFS and IndexedDB). They leave your device only when you export or sync them yourself.</li>
              <li>To sign provenance receipts, the app sends our service cryptographic hashes only — never your text, identity, or any personal data. Document hashes are anchored to the Bitcoin blockchain via OpenTimestamps; no personal data is included.</li>
              <li>Citation lookups (DOI, ISBN, arXiv, URL) go directly from your browser to the relevant public API. We don't proxy or log them.</li>
              <li>No accounts, analytics, cookies, or advertising.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl mb-2" style={{ color: INK }}>The Citation Capture extension</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>It acts only when you click its icon, reading the current page's URL and bibliographic metadata (title, author, date, publisher) to build a citation. It doesn't read other tabs, your history, or anything else.</li>
              <li>That URL and metadata are sent to our summarisation endpoint to extract structured citation fields; the page text is not retained after processing.</li>
              <li>Captured citations are held in local extension storage until delivered to your Inkwave tab, then removed. Nothing runs in the background.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl mb-2" style={{ color: INK }}>Data sharing</h2>
            <p>
              We don't sell or trade your data. The only external services contacted are those above,
              each receiving the minimum needed to do its job.
            </p>
          </section>

          <section>
            <h2 className="text-xl mb-2" style={{ color: INK }}>Contact</h2>
            <p>
              Questions about this policy:{' '}
              <a href="mailto:petergibson127@gmail.com" style={{ color: INK }} className="underline">
                petergibson127@gmail.com
              </a>
            </p>
          </section>
        </div>

        <footer className="mt-14 border-t pt-6 flex items-center justify-between text-sm" style={{ borderColor: 'rgba(92,45,138,0.14)' }}>
          <Link to="/" className={pill} style={{ background: INK, color: '#fff' }}>Start writing</Link>
          <Link to="/about" className={pill} style={{ background: INK, color: '#fff' }}>About Inkwave</Link>
        </footer>
      </div>
    </div>
  )
}
