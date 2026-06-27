// GuideMenu — toolbar button (ⓘ circle) with a centred modal: hotkeys for the word
// cycle, math mode, and other shortcuts.

import { Fragment, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const INK = '#5c2d8a'

const CYCLE_KEYS: Array<{ k: string; d: string }> = [
  { k: 'j / k',   d: 'cycle synonyms' },
  { k: 'space',   d: 'accept' },
  { k: 'tab',     d: 'previous word' },
  { k: '⇧+tab',   d: 'next word' },
  { k: 'esc',     d: 'dismiss' },
]

const MATH_KEYS: Array<{ k: string; d: string }> = [
  { k: 'Ctrl+=',       d: 'insert inline math' },
  { k: 'Ctrl+⇧+=',    d: 'insert block math' },
  { k: 'Σ button',     d: 'choose inline or block from popup' },
  { k: 'Enter / Esc',  d: 'confirm inline equation' },
  { k: 'Ctrl+Enter',   d: 'confirm block equation' },
  { k: 'Enter',        d: 'new line in block (inserts \\\\)' },
]

const GREEK_KEYS: Array<{ k: string; d: string }> = [
  { k: 'hold CapsLock',    d: 'Greek mode (hold, not toggle)' },
  { k: '+ a–z',            d: 'lowercase: α β γ δ ε ζ η θ ι κ λ μ ν ξ π ρ σ τ υ φ χ ψ ω' },
  { k: '+ Tab',            d: 'toggle uppercase Greek: Γ Δ Θ Λ Π Σ Φ Υ Ξ Ψ Ω (releases on CapsLock up)' },
  { k: 'q → θ,  f → φ',   d: 'inserts Unicode — not \\theta. Tab unmapped while in box.' },
]

const FRAC_KEYS: Array<{ k: string; d: string }> = [
  { k: 'x // y',          d: '→ \\frac{x}{y}' },
  { k: '(x+1) // (y-2)',  d: '→ \\frac{x+1}{y-2}  (parens stripped)' },
  { k: '((x)) // ((y))',  d: '→ \\frac{(x)}{(y)}  (double parens kept)' },
]

const BLOCK_ALIGN: Array<{ k: string; d: string }> = [
  { k: 'Ctrl+Q  / =',  d: 'align at equals (use & before each =)' },
  { k: 'Ctrl+E  / ⊙',  d: 'centred display' },
  { k: 'Ctrl+L  / ◁',  d: 'left aligned' },
]

function Section({ title, rows }: { title: string; rows: Array<{ k: string; d: string }> }) {
  return (
    <div className="mt-3 pt-3 border-t border-stone-100">
      <div className="text-[0.62rem] uppercase tracking-wide text-stone-400 mb-1.5">{title}</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-base">
        {rows.map(({ k, d }) => (
          <Fragment key={k}>
            <span className="font-mono text-[0.75rem] text-stone-500 text-right whitespace-nowrap">{k}</span>
            <span className="text-sm text-stone-600">{d}</span>
          </Fragment>
        ))}
      </div>
    </div>
  )
}

export function GuideMenu() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onScroll = () => setOpen(false)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onScroll) }
  }, [open])

  return (
    <div className="relative flex items-center font-serif">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors font-serif ${open ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
        title="Guide"
      >
        <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-[15px] leading-none">
          i
        </span>
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onMouseDown={() => setOpen(false)}>
          <div className="absolute inset-0 bg-stone-900/20" aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Guide"
            onMouseDown={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm p-6 bg-white shadow-xl text-stone-600 overflow-y-auto max-h-[90vh]"
            style={{ border: `1px solid ${INK}bf`, borderRadius: '14px' }}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-serif" style={{ color: INK }}>Guide</h2>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="text-stone-400 hover:text-[#5c2d8a] text-2xl leading-none">×</button>
            </div>

            <div className="text-[0.62rem] uppercase tracking-wide text-stone-400 mb-1.5">Word cycle</div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-base">
              {CYCLE_KEYS.map(({ k, d }) => (
                <Fragment key={k}>
                  <span className="font-mono text-[0.75rem] text-stone-500 text-right whitespace-nowrap">{k}</span>
                  <span className="text-sm text-stone-600">{d}</span>
                </Fragment>
              ))}
            </div>

            <Section title="Math mode" rows={MATH_KEYS} />
            <Section title="Greek keyboard (in math mode)" rows={GREEK_KEYS} />
            <Section title="Fraction shorthand (on confirm)" rows={FRAC_KEYS} />
            <Section title="Block equation alignment" rows={BLOCK_ALIGN} />

            <div className="mt-3 pt-3 border-t border-stone-100 text-sm text-stone-400 leading-snug">
              Bold, italics, underline, bullets &amp; numbers handled by a built-in IME <span className="text-stone-300">(coming soon)</span>.
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
