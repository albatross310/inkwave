// THE IN-APP SOURCE READER — read the page a citation points at, and cite what you select in it.
//
// Peter, 2026-08-28: "let's build a browser inside our app like ChatGPT does", after being shown
// that an iframe can display a page but can never let us see a selection inside it. That is true of
// an iframe and only of an iframe. So the page is FETCHED (api/_reader-core.mjs — read its header
// for the privacy posture, which Peter authorised explicitly) and arrives as STRUCTURED BLOCKS,
// which are rendered as React elements here. Two consequences, both the point:
//   • the text is in OUR document, so `window.getSelection()` works and "highlight the heading and
//     cite it" is finally expressible;
//   • no HTML string exists anywhere in the path, so injection into an origin holding the writer's
//     thesis and signing session is unrepresentable rather than merely filtered.
//
// The iframe survives as the FALLBACK. Some pages defeat extraction (a JS-rendered app has no prose
// in its HTML) and some hosts refuse framing (JSTOR sends X-Frame-Options: DENY — checked). Between
// them the panel always has something to offer, and it SAYS which mode it is in rather than leaving
// the reader to guess why selection does or doesn't work.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReaderBlock, ReaderDoc, Run } from '../reader/types'
import { locatorForHeading } from '../reader/types'
import type { LocatorKind } from '../citations/locator'

const INK = '#5c2d8a'

/** Hosts known to refuse framing, so the FALLBACK can say so before showing an empty rectangle. */
const KNOWN_NO_FRAME = [/(^|\.)jstor\.org$/i, /(^|\.)sciencedirect\.com$/i, /(^|\.)tandfonline\.com$/i,
  /(^|\.)springer\.com$/i, /(^|\.)wiley\.com$/i, /(^|\.)x\.com$/i, /(^|\.)twitter\.com$/i]

function hostOf(url: string): string {
  try { return new URL(url).host } catch { return '' }
}
export function likelyRefusesFraming(url: string): boolean {
  const h = hostOf(url)
  return !!h && KNOWN_NO_FRAME.some((re) => re.test(h))
}

const ERRORS: Record<string, string> = {
  'blocked host': 'That address points somewhere Inkwave won’t fetch.',
  'bad url': 'That doesn’t look like a web address.',
  'not html': 'That link isn’t a web page (it may be a PDF — attach it to the source instead).',
  'too large': 'That page is unusually large and wasn’t fetched.',
  'no readable text': 'No article text could be found on that page.',
  rate: 'Too many pages fetched just now — try again in a moment.',
}

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((r, i) => {
        let node: React.ReactNode = r.text
        if (r.code) node = <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.92em' }}>{node}</code>
        if (r.em) node = <em>{node}</em>
        if (r.strong) node = <strong>{node}</strong>
        // href is validated on BOTH sides (the server refuses anything but http/s, and so does this)
        // — one rule in two places is how a hole opens, so neither trusts the other.
        if (r.href && /^https?:\/\//i.test(r.href)) {
          node = <a href={r.href} target="_blank" rel="noreferrer noopener" style={{ color: INK, textDecoration: 'underline' }}>{node}</a>
        }
        return <span key={i}>{node}</span>
      })}
    </>
  )
}

