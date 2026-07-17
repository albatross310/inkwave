// The media-import slot — Peter's "photo import button (which has photo or audio or video)".
//
// A SLOT IS A TRIGGER, NEVER AN OWNER (toolbarContract.ts): this renders the circle and the
// drop-up and calls `importMedia`. It owns no store, no size rule and no MIME rule — the music
// lane's "import directly" path calls the same function, which is what makes Peter's two paths
// converge BY CONSTRUCTION rather than by agreement.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { v4 as uuidv4 } from 'uuid'
import { importMedia, mb, MEDIA_LIMIT_BYTES } from '../media/mediaStore'
import type { MediaAsset, MediaKind } from '../media/types'
import { isTouchDevice } from '../editor/Scroll'

const INK = 'var(--iw-ink, #5c2d8a)'

// Peter's three, each its own tap. One "import" button opening a file picker for everything would
// be fewer taps and worse: on iOS the picker's source (camera / photo library / files) follows the
// accept list, so a single any-file input sends a writer photographing a page into the file browser.
const KINDS: { kind: MediaKind; label: string; accept: string; glyph: string }[] = [
  { kind: 'photo', label: 'Photo', accept: 'image/*', glyph: '❐' },
  { kind: 'audio', label: 'Audio', accept: 'audio/*', glyph: '♪' },
  { kind: 'video', label: 'Video', accept: 'video/*', glyph: '▷' },
]

export function MediaMenu({ assets, onImported }: {
  assets: readonly MediaAsset[]
  onImported: (asset: MediaAsset) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<MediaKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingKind = useRef<MediaKind | null>(null)
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)
  const isTouch = isTouchDevice()

  useEffect(() => {
    if (!open) { setError(null); return }
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ left: r.left + r.width / 2, bottom: window.innerHeight - r.top + 8 })
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset FIRST: re-picking the SAME file fires no change event otherwise, so a failed import
    // could never be retried with the same file — which is exactly when a writer retries.
    e.target.value = ''
    if (!file) return
    setBusy(pendingKind.current)
    setError(null)
    const res = await importMedia(file, uuidv4())
    setBusy(null)
    if (!res.ok) { setError(res.reason); return }
    onImported(res.asset)
    setOpen(false)
  }

  const panel = pos && (
    <div
      ref={panelRef}
      // iw-touch-guard is MANDATORY on a PORTALED drop-up (CLAUDE.md): a tap outside the
      // contenteditable blurs it on iOS → the keyboard retracts → the docked pill and this menu
      // slide to the screen bottom. iw-nightable or it renders white-on-white in night mode.
      className={`iw-nightable iw-touch-guard fixed z-[120] bg-white rounded-2xl shadow-xl font-serif flex flex-col ${open ? '' : 'invisible pointer-events-none'}`}
      style={{
        left: pos.left, bottom: pos.bottom, transform: 'translateX(-50%)',
        border: `1px solid var(--iw-nightable-border, ${INK}bf)`,
        // Peter: "Every font proportionally up. It's okay if users have to scroll." Nothing here
        // may drop below 16px — iOS auto-zooms (and STAYS zoomed) on controls under it.
        fontSize: 17, minWidth: 200, padding: 8,
      }}
    >
      {KINDS.map(k => (
        <button
          key={k.kind}
          type="button"
          disabled={busy !== null}
          onClick={() => { pendingKind.current = k.kind; fileRef.current?.setAttribute('accept', k.accept); fileRef.current?.click() }}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-stone-50 disabled:opacity-50 text-left"
          style={{ color: INK, minHeight: 44 }}
        >
          <span style={{ width: 22, textAlign: 'center', fontSize: 18 }}>{k.glyph}</span>
          <span>{busy === k.kind ? 'Importing…' : k.label}</span>
        </button>
      ))}
      <div className="px-3 pt-1.5 pb-0.5" style={{ fontSize: 16, color: 'var(--iw-pill-fg, #78716c)' }}>
        {error
          // The failure is the writer's to see, not the console's — the storage rule from 15 July.
          ? <span style={{ color: '#b45309' }}>{error}</span>
          : assets.length > 0
            ? `${assets.length} file${assets.length === 1 ? '' : 's'} in this document`
            : `Up to ${mb(MEDIA_LIMIT_BYTES)}, kept on this device`}
      </div>
    </div>
  )

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-pressed={open}
        onClick={() => setOpen(o => !o)}
        className={`flex items-center justify-center ${isTouch ? '' : 'min-w-[44px]'} min-h-[44px] transition-colors font-serif ${open ? 'text-[#5c2d8a]' : 'text-stone-400 hover:text-[#5c2d8a]'}`}
        title="Import a photo, audio or video"
      >
        <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-[15px] leading-none">❐</span>
      </button>
      {/* No `accept` extension LIST on touch (CLAUDE.md: unregistered UTIs grey out every file) —
          these are wildcard `image/*` groups, which iOS resolves to the right picker source. */}
      <input ref={fileRef} type="file" className="hidden" onChange={onFile} />
      {open && createPortal(panel, document.body)}
    </div>
  )
}
