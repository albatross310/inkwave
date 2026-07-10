import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { gappedPagesEnabled, setGappedPages } from '../editor/pageView'
import { flushPendingSave } from '../storage/opfs'

// NEVER reload with a pending save (2026-07-10: the gapped toggle's bare reload cost Peter real
// work — storage had also silently stalled). Flush first; on failure DO NOT reload.
async function flushThenReload(): Promise<void> {
  try { await flushPendingSave() } catch (err) {
    alert(`Your latest changes could not be saved, so the page was NOT reloaded.\n\n${String(err)}`)
    return
  }
  window.location.reload()
}
import { crossoutMode, cycleCrossoutMode, watermarkEnabled, setWatermark } from '../editor/crossout'
import { nightModeEnabled, setNightMode } from '../editor/theme'
import { aiSummariesEnabled, setAiSummaries, urlLookupEnabled, setUrlLookup, aiConsentGiven, markAiConsent, type AiFeature } from '../editor/aiSettings'
import { AiConsentDialog } from './AiConsentDialog'
import { LimitSelector } from './LimitSelector'

const INK = '#5c2d8a'
// Shared gap between a footer button and the panel it opens (keep the same across all footer panels).
const PANEL_GAP = 14

interface SettingsMenuProps {
  limitN: number | 'infinite'
  onLimitChange: (v: number | 'infinite') => void
}

export function SettingsMenu({ limitN, onLimitChange }: SettingsMenuProps) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [, rerender] = useState(0)
  const [consentFor, setConsentFor] = useState<AiFeature | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onScroll = () => setOpen(false)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions) }
  }, [open])

  function toggle() { setOpen(o => !o) }

  // Centred above the button, with the shared PANEL_GAP — same model as the hamburger menu.
  function menuStyle(): React.CSSProperties {
    const br = btnRef.current?.getBoundingClientRect()
    if (!br) return { position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)' }
    const HALF = 104 // ~half the panel width, for edge clamping
    const center = Math.max(8 + HALF, Math.min(window.innerWidth - 8 - HALF, br.left + br.width / 2))
    return {
      position: 'fixed',
      bottom: Math.round(window.innerHeight - br.top + PANEL_GAP),
      left: Math.round(center),
      transform: 'translateX(-50%)',
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
            className="iw-nightable iw-touch-guard z-[91] w-52 bg-white shadow-lg font-serif text-sm text-stone-600"
            style={{ ...menuStyle(), border: `1px solid ${INK}55`, borderRadius: 12 }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="px-4 pt-3 pb-1 text-[11px] uppercase tracking-wide text-stone-400">Settings</div>

            {/* Night mode — dark writing surface */}
            <Row
              label="Night mode"
              checked={nightModeEnabled()}
              onChange={() => { setNightMode(!nightModeEnabled()); rerender(n => n + 1) }}
            />

            {/* Vocab limit */}
            <div className="flex items-center justify-between px-4 py-2.5">
              <span>Vocab limit</span>
              <LimitSelector value={limitN} onChange={onLimitChange} />
            </div>

            {/* Gapped pages */}
            <Row
              label="Gapped pages"
              checked={gappedPagesEnabled()}
              onChange={() => { setGappedPages(!gappedPagesEnabled()); void flushThenReload() }}
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

            {/* AI opt-ins — off by default; the first off→on shows the consent dialog. */}
            <Row
              label="AI summaries"
              checked={aiSummariesEnabled()}
              onChange={() => {
                if (!aiSummariesEnabled() && !aiConsentGiven('summaries')) { setConsentFor('summaries'); return }
                setAiSummaries(!aiSummariesEnabled()); rerender(n => n + 1)
              }}
            />
            <Row
              label="URL citation lookup"
              checked={urlLookupEnabled()}
              onChange={() => {
                if (!urlLookupEnabled() && !aiConsentGiven('url')) { setConsentFor('url'); return }
                setUrlLookup(!urlLookupEnabled()); rerender(n => n + 1)
              }}
            />

            {/* Debug: highlight all (dev only) */}
            {import.meta.env.DEV && (
              <Row
                label="Debug: highlight all"
                checked={typeof localStorage !== 'undefined' && localStorage.getItem('inkwave:debugHighlightAll') === '1'}
                onChange={() => { try { const on = localStorage.getItem('inkwave:debugHighlightAll') === '1'; localStorage.setItem('inkwave:debugHighlightAll', on ? '0' : '1') } catch { /* private */ } void flushThenReload() }}
              />
            )}

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
                void flushThenReload()
              }}
            />

            <div className="h-2" />
          </div>
        </>,
        document.body,
      )}
      {consentFor && (
        <AiConsentDialog
          feature={consentFor}
          onYes={() => {
            markAiConsent(consentFor)
            if (consentFor === 'summaries') setAiSummaries(true); else setUrlLookup(true)
            setConsentFor(null); rerender(n => n + 1)
          }}
          onNo={() => setConsentFor(null)}
        />
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
        style={{ background: checked ? 'var(--iw-toggle-on, #5c2d8a)' : 'var(--iw-toggle-off, #d1d5db)' }}
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
