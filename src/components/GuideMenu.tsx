// GuideMenu — ⓘ toolbar button; opens a wide 3-column shortcut reference.
import { Fragment, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import { STUDIO_FILE_SETUP_MAC } from '../pwa/studioFileSetup'

const INK = '#302438'

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

const WINDOWS: Array<{ k: string; d: string }> = [
  { k: '⌥Tab', d: 'next Inkwave window on Mac' },
  { k: '⌃⌥Tab', d: 'previous Inkwave window on Mac' },
  { k: '⌘W', d: 'close only this window (⌘Q quits the whole installed app)' },
  { k: 'Ctrl+Alt+←/→', d: 'cycle Inkwave windows on Windows' },
]

const ZOOM: Array<{ k: string; d: string }> = [
  { k: 'pinch', d: 'reflow the text at a new size' },
  { k: 'Shift + two fingers', d: 'reflow text using any movement direction' },
  { k: '⌘ + scroll/pinch', d: 'magnify the whole page and water' },
]

export function GuideMenu() {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)

  // Default position: centred above the "i" button, PANEL_GAP-ish above the toolbar.
  function defaultAnchor(): React.CSSProperties {
    const br = btnRef.current?.getBoundingClientRect()
    const center = br ? br.left + br.width / 2 : window.innerWidth / 2
    const HALF = 240
    return {
      left: Math.round(Math.max(8 + HALF, Math.min(window.innerWidth - 8 - HALF, center))),
      bottom: 70,
      transform: 'translateX(-50%)',
    }
  }

  function onHeaderDown(e: React.MouseEvent) {
    const d = dialogRef.current?.getBoundingClientRect()
    if (!d) return
    drag.current = { dx: e.clientX - d.left, dy: e.clientY - d.top }
    const move = (ev: MouseEvent) => {
      if (!drag.current) return
      setPos({ left: ev.clientX - drag.current.dx, top: ev.clientY - drag.current.dy })
    }
    const up = () => { drag.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="relative flex items-center font-serif">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors font-serif ${open ? 'text-[#302438]' : 'text-stone-400 hover:text-[#302438]'}`}
        title="Guide"
      >
        <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-[15px] leading-none">i</span>
      </button>

      {open && createPortal(
        <>
          {/* Transparent backdrop — click outside to dismiss. The panel itself is movable + resizable. */}
          <div className="fixed inset-0 z-[99]" onMouseDown={() => setOpen(false)} />
          <div
            ref={dialogRef}
            role="dialog"
            aria-label="Guide"
            className="iw-nightable iw-touch-guard fixed z-[100]"
            onMouseDown={e => e.stopPropagation()}
            style={{
              ...(pos ? { left: pos.left, top: pos.top } : defaultAnchor()),
              width: 470, maxWidth: '92vw', height: 'calc(100vh - 92px)', maxHeight: 'calc(100vh - 92px)',
              resize: 'both', overflow: 'auto',
              padding: '14px 20px 20px',
              background: 'white',
              boxShadow: '0 12px 48px rgba(0,0,0,0.16)',
              border: `1px solid ${INK}bf`,
              borderRadius: '14px',
            }}
          >
            {/* Drag handle */}
            <div onMouseDown={onHeaderDown}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', cursor: 'move', userSelect: 'none' }}>
              <h2 style={{ fontSize: '1.1rem', fontFamily: 'serif', color: 'var(--iw-ink, #302438)', margin: 0 }}>Guide</h2>
              <button type="button" aria-label="Close" onMouseDown={e => e.stopPropagation()} onClick={() => setOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--iw-pill-fg, #78716c)', fontSize: '1.4rem', lineHeight: 1 }}>×</button>
            </div>

            {/* One master column: keys right-aligned in a max-content column, descriptions left-aligned —
                so the gap between them forms a straight vertical line through every section. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: '20px', rowGap: '7px', alignItems: 'baseline' }}>
              {([
                { title: 'Citations', rows: CITATIONS },
                { title: 'Word cycle', rows: CYCLE },
                { title: 'Fractions (on confirm)', rows: FRAC },
                { title: 'Math mode', rows: MATH },
                { title: 'Block alignment', rows: ALIGN },
                { title: 'Greek keyboard (in math box)', rows: GREEK },
                { title: 'Custom symbols', rows: SYMBOLS },
                { title: 'Windows', rows: WINDOWS },
                { title: 'Zoom', rows: ZOOM },
              ]).map(sec => (
                <Fragment key={sec.title}>
                  <div style={{ gridColumn: '1 / -1', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--iw-pill-fg, #78716c)', margin: '14px 0 3px' }}>{sec.title}</div>
                  {sec.rows.map(({ k, d }) => (
                    <Fragment key={k}>
                      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.92rem', color: 'var(--iw-ink, #302438)', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }}>{k}</span>
                      <span style={{ fontSize: '1.02rem', color: 'var(--iw-panel-fg, #4a4035)', lineHeight: 1.4 }}>{d}</span>
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </div>

            <section style={{ marginTop: '22px', paddingTop: '16px', borderTop: '1px solid var(--iw-nightable-border, #e7e5e4)' }}>
              <h3 style={{ margin: '0 0 7px', color: 'var(--iw-ink, #302438)', fontSize: '1rem' }}>
                Open .studio files in one click
              </h3>
              <p style={{ margin: 0, color: 'var(--iw-panel-fg, #4a4035)', fontSize: '0.92rem', lineHeight: 1.45 }}>
                {STUDIO_FILE_SETUP_MAC.join(' ')} Desktop Chromium only; Safari does not currently
                offer this installed-app file handling.
              </p>
              <Link
                to="/tips"
                onClick={() => setOpen(false)}
                style={{ display: 'inline-flex', marginTop: '10px', color: 'var(--iw-doc-accent, #302438)', fontSize: '0.94rem' }}
              >
                See all tips and Windows setup →
              </Link>
            </section>
          </div>
        </>,
        document.body,
      )}
    </div>
  )
}
