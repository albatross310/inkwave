// Privacy policy — covers Inkwave Zero (web app) and the Citation Capture browser extension.
// Prerendered to static HTML; no client-side data fetching.
//
// Keep this page HONEST and in sync with the code. The load-bearing facts it states:
//   • Documents live on-device (OPFS/IndexedDB) + wherever the writer saves/syncs them.
//   • The signing service receives hashes only (api/sign); OTS relays a hash (api/ots).
//   • AI features (summaries, URL lookup, PDF page numbers) are OPT-IN, off by default
//     (src/editor/aiSettings.ts), transit our functions, and are processed by Anthropic.
//   • Our functions log nothing and store nothing; Vercel keeps standard platform logs.
//   • The extension's capture history expires after 5 minutes (extension-src/utils/constants.ts).
// If a feature changes any of this, change this page in the same PR.

import { Link } from 'react-router'
import { PAGE_GRADIENT, PAGE_PARCHMENT, PAGE_CARD_SHADOW, PAGE_CARD_RADIUS } from './pageChrome'

const INK = '#5c2d8a'
const UPDATED = '8 July 2026'

const pill = 'inline-flex items-center rounded-full px-4 py-1.5 no-underline font-medium transition-colors hover:brightness-110'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl mb-2" style={{ color: INK }}>{title}</h2>
      {children}
    </section>
  )
}

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

        <div className="mt-10 space-y-8 text-[1.05rem] leading-relaxed text-stone-700">
          <p>
            <strong style={{ color: INK }}>Zero data retention — and minimal data in transit — is
            our number one priority. It's in our very name.</strong> Inkwave Zero is local-first:
            your writing lives on your device and in the files and drives you choose, never in a
            database of ours. It works without an account and we run no analytics. We do not retain
            any of your data. At all, period.
          </p>
          <p>
            That said, honesty requires caveats: a small number of features do pass data through
            our servers, or to named services, on its way somewhere else. This policy sets out each
            one — what leaves your device, where it goes, and why. It covers the web app and the
            optional Citation Capture browser extension.
          </p>

          <Section title="Where your writing lives">
            <p>
              Documents are stored in your browser (OPFS and IndexedDB) and, when you save or sync,
              in the destinations you pick: a local file or folder, your OneDrive, or your Google
              Drive. Cloud sync writes to <em>your</em> account under your login — the file goes from
              your browser to Microsoft or Google, not to us. OneDrive sync uses the standard
              file-access permission (<code>Files.ReadWrite</code>) so you can choose any folder;
              Google Drive uses the narrower per-file permission (<code>drive.file</code>). PDFs you
              attach to sources are stored the same way — on your device and in your own drives —
              and reading or annotating them happens entirely in your browser.
            </p>
          </Section>

          <Section title="What passes through our servers — and why">
            <p>
              A few features need a server. Ours are stateless functions that process each request
              and keep nothing: no databases of your content, no logging of what you send. In each
              case this is the minimum the feature needs to work:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li><strong>Provenance signing</strong> — receives cryptographic hashes only: never your text, your words, or your identity. Hashes cannot be reversed into writing.</li>
              <li><strong>Bitcoin timestamping</strong> — relays a single document hash to public OpenTimestamps calendars. Nothing personal is anchored.</li>
              <li><strong>PDF export</strong> — your document is rendered to PDF on our server and immediately discarded; nothing is logged or kept. If you'd rather keep the export fully local, Print → "Save as PDF" produces the same quality without anything leaving your device — you just manage and save the file yourself.</li>
              <li><strong>Optional AI features</strong> — see the next section; these are off until you switch them on.</li>
            </ul>
            <p className="mt-3">
              We host on Vercel, which — like any web host — keeps standard, short-lived request
              logs (IP address, browser type) for its platform operations. We add no logging of our
              own on top of that.
            </p>
          </Section>

          <Section title="Optional AI features (off by default)">
            <p>
              Two features use AI, and both are explicit opt-ins — nothing is sent until you switch
              them on, and you're asked the first time before anything leaves your device:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-3">
              <li><strong>Snapshot summaries</strong> — sends snapshot text through our server to Anthropic (Claude) to describe what changed between versions.</li>
              <li><strong>URL citation lookup</strong> — sends a cited page's address and content through our server to Anthropic to fill in citation details; it can also read a few pages of an attached PDF to detect printed page numbers.</li>
            </ul>
            <p className="mt-3">
              In both cases our server processes the request transiently — nothing is logged or
              retained — and Anthropic does not train on data sent through its API. Both settings are
              switched off by default and can be adjusted at any time in Settings. As Inkwave develops we are also
              exploring browser-local AI models for these features, so that this data truly never
              leaves your device.
            </p>
          </Section>

          <Section title="Other services your browser talks to">
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Thesaurus</strong> — word suggestions come from the public Datamuse API: individual flagged words (never sentences or passages) are sent as lookups from your browser.</li>
              <li><strong>Citation registries</strong> — DOI, ISBN, arXiv and PubMed lookups go directly from your browser to CrossRef, Open Library, Google Books, arXiv and PubMed; each learns only the identifier you looked up. CrossRef and PubMed requests include our contact email, as those services request.</li>
              <li><strong>Verification</strong> — checking a record at <Link to="/verify" style={{ color: INK }} className="underline">/verify</Link> runs entirely in your browser; nothing is uploaded. Confirming a Bitcoin timestamp queries two public block explorers for block information only.</li>
              <li><strong>Citation styles</strong> — choosing a non-default citation style downloads the style file from a public CDN (jsDelivr).</li>
            </ul>
          </Section>

          <Section title="What's in your exported file">
            <p>
              A <code>.studio</code> file is self-contained by design — that's what makes it
              verifiable. It includes your full text, your complete snapshot history (including
              passages you later deleted), your word-swap record, signed receipts, and a random
              device identifier used to group sessions. Share it knowingly: anyone you give the file
              to can read all of it. Embedded PDFs can be stripped with one click before sharing.
            </p>
          </Section>

          <Section title="The Citation Capture extension">
            <p>
              The extension is a separate, optional install. When you capture a page — by clicking
              the icon, pressing the keyboard shortcut, or revisiting a page you asked it to watch —
              it reads that page's address and content and sends them through our server to
              Anthropic to extract citation fields (title, author, date, publisher). As above,
              nothing is logged or retained on our servers, and Anthropic does not train on it.
              Identifier lookups (DOI, ISBN, arXiv, PubMed) go directly to the public registries.
              Captured citations are held in local extension storage until delivered to your Inkwave
              tab; a short-lived local history that powers "already in library" expires after five
              minutes. The extension never reads your browsing history or other tabs' content.
            </p>
          </Section>

          <Section title="Accounts and payments">
            <p>
              Ordinary use needs no account. If you choose to sign in — through Clerk, our
              authentication provider — the only personal information we hold is your email address,
              used solely to identify your subscription; we never email you except to help you
              recover your account. Signing in supports <em>Insignia</em>, our paid deep-provenance
              tier, which is still in development. Payments are handled entirely by Stripe and
              PayPal; we never see your card or billing details.
            </p>
          </Section>

          <Section title="What we don't do">
            <p>
              No analytics, no tracking cookies, no advertising, no crash reporting, no telemetry.
              The app never reports anything about you or your session, and there is no usage data
              to sell or share. The only external services contacted are the ones named on this
              page, each receiving the minimum needed to do its job.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about this policy:{' '}
              <a href="mailto:petergibson127@gmail.com" style={{ color: INK }} className="underline">
                petergibson127@gmail.com
              </a>
            </p>
          </Section>
        </div>

        <footer className="mt-14 border-t pt-6 flex items-center justify-between text-sm" style={{ borderColor: 'rgba(92,45,138,0.14)' }}>
          <Link to="/" className={pill} style={{ background: INK, color: '#fff' }}>Start writing</Link>
          <Link to="/about" className={pill} style={{ background: INK, color: '#fff' }}>About Inkwave</Link>
        </footer>
      </div>
    </div>
  )
}