export function SourceBrowser({ url, title, onClose, onCite, onQuote }: {
  url: string
  title?: string | null
  onClose: () => void
  /** Cite a part of the source — a section number from a heading, or whatever was selected. */
  onCite?: (loc: { kind: LocatorKind; value: string }) => void
  /** Use the selection as the citation's pinpoint sentence. */
  onQuote?: (quote: string) => void
}) {
  const [doc, setDoc] = useState<ReaderDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [framed, setFramed] = useState(false)   // fell back to the iframe
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    setDoc(null); setError(null); setFramed(false)
    fetch(`/api/reader?url=${encodeURIComponent(url)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({ error: 'fetch failed' }))
        if (!live) return
        if (!r.ok || j.error) { setError(ERRORS[j.error] ?? 'That page couldn’t be read here.'); return }
        setDoc(j as ReaderDoc)
      })
      .catch(() => { if (live) setError('That page couldn’t be reached.') })
    return () => { live = false }
  }, [url])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // THE SELECTION. Read on pointerup inside the reader body only — a selection made in the writer's
  // own document must never be mistaken for one made in the source.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const read = () => {
      const s = window.getSelection()
      if (!s || s.isCollapsed || s.rangeCount === 0) { setSel(null); return }
      const range = s.getRangeAt(0)
      if (!el.contains(range.commonAncestorContainer)) { setSel(null); return }
      const text = s.toString().replace(/\s+/g, ' ').trim()
      if (text.length < 2) { setSel(null); return }
      const r = range.getBoundingClientRect()
      setSel({ text, x: r.left + r.width / 2, y: r.top })
    }
    const t = () => window.setTimeout(read, 0) // let the browser finish the selection first
    el.addEventListener('pointerup', t)
    el.addEventListener('keyup', t)
    return () => { el.removeEventListener('pointerup', t); el.removeEventListener('keyup', t) }
  }, [doc])

  const headings = useMemo(
    () => (doc?.blocks ?? []).filter((b): b is Extract<ReaderBlock, { kind: 'heading' }> => b.kind === 'heading'),
    [doc],
  )

  const citeHeading = (text: string) => { onCite?.(locatorForHeading(text)); setSel(null) }

  return createPortal(
    <div className="fixed inset-0 z-[400] flex items-center justify-center" style={{ background: 'rgba(30,22,45,0.42)' }}
      onMouseDown={onClose}>
      <div className="iw-nightable iw-touch-guard flex flex-col bg-white rounded-xl shadow-2xl overflow-hidden"
        style={{ width: 'min(1100px, 94vw)', height: 'min(880px, 92vh)', border: `1px solid ${INK}44` }}
        onMouseDown={(e) => e.stopPropagation()}>

        <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-200" style={{ fontSize: '13px' }}>
          <span style={{ color: INK, fontWeight: 600 }}>{doc?.title || title || hostOf(url)}</span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-stone-400" style={{ fontSize: '11px', flex: 1 }}>{hostOf(url)}</span>
          <a href={url} target="_blank" rel="noreferrer noopener" className="underline whitespace-nowrap" style={{ color: INK, fontSize: '12px' }}>
            open in a tab ↗
          </a>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#78716c', fontSize: '20px', lineHeight: 1, padding: '0 4px' }}>×</button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Section list — the fastest way to cite a section is to not have to find it first. */}
          {!framed && headings.length > 1 && (
            <nav className="hidden md:block overflow-y-auto border-r border-stone-200 py-2" style={{ width: 220, fontSize: '12px' }}>
              {headings.map((h) => (
                <button key={h.id} type="button"
                  onClick={() => document.getElementById(`iw-rd-${h.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="w-full text-left px-3 py-1 hover:bg-stone-50 flex items-center gap-1 group"
                  style={{ color: '#57534e', paddingLeft: 8 + Math.min(3, Math.max(0, h.level - 1)) * 10 }}>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1">{h.text}</span>
                  {onCite && (
                    <span role="button" title={`Cite this section`}
                      onClick={(e) => { e.stopPropagation(); citeHeading(h.text) }}
                      className="opacity-0 group-hover:opacity-100 px-1 flex-shrink-0"
                      style={{ color: INK, fontWeight: 700 }}>§</span>
                  )}
                </button>
              ))}
            </nav>
          )}

          <div ref={bodyRef} className="flex-1 overflow-y-auto px-8 py-6" style={{ fontFamily: "'EB Garamond', Georgia, serif", fontSize: '17px', lineHeight: 1.62, color: '#2c2a28' }}>
            {error && !framed && (
              <div className="flex flex-col items-center justify-center gap-3 h-full text-center" style={{ fontSize: '14px', color: '#57534e' }}>
                <div style={{ color: INK, fontSize: '15px' }}>{error}</div>
                {!likelyRefusesFraming(url) && (
                  <button type="button" onClick={() => setFramed(true)}
                    className="rounded-full px-3 py-1.5" style={{ border: `1px solid ${INK}55`, color: INK, fontSize: '13px' }}>
                    Try showing the live page instead
                  </button>
                )}
                <a href={url} target="_blank" rel="noreferrer noopener" className="rounded-full px-3 py-1.5 text-white"
                  style={{ background: `linear-gradient(135deg, #7a4fb0, ${INK})`, fontSize: '13px' }}>Open it in a tab ↗</a>
              </div>
            )}
            {!error && !doc && !framed && (
              <div className="flex items-center justify-center h-full" style={{ color: '#a8a29e', fontSize: '13px' }}>reading…</div>
            )}
            {framed && (
              // Live page: readable, but the browser keeps its text out of our reach — so the
              // selection actions are absent here rather than present and silently inert.
              <iframe src={url} title={doc?.title || url} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }} />
            )}
            {doc && !framed && doc.blocks.map((b, i) => {
              if (b.kind === 'heading') {
                const Tag = (`h${Math.min(4, Math.max(1, b.level))}`) as 'h1'
                return (
                  <Tag key={i} id={`iw-rd-${b.id}`} className="group"
                    style={{ fontSize: b.level <= 1 ? '1.5em' : b.level === 2 ? '1.22em' : '1.06em', fontWeight: 600, margin: '1.4em 0 0.5em', color: '#1c1a19' }}>
                    <Runs runs={b.runs} />
                    {onCite && (
                      <button type="button" title="Cite this section" onClick={() => citeHeading(b.text)}
                        className="opacity-0 group-hover:opacity-100"
                        style={{ marginLeft: '0.5em', fontSize: '0.6em', color: INK, border: `1px solid ${INK}44`, borderRadius: 6, padding: '2px 7px', background: 'transparent', cursor: 'pointer', verticalAlign: 'middle' }}>
                        cite §
                      </button>
                    )}
                  </Tag>
                )
              }
              if (b.kind === 'list') {
                const L = b.ordered ? 'ol' : 'ul'
                return (
                  <L key={i} style={{ margin: '0.7em 0 0.7em 1.4em', listStyle: b.ordered ? 'decimal' : 'disc' }}>
                    {b.items.map((it, j) => <li key={j} style={{ margin: '0.25em 0' }}><Runs runs={it} /></li>)}
                  </L>
                )
              }
              if (b.kind === 'quote') {
                return <blockquote key={i} style={{ margin: '0.9em 0', paddingLeft: '1em', borderLeft: `3px solid ${INK}33`, color: '#4b4844' }}><Runs runs={b.runs} /></blockquote>
              }
              if (b.kind === 'code') {
                return <pre key={i} style={{ margin: '0.9em 0', padding: '0.7em', background: '#00000008', borderRadius: 6, overflowX: 'auto', fontSize: '0.88em' }}><Runs runs={b.runs} /></pre>
              }
              return <p key={i} style={{ margin: '0.85em 0' }}><Runs runs={b.runs} /></p>
            })}
          </div>
        </div>

        {/* Floating actions over a selection — the whole reason the page is fetched rather than framed. */}
        {sel && !framed && (onCite || onQuote) && (
          <div className="iw-nightable fixed z-[401] flex items-center gap-1 bg-white rounded-full shadow-lg px-1.5 py-1"
            style={{ left: sel.x, top: Math.max(8, sel.y - 42), transform: 'translateX(-50%)', border: `1px solid ${INK}44`, fontSize: '12px' }}
            onMouseDown={(e) => e.preventDefault()}>
            {onQuote && (
              <button type="button" onClick={() => { onQuote(sel.text); setSel(null) }}
                className="rounded-full px-2.5 py-1" style={{ color: INK, background: 'transparent', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                use as cited sentence
              </button>
            )}
            {onCite && (
              <button type="button" onClick={() => { onCite(locatorForHeading(sel.text)); setSel(null) }}
                className="rounded-full px-2.5 py-1" style={{ color: INK, background: 'transparent', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                cite as locator
              </button>
            )}
          </div>
        )}

        <div className="px-3 py-1.5 border-t border-stone-200 text-stone-400 flex items-center gap-2" style={{ fontSize: '11px' }}>
          {framed
            ? <span>Live page — your browser keeps it separate from Inkwave, so text selected here can’t be picked up.</span>
            : <span>Article text, fetched for you. Inkwave keeps no log and no copy of what you read — but it does see the address for the moment it takes to fetch.</span>}
        </div>
      </div>
    </div>,
    document.body,
  )
}
