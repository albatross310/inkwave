import { Link } from 'react-router'
import { LOADING_TIPS } from '../components/LoadingTip'
import { STUDIO_FILE_SETUP_MAC, STUDIO_FILE_SETUP_WINDOWS } from '../pwa/studioFileSetup'
import { PAGE_CARD_RADIUS, PAGE_CARD_SHADOW, PAGE_GRADIENT, PAGE_PARCHMENT } from './pageChrome'

function Steps({ children }: { children: readonly string[] }) {
  return (
    <ol className="mt-3 list-decimal space-y-2 pl-6">
      {children.map((step) => <li key={step}>{step}</li>)}
    </ol>
  )
}

export function Tips() {
  return (
    <div className="min-h-screen px-4 py-8 font-serif sm:py-14" style={{ background: PAGE_GRADIENT, color: 'var(--iw-panel-fg, #4a4035)' }}>
      <main className="mx-auto max-w-2xl px-6 py-12 sm:px-10 sm:py-16" style={{ background: PAGE_PARCHMENT, borderRadius: PAGE_CARD_RADIUS, boxShadow: PAGE_CARD_SHADOW }}>
        <Link to="/" className="inline-flex items-center rounded-full px-3.5 py-1 text-sm no-underline transition-colors hover:brightness-105" style={{ border: '1px solid var(--iw-nightable-border, #e7e5e4)', color: 'var(--iw-doc-accent, #302438)', background: 'var(--iw-subtle-bg, #fcfcfb)' }}>
          ← Back to writing
        </Link>

        <header className="mt-8 flex items-center gap-4">
          <img src="/inkwave-logo-v7.png" alt="Inkwave" width={64} height={64} style={{ display: 'block', flexShrink: 0 }} />
          <div>
            <h1 className="text-4xl tracking-tight" style={{ color: 'var(--iw-ink, #302438)' }}>Tips</h1>
            <p className="mt-2 text-stone-500">The complete Inkwave loading-tip collection.</p>
          </div>
        </header>

        <section className="mt-10">
          <ol className="space-y-3">
            {LOADING_TIPS.map((tip, index) => (
              <li key={tip} className="flex gap-3 rounded-xl bg-white/70 px-4 py-3 leading-relaxed">
                <span aria-hidden="true" style={{ color: 'var(--iw-doc-accent, #302438)' }}>{index + 1}.</span>
                <span>{tip}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-12 border-t pt-8 leading-relaxed" style={{ borderColor: 'var(--iw-nightable-border, #e7e5e4)' }}>
          <h2 className="text-2xl" style={{ color: 'var(--iw-ink, #302438)' }}>Open .studio files in one click</h2>
          <p className="mt-3">
            Once the installed PWA is the default app, double-clicking a <code>.studio</code> file
            opens it directly in its own Inkwave window. Install or reinstall the PWA after this
            feature reaches your browser so the operating system receives the file association.
          </p>

          <h3 className="mt-6 text-xl" style={{ color: 'var(--iw-ink, #302438)' }}>macOS</h3>
          <Steps>{STUDIO_FILE_SETUP_MAC}</Steps>

          <h3 className="mt-6 text-xl" style={{ color: 'var(--iw-ink, #302438)' }}>Windows</h3>
          <Steps>{STUDIO_FILE_SETUP_WINDOWS}</Steps>

          <p className="mt-6 text-stone-600">
            This direct file-opening feature is available in installed desktop Chromium apps.
            Safari and Firefox do not currently expose the required PWA file-handling API. In any
            browser you can still use <strong>⋮ → Open…</strong> inside Inkwave.
          </p>
        </section>
      </main>
    </div>
  )
}
