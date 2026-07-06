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
    <div className="min-h-screen font-serif" style={{ background: '#fbfaf6', color: '#3a3a3a' }}>
      <div className="mx-auto max-w-2xl px-5 py-12 sm:py-16">
        <Link to="/" className="text-sm text-stone-400 hover:text-[#5c2d8a]">← Back to writing</Link>

        {/* Hero — app icon to the left of the wordmark */}
        <header className="mt-8 flex items-center gap-6">
          <AppIcon size={160} />
          <div>
            <h1 className="text-4xl tracking-tight" style={{ color: INK }}>Inkwave Zero</h1>
            <p className="mt-2 text-lg text-stone-500">A calm place to write.</p>
          </div>
        </header>

        <div className="mt-12 space-y-10 text-[1.05rem] leading-relaxed">
          <section>
            <p>
              Inkwave is a quiet writing surface for short academic and philosophical work.
              Open it and begin — there is no sign-up, no dashboard, and nothing between you
              and the page. Your words stay in your browser.
            </p>
          </section>

          <section>
            <h2 className="text-xl mb-2" style={{ color: INK }}>Gentle friction, on purpose</h2>
            <p>
              As you write, words outside a quietly shifting active vocabulary glow softly in
              purple. You can cycle through close alternatives and choose a better fit, or keep
              what you had. It is a small, optional resistance — enough to make you deliberate,
              never enough to break your flow. We call it <em>SCAS</em>: Stochastically
              Constrained And Suggested.
            </p>
          </section>

          <section>
            <h2 className="text-xl mb-2" style={{ color: INK }}>Provenance you can verify</h2>
            <p>
              That friction leaves an honest trace. Inkwave signs your composition as it happens
              and anchors snapshots to the Bitcoin blockchain, producing a tamper-evident record
              of a real session written against unpredictable constraints — without surveilling a
              single keystroke. Anyone can confirm it.
            </p>
            <p className="mt-3">
              <Link to="/verify" className="underline" style={{ color: LIGHT }}>
                Verify an Inkwave record →
              </Link>
            </p>
          </section>

          <section>
            <h2 className="text-xl mb-2" style={{ color: INK }}>Private by design</h2>
            <p>
              Verification runs entirely in your browser, against Inkwave's published signing key.
              No login, nothing uploaded. The proof confirms an authentic, live composition — not
              that a human wrote every word, and never by watching you.
            </p>
          </section>
        </div>

        <footer className="mt-14 border-t pt-6 flex items-center justify-between text-sm" style={{ borderColor: '#eee' }}>
          <Link to="/" style={{ color: INK }} className="underline">Start writing</Link>
          <div className="flex gap-4">
            <Link to="/privacy" className="text-stone-400 hover:text-[#5c2d8a] underline">Privacy</Link>
            <Link to="/verify" style={{ color: LIGHT }} className="underline">Verify a record</Link>
          </div>
        </footer>
      </div>
    </div>
  )
}
