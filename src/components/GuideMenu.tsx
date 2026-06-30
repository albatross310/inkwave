// GuideMenu — ⓘ toolbar button; opens a wide 3-column shortcut reference.
import { Fragment, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const INK = '#5c2d8a'

// Each section is an array of { k: shortcut, d: description }.
const CITATIONS: Array<{ k: string; d: string }> = [
  { k: '@',  d: 'in-text citation autocomplete' },
  { k: 'R',  d: 'bibliography / references panel' },
]

const CYCLE: Array<{ k: string; d: string }> = [
  { k: '`',            d: 'prev synonym / next red word' },
  { k: '~',            d: 'next synonym / prev red word' },
  { k: 'space',        d: 'accept' },
  { k: 'esc',          d: 'dismiss' },
]

const MATH: Array<{ k: string; d: string }> = [
  { k: 'Alt+=',          d: 'inline math' },
  { k: 'Alt+⇧+=',        d: 'block math' },
  { k: 'Σ button',      d: 'choose or manage symbols' },
  { k: 'Enter / Esc',   d: 'confirm inline' },
  { k: 'Ctrl+Enter',    d: 'confirm block' },
  { k: 'Enter (block)', d: 'line break (\\\\)' },
  { k: 'click equation', d: 'edit in popup' },
  { k: 'drag-select',   d: 'copies LaTeX to clipboard' },
]

const GREEK: Array<{ k: string; d: string }> = [
  { k: 'hold CapsLock',  d: 'Greek mode while held (Gk shows in box)' },
  { k: 'a–z',             d: 'lowercase Greek (α β γ δ …)' },
  { k: 'Shift + a–z',     d: 'uppercase Greek (Δ Φ Γ Λ …)' },
  { k: '"',               d: 'toggle text mode (\\text{}); " again to exit' },
  { k: 'Esc',             d: 'exit text mode (or close the math box)' },
  { k: '`',               d: 'small caps (\\textsc{})' },
]

const FRAC: Array<{ k: string; d: string }> = [
  { k: '/',               d: 'literal slash' },
  { k: '//',              d: 'fraction (\\frac)' },
]

const ALIGN: Array<{ k: string; d: string }> = [
  { k: 'Ctrl+Q  / =', d: 'align at =' },
  { k: 'Ctrl+E  / ⊙', d: 'centre' },
  { k: 'Ctrl+L  / ◁', d: 'left' },
]

const SYMBOLS: Array<{ k: string; d: string }> = [
  { k: '"name = latex', d: 'define a symbol (press Enter)' },
  { k: 'Σ → Symbols',   d: 'manage & browse definitions' },
]

type Row = { k: string; d: string }

function Col({ sections }: { sections: { title: string; rows: Row[] }[] }) {
  return (
    <div style={{ minWidth: '220px', flex: 1 }}>
      {sections.map(({ title, rows }) => (
        <div key={title} style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#b0a898', marginBottom: '6px' }}>
            {title}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: '10px', rowGap: '5px' }}>
            {rows.map(({ k, d }) => (
              <Fragment key={k}>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem', color: '#7a6e65', textAlign: 'right', whiteSpace: 'nowrap' }}>{k}</span>
                <span style={{ fontSize: '0.9rem', color: '#4a4035' }}>{d}</span>
              </Fragment>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function GuideMenu() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
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
        <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-[15px] leading-none">i</span>
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onMouseDown={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-stone-900/20" aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Guide"
            onMouseDown={e => e.stopPropagation()}
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '900px',
              padding: '24px',
              background: 'white',
              boxShadow: '0 12px 48px rgba(0,0,0,0.16)',
              border: `1px solid ${INK}bf`,
              borderRadius: '14px',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
              <h2 style={{ fontSize: '1.1rem', fontFamily: 'serif', color: INK, margin: 0 }}>Guide</h2>
              <button type="button" aria-label="Close" onClick={() => setOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a89d96', fontSize: '1.4rem', lineHeight: 1 }}>×</button>
            </div>

            {/* 3-column layout — scrollable horizontally on narrow screens */}
            <div style={{ display: 'flex', gap: '24px', overflowX: 'auto' }}>
              <Col sections={[
                { title: 'Citations', rows: CITATIONS },
                { title: 'Word cycle', rows: CYCLE },
                { title: 'Fractions (on confirm)', rows: FRAC },
              ]} />
              <Col sections={[
                { title: 'Math mode', rows: MATH },
                { title: 'Block alignment', rows: ALIGN },
              ]} />
              <Col sections={[
                { title: 'Greek keyboard (in math box)', rows: GREEK },
                { title: 'Custom symbols', rows: SYMBOLS },
              ]} />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
