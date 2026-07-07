// About — what Inkwave is, the SCAS mechanic, and the verifiable provenance spine.
// Reached from the options menu (and linked from /verify). Prerendered to static HTML.

import { Link } from 'react-router'

const INK = '#5c2d8a'
const LIGHT = '#9b5ccc'

function AppIcon({ size }: { size: number }) {
  return (
    <img
      src="/inkwave-logo-v7.png"
      width={size} height={size}
      alt="Inkwave logo"
      style={{ display: 'block', filter: 'drop-shadow(0 2px 12px rgba(0,0,0,0.25))' }}
    />
  )
}

export function About() {
  return (
    <div className="min-h-screen font-serif" style={{ background: '#e7eefb', color: '#3a3a3a' }}>
      <div className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
        <Link to="/" onClick={() => { try { window.close() } catch { /* not a script-opened tab */ } }}
          className="inline-flex items-center rounded-full px-3.5 py-1 text-sm no-underline transition-colors hover:bg-[#5c2d8a11]"
          style={{ border: '1px solid rgba(92,45,138,0.3)', color: '#6d5a86' }}>← Back to writing</Link>

        {/* Hero — app icon to the left of the wordmark */}
        <header className="mt-8 flex items-center gap-6">
          <AppIcon size={160} />
          <div>
            <h1 className="text-4xl tracking-tight" style={{ color: INK }}>Inkwave Zero</h1>
            <p className="mt-2 text-lg text-stone-500">A calm writing studio for academics and students.</p>
          </div>
        </header>

        <div className="mt-12 space-y-10 text-[1.05rem] leading-relaxed">
          <section>
            <p>
              Inkwave Zero is a quiet place to do serious writing. Open it and begin — no
              sign-up, no dashboard, nothing between you and the page. Your work stays on your
              own device, and nothing you write is kept on our servers. The name is the promise:
              zero data retention.
            </p>
          </section>

          <section>
            <h2 className="text-xl mb-2" style={{ color: INK }}>A studio, not just a page</h2>
            <p>
              Your writing shouldn't live apart from the sources it rests on. In the studio your
              PDFs, references and citations sit alongside the draft — read a paper, highlight a
              passage, and cite it without leaving the page. One calm workspace holds the whole
              project.
            </p>
          </section>

          <section>
            <h2 className="text-xl mb-2" style={{ color: INK }}>AI that stays out of the way</h2>
            <p>
              AI helps at the edges — tidying citations, offering a closer word — but it never
              watches you work and never trains on what you write. Instead of surveilling
              keystrokes, Inkwave keeps a light, honest record of a genuine writing session and
              anchors it to the Bitcoin blockchain: provenance you can prove, without being
              watched to earn it.
            </p>
            <p className="mt-3">
              <Link to="/verify" className="underline" style={{ color: LIGHT }}>
                Verify an Inkwave record →
              </Link>
            </p>
          </section>

          <section>
            <h2 className="text-xl mb-2" style={{ color: INK }}>Zero retention, by design</h2>
            <p>
              Everything that matters happens in your browser. Verification runs against our
              published signing key — nothing uploaded, nothing stored. The proof confirms an
              authentic composition; it never claims to have read over your shoulder.
            </p>
          </section>

          <section>
            <h2 className="text-xl mb-2" style={{ color: INK }}>Where it's heading</h2>
            <p>
              Inkwave Zero is the verified ground floor. Above it, <em>Inkwave Cubed</em> opens the
              studio outward: living documents that don't carry the provenance record inside them, but
              link back to their verified counterparts here in Zero — and hyperlink freely to other
              Inkwave Cubed documents and to PDFs. The result is a space for academic and personal
              essay networks: writing that cites, connects, and builds on other writing, with a
              verifiable spine underneath.
            </p>
          </section>
        </div>

        <footer className="mt-14 border-t pt-6 flex items-center justify-between text-sm" style={{ borderColor: 'rgba(92,45,138,0.14)' }}>
          <Link to="/" className="inline-flex items-center rounded-full px-4 py-1.5 no-underline font-medium transition-colors" style={{ background: INK, color: '#fff' }}>Start writing</Link>
          <div className="flex gap-2.5">
            <Link to="/privacy" className="inline-flex items-center rounded-full px-3.5 py-1.5 no-underline transition-colors hover:bg-[#5c2d8a11]" style={{ border: '1px solid rgba(92,45,138,0.3)', color: '#8a7a9e' }}>Privacy</Link>
            <Link to="/verify" className="inline-flex items-center rounded-full px-3.5 py-1.5 no-underline transition-colors hover:bg-[#9b5ccc22]" style={{ border: `1px solid ${LIGHT}`, color: LIGHT }}>Verify a record</Link>
          </div>
        </footer>
      </div>
    </div>
  )
}
