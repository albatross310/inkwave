import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { gappedPagesEnabled, setGappedPages } from '../editor/pageView'
import { crossoutMode, cycleCrossoutMode, watermarkEnabled, setWatermark } from '../editor/crossout'
import { LimitSelector } from './LimitSelector'

const INK = '#5c2d8a'

interface SettingsMenuProps {
  limitN: number | 'infinite'
  onLimitChange: (v: number | 'infinite') => void
}

export function SettingsMenu({ limitN, onLimitChange }: SettingsMenuProps) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [, rerender] = useState(0)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onScroll = () => setOpen(false)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions) }
  }, [open])

  function toggle() { setOpen(o => !o) }

  // Compute popup position: anchored above the button, right-aligned to button's right edge.
  // Clamps so the panel never overflows off-screen on phone.
  function menuStyle(): React.CSSProperties {
    const br = btnRef.current?.getBoundingClientRect()
    if (!br) return { position: 'fixed', bottom: 80, right: 10 }
    return {
      position: 'fixed',
      bottom: Math.round(window.innerHeight - br.top + 8),
      right: Math.max(8, Math.round(window.innerWidth - br.right)),
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors ${open ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
        title="Settings"
      >
        <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7zm7.43-2.47c.04-.32.07-.65.07-.97s-.03-.66-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1s.03.65.07.97l-2.11 1.66c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66z"/>
          </svg>
        </span>
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[90]" aria-hidden="true" onMouseDown={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Settings"
            className="z-[91] w-52 bg-white shadow-lg font-serif text-sm text-stone-600"
            style={{ ...menuStyle(), border: `1px solid ${INK}55`, borderRadius: 12 }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-stone-400">Settings</div>

            {/* Vocab limit */}
            <div className="flex items-center justify-between px-4 py-2.5">
              <span>Vocab limit</span>
              <LimitSelector value={limitN} onChange={onLimitChange} />
            </div>

            {/* Gapped pages */}
            <Row
              label="Gapped pages"
              checked={gappedPagesEnabled()}
              onChange={() => { setGappedPages(!gappedPagesEnabled()); window.location.reload() }}
            />

            {/* Old word display */}
            <div className="flex items-center justify-between px-4 py-2.5">
              <span>Old word</span>
              <button
                type="button"
                onClick={() => { cycleCrossoutMode(); rerender(n => n + 1) }}
                className="text-xs px-2 py-0.5 rounded-full hover:bg-stone-100 transition-colors tabular-nums"
                style={{ color: INK, border: `1px solid ${INK}44` }}
                title="Cycle old-word display style"
              >
                {crossoutMode()}
              </button>
            </div>

            {/* Watermark */}
            <Row
              label="Watermark"
              checked={watermarkEnabled()}
              onChange={() => { setWatermark(!watermarkEnabled()); rerender(n => n + 1) }}
            />

            {/* SCAS suggestions — turn the DISPLAY of the vocabulary suggestions off/on. Live toggle
                (no reload): only the highlight decorations are suppressed; the SCAS engine keeps running. */}
            <Row
              label="SCAS suggestions"
              checked={!(typeof localStorage !== 'undefined' && localStorage.getItem('inkwave:scasOff') === '1')}
              onChange={() => {
                try { localStorage.setItem('inkwave:scasOff', localStorage.getItem('inkwave:scasOff') === '1' ? '0' : '1') } catch { /* private mode */ }
                window.dispatchEvent(new Event('inkwave:scas-display-changed'))
                rerender(n => n + 1) // update this toggle's checked state
              }}
            />

            {/* SCAS testing mode — highlights all exclusion-set words, not just the ones in your text */}
            <Row
              label="SCAS test mode"
              checked={typeof localStorage !== 'undefined' && localStorage.getItem('inkwave:debugHighlightAll') === '1'}
              onChange={() => {
                try { localStorage.setItem('inkwave:debugHighlightAll', localStorage.getItem('inkwave:debugHighlightAll') === '1' ? '0' : '1') } catch { /* private mode */ }
                window.location.reload()
              }}
            />

            <div className="h-2" />
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

function Row({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-stone-50 transition-colors select-none">
      <span>{label}</span>
      <span
        className="w-8 h-4 rounded-full flex items-center transition-colors relative"
        style={{ background: checked ? INK : '#d1d5db' }}
      >
        <span
          className="absolute w-3 h-3 bg-white rounded-full shadow-sm transition-transform"
          style={{ left: 2, transform: checked ? 'translateX(16px)' : 'translateX(0)' }}
        />
        <input type="checkbox" className="sr-only" checked={checked} onChange={onChange} />
      </span>
    </label>
  )
}
