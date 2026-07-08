// One-time consent dialog for AI features that send content through our server to Anthropic.
// Shown on the first off→on transition of an AI opt-in (see editor/aiSettings.ts). The copy is
// deliberately plain: what leaves the device, where it goes, and that nothing is retained.

import { createPortal } from 'react-dom'
import type { AiFeature } from '../editor/aiSettings'

const INK = '#5c2d8a'

const COPY: Record<AiFeature, { title: string; body: string }> = {
  summaries: {
    title: 'Turn on plain-language recaps?',
    body: 'These send snapshot text to Anthropic (Claude) through our servers to describe what '
      + 'changed between versions. Nothing is logged or retained on our servers, and Anthropic does '
      + 'not train on it.',
  },
  url: {
    title: 'Turn on URL lookup?',
    body: 'URL lookup sends the page’s address and content to Anthropic (Claude) through our '
      + 'servers to collate citation details for you (it also reads a few pages of attached PDFs to '
      + 'detect printed page numbers). Nothing is logged or retained on our servers, and Anthropic '
      + 'does not train on it.',
  },
}

export function AiConsentDialog({ feature, onYes, onNo }: {
  feature: AiFeature
  onYes: () => void
  onNo: () => void
}) {
  const { title, body } = COPY[feature]
  return createPortal(
    <>
      <div className="fixed inset-0 z-[130]" style={{ background: 'rgba(35,25,50,0.35)' }} aria-hidden="true" onMouseDown={onNo} />
      <div
        role="alertdialog" aria-modal="true" aria-label={title}
        className="iw-nightable fixed z-[131] bg-white shadow-lg font-serif text-stone-700"
        style={{
          top: '50%', left: 'min(66%, calc(100vw - 14rem))', transform: 'translate(-50%, -50%)',
          width: 'min(26rem, calc(100vw - 2rem))', borderRadius: 12, padding: '1.3rem 1.5rem',
          border: `1px solid var(--iw-nightable-border, ${INK}55)`,
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="text-lg mb-2" style={{ color: `var(--iw-ink, ${INK})`, fontWeight: 600 }}>{title}</div>
        <p className="text-sm leading-relaxed m-0">{body}</p>
        <div className="mt-4 flex items-center gap-2.5">
          <button type="button" onClick={onYes}
            className="px-4 py-1.5 rounded-full text-sm font-medium transition-colors hover:brightness-110"
            style={{ background: `var(--iw-ink, ${INK})`, color: '#fff', border: 'none', cursor: 'pointer' }}>
            Yes, switch on
          </button>
          <button type="button" onClick={onNo}
            className="px-4 py-1.5 rounded-full text-sm transition-colors hover:bg-stone-100"
            style={{ color: `var(--iw-pill-fg, #78716c)`, border: `1px solid var(--iw-nightable-border, ${INK}44)`, background: 'transparent', cursor: 'pointer' }}>
            Not now
          </button>
          {/* Jazzed privacy pill, pushed to the right. */}
          <a href="/privacy" target="_blank" rel="noopener"
            className="ml-auto px-3.5 py-1.5 rounded-full text-sm font-medium shadow-sm transition-transform hover:scale-105"
            style={{ color: '#fff', background: `linear-gradient(135deg, #7a4fb0, ${INK})`, textDecoration: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Privacy ↗
          </a>
        </div>
      </div>
    </>,
    document.body,
  )
}
