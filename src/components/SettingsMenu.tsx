import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isTouchDevice } from '../editor/isTouchDevice'
import { PANEL_ATTR, PANEL_TRIGGER_ATTR } from '../editor/toolbarContract'
import { PHONE_SHEET_CLASS, phoneSheetStyle } from '../styles/panelSheet'
import { SheetHeader, SheetSection } from './PanelSheet'
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
import { scasSuggestionsEnabled, setScasSuggestionsEnabled } from '../scas/display'

const INK = '#302438'
// Shared gap between a footer button and the panel it opens (keep the same across all footer panels).
const PANEL_GAP = 14

interface SettingsMenuProps {
  limitN: number | 'infinite'
  onLimitChange: (v: number | 'infinite') => void
  /** Lifted open state (toolbarContract.ts: a slot is a trigger, never an owner). */
  open?: boolean
  onOpenChange?: (v: boolean) => void
}

const isPhone = isTouchDevice()

export function SettingsMenu({ limitN, onLimitChange, open: openProp, onOpenChange }: SettingsMenuProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = openProp ?? internalOpen
  const setOpen = (v: boolean) => { onOpenChange ? onOpenChange(v) : setInternalOpen(v) }
  // Phone with the keyboard up: the panel must fit the REDUCED visual viewport above the
  // keyboard — render the rows in TWO columns (wider, half the height). Captured at open time
  // (__iwKeyboardUp is the editor's live flag; the toolbar focus guard keeps the keyboard up
  // while the menu is open, so the state can't flip under it).
  const [twoCol, setTwoCol] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [, rerender] = useState(0)
  const [consentFor, setConsentFor] = useState<AiFeature | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    // Desktop only: a page scroll dismisses. On phone the sheet is pinned above the toolbar and
    // scrolls INSIDE itself; the outside-tap rule (TiptapEditor) is what closes it.
    const onScroll = () => { if (!isPhone) setOpen(false) }
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions) }
  }, [open])

  function toggle() {
    setTwoCol(!!(window as unknown as { __iwKeyboardUp?: boolean }).__iwKeyboardUp)
    setOpen(!open)
  }

  // Phone: the shared sheet (styles/panelSheet.ts). Desktop: centred above the button, with the
  // shared PANEL_GAP — same model as the hamburger menu.
  function menuStyle(): React.CSSProperties {
    if (isPhone) return phoneSheetStyle()
    const br = btnRef.current?.getBoundingClientRect()
    if (!br) return { position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)' }
    const HALF = twoCol ? 184 : 104 // ~half the panel width, for edge clamping
    const center = Math.max(8 + HALF, Math.min(window.innerWidth - 8 - HALF, br.left + br.width / 2))
    // Keyboard up: cap the panel to the visual-viewport band above the docked pill (the panel
    // opens above the toolbar, which hugs the keyboard) and scroll any overflow.
    const vvH = window.visualViewport?.height ?? window.innerHeight
    return {
      position: 'fixed',
      bottom: Math.round(window.innerHeight - br.top + PANEL_GAP),
      left: Math.round(center),
      transform: 'translateX(-50%)',
      ...(twoCol ? { maxHeight: Math.max(160, vvH - 120), overflowY: 'auto' as const } : {}),
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        {...{ [PANEL_TRIGGER_ATTR]: 'settings' }}
        onClick={toggle}
        className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors ${open ? 'text-[#302438]' : 'text-stone-400 hover:text-[#302438]'}`}
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
          {/* Desktop scrim (pointerdown — iOS withholds mousedown under the touch guard). None on
              phone: it would sit over the footer and eat the tap meant for the next button. */}
          {!isPhone && <div className="fixed inset-0 z-[90]" aria-hidden="true" onPointerDown={() => setOpen(false)} />}
          <div
            role="dialog"
            aria-label="Settings"
            {...{ [PANEL_ATTR]: 'settings' }}
            className={`iw-nightable iw-touch-guard z-[91] ${isPhone ? PHONE_SHEET_CLASS : twoCol ? 'w-[23rem] max-w-[94vw]' : 'w-52'} bg-white shadow-lg font-serif text-sm text-stone-600`}
            style={isPhone ? menuStyle() : { ...menuStyle(), border: `1px solid ${INK}55`, borderRadius: 12 }}
            onMouseDown={e => e.stopPropagation()}
          >
            <SheetHeader title="Settings" onClose={() => setOpen(false)} />
            {/* Desktop with the keyboard up: two columns. Phone: ONE column — the sheet scrolls
                inside its cap (index.css), and two columns at 390px wrapped every second label. */}
            <div className={twoCol && !isPhone ? 'grid grid-cols-2 gap-x-1 items-center' : undefined}>

            {/* Peter, 2026-09-17: grouped — how the page LOOKS, then how the WRITING behaves, then the
                two AI opt-ins (off by default; the first off→on shows the consent dialog). */}
            {isPhone && <SheetSection label="Page" />}
            <Row label="Night mode" checked={nightModeEnabled()}
              onChange={() => { setNightMode(!nightModeEnabled()); rerender(n => n + 1) }} />
            <Row label="Gapped pages" checked={gappedPagesEnabled()}
              onChange={() => { setGappedPages(!gappedPagesEnabled()); void flushThenReload() }} />
            <Row label="Watermark" checked={watermarkEnabled()}
              onChange={() => { setWatermark(!watermarkEnabled()); rerender(n => n + 1) }} />

            {isPhone && <SheetSection label="Writing" />}
            <div className="flex items-center justify-between px-4 py-2.5">
              <span>Vocab limit</span>
              <LimitSelector value={limitN} onChange={onLimitChange} />
            </div>
            {/* SCAS suggestions — OFF by default; an explicit choice is remembered. Live toggle
                (no reload): only the highlight decorations are suppressed; the SCAS engine keeps running. */}
            <Row label="SCAS suggestions" checked={scasSuggestionsEnabled()}
              onChange={() => {
                setScasSuggestionsEnabled(!scasSuggestionsEnabled())
                window.dispatchEvent(new Event('inkwave:scas-display-changed'))
                rerender(n => n + 1) // update this toggle's checked state
              }} />
            {/* Old word display */}
            <div className="flex items-center justify-between px-4 py-2.5">
              <span>Old word</span>
              <button type="button"
                onClick={() => { cycleCrossoutMode(); rerender(n => n + 1) }}
                className="text-xs px-2 py-0.5 rounded-full hover:bg-stone-100 transition-colors tabular-nums"
                style={{ color: INK, border: `1px solid ${INK}44` }}
                title="Cycle old-word display style">
                {crossoutMode()}
              </button>
            </div>
            {/* SCAS testing mode — highlights all exclusion-set words, not just the ones in your text
                (this is also the dev "highlight all" switch: one key, one row). */}
            <Row label="SCAS test mode"
              checked={typeof localStorage !== 'undefined' && localStorage.getItem('inkwave:debugHighlightAll') === '1'}
              onChange={() => {
                try { localStorage.setItem('inkwave:debugHighlightAll', localStorage.getItem('inkwave:debugHighlightAll') === '1' ? '0' : '1') } catch { /* private mode */ }
                void flushThenReload()
              }} />

            {isPhone && <SheetSection label="AI" />}
            <Row label="AI summaries" checked={aiSummariesEnabled()}
              onChange={() => {
                if (!aiSummariesEnabled() && !aiConsentGiven('summaries')) { setConsentFor('summaries'); return }
                setAiSummaries(!aiSummariesEnabled()); rerender(n => n + 1)
              }} />
            <Row label="URL citation lookup" checked={urlLookupEnabled()}
              onChange={() => {
                if (!urlLookupEnabled() && !aiConsentGiven('url')) { setConsentFor('url'); return }
                setUrlLookup(!urlLookupEnabled()); rerender(n => n + 1)
              }} />

            </div>

            {/* Build marker — which deploy is this device actually running? (Peter checks on
                phone, where devtools aren't available; the console line logs the same pair.) */}
            <div className="px-4 pt-1 pb-1 text-[10px] text-stone-400 select-all">
              build {__BUILD_ID__} · {__BUILD_COMMIT__}
            </div>

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
      {/* Phone: a thumb-sized switch (46×28, Peter 2026-09-17 "buttons bigger and clearer"). */}
      <span
        className="rounded-full flex items-center transition-colors relative shrink-0"
        style={{ width: isPhone ? 46 : 32, height: isPhone ? 28 : 16, background: checked ? 'var(--iw-toggle-on, #302438)' : 'var(--iw-toggle-off, #d1d5db)' }}
      >
        <span
          className="absolute bg-white rounded-full shadow-sm transition-transform"
          style={{ left: 2, width: isPhone ? 24 : 12, height: isPhone ? 24 : 12, transform: checked ? `translateX(${isPhone ? 18 : 16}px)` : 'translateX(0)' }}
        />
        <input type="checkbox" className="sr-only" checked={checked} onChange={onChange} />
      </span>
    </label>
  )
}
