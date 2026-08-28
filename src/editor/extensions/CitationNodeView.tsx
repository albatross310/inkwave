// React NodeView for CitationNode.
// Mirrors the subscription pattern from ReferenceListNodeView (which demonstrably works):
// queueMicrotask-deferred setState, bibProvider.subscribe, subscribeCitationStyle, and
// editor.on('update'). The microtask deferral avoids calling setState synchronously inside
// Tiptap's flushSync-driven render cycle, which causes React's "flushSync during render" error.
//
// Each citekey renders as its own clickable segment: it carries the occurrence anchor id
// (iwcite-<key>-<n>) that reference back-refs scroll to, and clicking it scrolls to that source's
// entry in the reference list. See citationNav.ts.

import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { NodeViewProps } from '@tiptap/react'
import { NodeViewWrapper } from '@tiptap/react'
import { formatLocator, asLocatorKind, mergesWithPdfPages, LOCATOR_KINDS } from '../../citations/locator'
import { SourceBrowser } from '../../components/SourceBrowser'
import { bibProvider } from '../../citations/bibProvider'
import { subscribeCitationStyle } from '../../citations/citationsBus'
import {
  citeAnchorId, navigateToBibEntry, occurrencesAt, ensureNavStyles, mergePages, locatorPages, formatPages,
} from '../../citations/citationNav'
import { openPdf, pageFromLocator, getLastPdfPage } from '../../citations/pdfViewer'
import { highlightPages, highlightsOf, saveHighlights } from '../../citations/pdfHighlights'
import { pageOffsetOf } from '../../citations/pageOffset'
import { hasPdf } from '../../citations/pdfSource'
import { sourceUrlOf, openSourceAtPinpoint } from '../../citations/sourceLink'
import type { CSLItem, InkwaveDocument } from '../../types/document'
import type { CitationAttrs } from './CitationNode'

const INK = '#5c2d8a'

// The page input lives inside the editor DOM, so native editing events must be stopped before they
// bubble to ProseMirror (React handlers fire too late). Same fix as the bibliography notes field.
const STOP_TYPES = ['keydown', 'keyup', 'cut', 'copy', 'paste', 'drop', 'dragstart', 'mousedown', 'pointerdown', 'click']
function bindStopPM(el: HTMLInputElement | null): void {
  const marked = el as (HTMLInputElement & { _iwStopBound?: boolean }) | null
  if (!marked || marked._iwStopBound) return
  marked._iwStopBound = true
  const stop = (e: Event) => e.stopPropagation()
  for (const t of STOP_TYPES) marked.addEventListener(t, stop)
}

// One item's in-text text — "Bacon, 2004" / "Smith et al., 2004, 2–4" / (suppressAuthor) "2004".
// `pages` is the already-merged page string (manual locator ∪ pages carrying a PDF highlight).
function oneCiteText(item: CSLItem, opts: { suppressAuthor?: boolean; pages?: string }): string {
  const authors = item.author ?? []
  let name: string
  if (authors.length === 0) {
    name = opts.suppressAuthor ? '' : (typeof item.title === 'string' ? item.title.slice(0, 20) : '?')
  } else if (opts.suppressAuthor) {
    name = ''
  } else if (authors.length === 1) {
    name = authors[0].family ?? authors[0].literal ?? '?'
  } else if (authors.length === 2) {
    const a = authors[0].family ?? authors[0].literal ?? '?'
    const b = authors[1].family ?? authors[1].literal ?? '?'
    name = `${a} & ${b}`
  } else {
    name = `${authors[0].family ?? authors[0].literal ?? '?'} et al.`
  }
  const year = item.issued?.['date-parts']?.[0]?.[0] ?? 'n.d.'
  const loc = opts.pages ? `, ${opts.pages}` : ''
  return opts.suppressAuthor ? `${year}${loc}` : `${name}, ${year}${loc}`
}

interface Seg {
  key: string
  text: string       // author-year WITHOUT the page (the page is a separate link now)
  pages: string      // "p. 5" / "pp. 3–7" — clickable, opens the source at that page
  // SPLIT RENDERING (Peter, 2026-07-10): when BOTH highlight-derived pages AND an explicit in-text
  // locator exist, the highlight pages DELINK (plain text, `plainPages`) and the locator renders as
  // ', esp. X' (`espLoc`) — still the clickable ref. Either kind alone → `pages` as before.
  plainPages: string // highlight-derived pages, deduped of locator pages — plain text, no nav
  espLoc: string     // the instance-linked locator — non-empty ⇒ split mode
  pageNum: number | null
  hasPdf: boolean
  occ: number
  found: boolean
}

export function CitationNodeView({ node, editor, selected, getPos, updateAttributes }: NodeViewProps & { _doc?: InkwaveDocument }) {
  const attrs = node.attrs as CitationAttrs
  const [segs, setSegs] = useState<Seg[]>([])
  const [pageEdit, setPageEdit] = useState<{ key: string; x: number; y: number; fromPage?: boolean } | null>(null)
  // The in-app source reader (components/SourceBrowser.tsx) — read the page this citation points at
  // without losing your place in the document.
  const [readerUrl, setReaderUrl] = useState<{ url: string; title: string } | null>(null)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heldRef = useRef(false)

  useEffect(() => {
    if (!pageEdit) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && (e.target as HTMLElement)?.closest?.('[data-iw-pagepop]')) return
      setPageEdit(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close) }
  }, [pageEdit])

  // Always-current ref — avoids stale closure inside the subscription callback.
  const attrsRef = useRef(attrs)
  attrsRef.current = attrs

  const buildLabel = useCallback(() => {
    const a = attrsRef.current
    const pos = typeof getPos === 'function' ? getPos() : null
    const occMap = pos != null ? occurrencesAt(editor.state.doc, pos) : new Map<string, number>()
    const next: Seg[] = a.citekeys.map(key => {
      const item = bibProvider.get(key)
      // Displayed pages = manual locator ∪ printed pages carrying a highlight made from THIS citation
      // occurrence (per-instance) — highlights from other inlines / the bib don't add pages here.
      const off = pageOffsetOf(item)
      const iid = (a as { instanceId?: string | null }).instanceId ?? null
      const hlPages = item ? highlightPages(item, iid).map(p => p + off) : []
      // SPLIT RENDERING (Peter, 2026-07-10): both kinds present → highlight pages delink (plain)
      // and the actually-linked locator gets ', esp. X' (the clickable ref). Locator pages are
      // deduped OUT of the plain list; if that empties it, only one kind remains → render as today.
      let plainPages = '', espLoc = ''
      // Legacy docs carry numeric locators (locator: 12, not '12') — coerce before any string
      // ops (a bare .trim() here was a live keydown TypeError on Peter's thesis, 2026-07-12).
      const locStr = a.locator == null ? '' : String(a.locator)
      if (item && locStr && hlPages.length) {
        const locSet = new Set(locatorPages(locStr))
        const rest = [...new Set(hlPages.filter(p => !locSet.has(p)))].sort((x, y) => x - y)
        if (rest.length && (locSet.size || locStr.trim())) { plainPages = formatPages(rest); espLoc = locStr.trim() }
      }
      // A SECTION IS NOT A PAGE (2026-08-28). Highlight-derived pages may only union with a PAGE
      // locator — merging them into "§2.1" would print "§2.1, 7", two different quantities in one
      // reference. For every other kind the locator stands alone and the highlight pages, if any,
      // render as the plain (unlinked) list they already have.
      const kind = asLocatorKind(a.locatorKind)
      const canMerge = mergesWithPdfPages(kind)
      const pages = item && !espLoc ? (canMerge ? mergePages(locStr, hlPages) : locStr.trim()) : ''
      const pageLabel = formatLocator(pages, kind)
      return item
        // text is author-year only (pages passed empty) so the page can be its OWN clickable link.
        ? { key, text: oneCiteText(item, { suppressAuthor: a.suppressAuthor, pages: '' }), pages: pageLabel, plainPages, espLoc, pageNum: (espLoc ? pageFromLocator(espLoc) : pageFromLocator(pages)) ?? null, hasPdf: hasPdf(item), occ: occMap.get(key) ?? 1, found: true }
        : { key, text: `?${key}`, pages: '', plainPages: '', espLoc: '', pageNum: null, hasPdf: false, occ: occMap.get(key) ?? 1, found: false }
    })
    setSegs(next)
  }, [editor, getPos]) // reads attrs from attrsRef

  // The sentence in the editor immediately before this citation — shown in the PDF viewer so the reader
  // knows what claim they're sourcing. Text from the block start to the citation, last sentence only.
  const precedingSentence = useCallback((): string | null => {
    try {
      const pos = typeof getPos === 'function' ? getPos() : null
      if (pos == null) return null
      const $pos = editor.state.doc.resolve(pos)
      const before = editor.state.doc.textBetween($pos.start(), pos, ' ', ' ').trim()
      if (!before) return null
      const m = before.match(/[^.!?]*$/)
      const sent = (m && m[0].trim() ? m[0] : before).trim()
      return sent.length > 160 ? `…${sent.slice(-160)}` : sent
    } catch { return null }
  }, [editor, getPos])

  // Keep a ref so the subscription closure always calls the current version.
  const buildLabelRef = useRef(buildLabel)
  buildLabelRef.current = buildLabel

  useEffect(() => { ensureNavStyles() }, [])

  useEffect(() => {
    // queueMicrotask: defer setState so it never runs synchronously inside Tiptap's flushSync
    // render cycle (mirrors ReferenceListNodeView's proven subscription pattern).
    const schedule = () => queueMicrotask(() => buildLabelRef.current())
    // DEBOUNCED rebuild for doc edits: every citation node subscribes to 'update', and each rebuild
    // walks the whole doc (occurrencesAt) to re-number — so rebuilding all of them on EVERY keystroke
    // is O(citations × docSize) per keystroke, the mid-editing lag on a citation-heavy thesis. Occurrence
    // numbering only needs to catch up shortly after typing settles, so debounce it. (bib/style changes
    // stay immediate — they're rare.)
    let updTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleFromEdit = () => { if (updTimer) clearTimeout(updTimer); updTimer = setTimeout(schedule, 350) }
    schedule() // initial build on mount / re-mount
    const unsubBib = bibProvider.subscribe(schedule)
    const unsubStyle = subscribeCitationStyle(schedule)
    editor.on('update', scheduleFromEdit)
    window.addEventListener('inkwave:bib-changed', schedule)
    return () => {
      unsubBib()
      unsubStyle()
      editor.off('update', scheduleFromEdit)
      if (updTimer) clearTimeout(updTimer)
      window.removeEventListener('inkwave:bib-changed', schedule)
    }
  }, [editor]) // re-subscribe if editor instance changes

  // Also rebuild when node attrs change (e.g., different citekeys after editing a citation).
  useEffect(() => {
    queueMicrotask(() => buildLabelRef.current())
  }, [attrs.citekeys, attrs.suppressAuthor, attrs.locator, attrs.locatorKind, attrs.prefix, attrs.suffix])

  const hasMissing = segs.some(s => !s.found)
  const pre = attrs.prefix ? `${attrs.prefix} ` : ''
  const suf = attrs.suffix ?? ''
  const pageEditUrl = pageEdit ? sourceUrlOf(bibProvider.get(pageEdit.key)) : null

  // Navigate to the cited sentence: PDF (at the quote) when this source has one, else the web source.
  function goToPinpoint() {
    if (!pageEdit) return
    const key = pageEdit.key
    if (hasPdf(bibProvider.get(key))) {
      openPdf({
        citekey: key, page: pageFromLocator(attrs.locator), quote: attrs.quote,
        label: segs.find(s => s.key === key)?.text ?? key,
        onLink: (quote) => updateAttributes({ quote }),
      })
    } else if (pageEditUrl) {
      openSourceAtPinpoint(pageEditUrl, { quote: attrs.quote, page: pageFromLocator(attrs.locator) })
    }
    setPageEdit(null)
  }

  // Delete this citation's page reference: clear the manual locator AND drop the highlights that
  // auto-generated pages for THIS occurrence — so the reader needn't hunt them down with the eraser.
  function deletePageRef() {
    if (!pageEdit) return
    const key = pageEdit.key
    updateAttributes({ locator: null })
    const iid = (attrsRef.current as { instanceId?: string | null }).instanceId ?? null
    if (iid) {
      const item = bibProvider.get(key)
      if (item) void saveHighlights(key, highlightsOf(item).filter(h => h.instanceId !== iid))
    }
    setPageEdit(null)
  }

  return (
    <NodeViewWrapper as="span" style={{ display: 'inline' }}>
      <span
        contentEditable={false}
        style={{
          // OPAQUE BOX (2026-07-16, Peter — the citation-eligibility unlock): the injected PM sheet
          // gives every [contenteditable=false] subtree `white-space: normal`, so a citation's label
          // used to FLOW IN THE PARENT'S LINE under a DIFFERENT wrap rule (normal HANGS its trailing
          // space + collapses space runs; the surrounding body text is break-spaces, which does
          // neither). That made a citation-bearing paragraph genuinely mixed-mode — unmodellable by
          // the arithmetic layout engine, so every one of them deferred to the full DOM reflow.
          // `nowrap` removes every break opportunity INSIDE the label, so the parent line can only
          // break BEFORE or AFTER it: the citation becomes one unbreakable inline box whose width is
          // measurable once and cached (see citeBox.ts). The mixed mode can no longer leak into the
          // parent's line breaking because there is nothing inside left to break.
          // TRADEOFF (Peter approved): a long citation now moves to the next line WHOLE rather than
          // splitting mid-label — which is what you usually want typographically anyway.
          whiteSpace: 'nowrap',
          // via a CSS var so night mode can recolour citations (light blue) without an inline override.
          color: hasMissing ? '#b91c1c' : 'var(--iw-cite-color, #5c2d8a)',
          background: selected ? `${INK}18` : undefined,
          borderRadius: 3,
          // margin, not padding: margins are OUTSIDE the hit box, so a click immediately beside the
          // citation lands the caret next to it (e.g. to type a full stop) instead of selecting the
          // atom (Peter, 2026-07-10). Visual spacing unchanged.
          margin: '0 2px',
          padding: 0,
          cursor: 'default',
          userSelect: 'none',
          fontFamily: 'inherit',
          fontSize: 'inherit',
        }}
      >
        {segs.length === 0
          ? `[${attrs.citekeys.join('; ')}]`
          : (
            <>
              {pre}(
              {segs.map((s, i) => (
                <span key={s.key + i}>
                  {s.found ? (
                    <>
                      {/* Author-year — click opens the SOURCE PDF where the reader last left off (or the
                          reference entry if there's no PDF); click & hold sets pages. */}
                      <span
                        id={citeAnchorId(s.key, s.occ)}
                        className="iw-cite-link"
                        style={{ color: 'var(--iw-cite-color, #5c2d8a)' }}
                        title={s.hasPdf ? 'Click: open the source where you left off · Click & hold: set page(s)' : 'Click: go to the reference · Click & hold: set page(s)'}
                        onPointerDown={e => {
                          e.stopPropagation()
                          heldRef.current = false
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                          holdTimer.current = setTimeout(() => {
                            heldRef.current = true
                            setPageEdit({ key: s.key, x: r.left + r.width / 2, y: r.top })
                          }, 450)
                        }}
                        onPointerUp={() => { if (holdTimer.current) clearTimeout(holdTimer.current) }}
                        onPointerLeave={() => { if (holdTimer.current) clearTimeout(holdTimer.current) }}
                        onPointerCancel={() => { if (holdTimer.current) clearTimeout(holdTimer.current) }}
                        onClick={e => {
                          e.stopPropagation()
                          if (heldRef.current) { heldRef.current = false; return } // opened the popover — don't navigate
                          // Always pop the panel — it shows "No attachment" when the source has no PDF.
                          // NB: no `quote` here — author/year opens where you LEFT OFF, not at the cited
                          // pinpoint (the page-number link is what jumps to the quote).
                          const iid = (attrs as { instanceId?: string | null }).instanceId ?? null
                          openPdf({ citekey: s.key, page: getLastPdfPage(s.key), restoreScroll: true, label: s.text, instanceId: iid, context: precedingSentence(), onLink: (quote) => updateAttributes({ quote }) })
                        }}
                      >
                        {s.text}
                      </span>
                      {/* SPLIT page refs (Peter, 2026-07-10): highlight-derived pages render PLAIN
                          (delinked); the in-text-linked locator renders ', esp. X' and stays the
                          clickable ref (same click-to-open + hold-to-edit as the merged link). */}
                      {s.espLoc ? (
                        <>
                          {`, pp. ${s.plainPages}, `}
                          {s.hasPdf ? (
                            <span className="iw-cite-link" style={{ color: 'var(--iw-cite-color, #5c2d8a)' }}
                              title="Click: open the source at the linked page · Click & hold: edit / delete the page reference"
                              onPointerDown={e => {
                                e.stopPropagation()
                                heldRef.current = false
                                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                holdTimer.current = setTimeout(() => { heldRef.current = true; setPageEdit({ key: s.key, x: r.left + r.width / 2, y: r.top, fromPage: true }) }, 450)
                              }}
                              onPointerUp={() => { if (holdTimer.current) clearTimeout(holdTimer.current) }}
                              onPointerLeave={() => { if (holdTimer.current) clearTimeout(holdTimer.current) }}
                              onPointerCancel={() => { if (holdTimer.current) clearTimeout(holdTimer.current) }}
                              onClick={e => {
                                e.stopPropagation()
                                if (heldRef.current) { heldRef.current = false; return }
                                const iid = (attrs as { instanceId?: string | null }).instanceId ?? null
                                openPdf({ citekey: s.key, page: s.pageNum ?? pageFromLocator(attrs.locator), quote: attrs.quote, label: s.text, instanceId: iid, context: precedingSentence(), onLink: (quote) => updateAttributes({ quote }) })
                              }}
                            >{`esp. ${s.espLoc}`}</span>
                          ) : <>{`esp. ${s.espLoc}`}</>}
                        </>
                      ) :
                      /* Page(s) — clickable link that opens the SOURCE (PDF) at that page/passage. */
                      s.pages && (
                        s.hasPdf ? (
                          <>
                            {', '}
                            <span className="iw-cite-link" style={{ color: 'var(--iw-cite-color, #5c2d8a)' }}
                              title="Click: open the source here · Click & hold: edit / delete the page reference"
                              onPointerDown={e => {
                                e.stopPropagation()
                                heldRef.current = false
                                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                                holdTimer.current = setTimeout(() => { heldRef.current = true; setPageEdit({ key: s.key, x: r.left + r.width / 2, y: r.top, fromPage: true }) }, 450)
                              }}
                              onPointerUp={() => { if (holdTimer.current) clearTimeout(holdTimer.current) }}
                              onPointerLeave={() => { if (holdTimer.current) clearTimeout(holdTimer.current) }}
                              onPointerCancel={() => { if (holdTimer.current) clearTimeout(holdTimer.current) }}
                              onClick={e => {
                                e.stopPropagation()
                                if (heldRef.current) { heldRef.current = false; return }
                                const iid = (attrs as { instanceId?: string | null }).instanceId ?? null
                                openPdf({ citekey: s.key, page: s.pageNum ?? pageFromLocator(attrs.locator), quote: attrs.quote, label: s.text, instanceId: iid, context: precedingSentence(), onLink: (quote) => updateAttributes({ quote }) })
                              }}
                            >{s.pages}</span>
                          </>
                        ) : <>{', '}{s.pages}</>
                      )}
                      {/* Side button → the bibliography entry (moved off the whole inline). */}
                      {', '}
                      <button type="button" contentEditable={false} className="iw-cite-biblink"
                        data-iw-biblink={citeAnchorId(s.key, s.occ)}
                        title="Go to the reference-list entry"
                        onPointerDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); navigateToBibEntry(s.key, s.occ) }}
                      ><span className="iw-biblink-arrow">⤵</span></button>
                    </>
                  ) : (
                    <span id={citeAnchorId(s.key, s.occ)} style={{ color: '#b91c1c' }} title={`Unresolved: ${s.key}`}>
                      {s.text}
                    </span>
                  )}
                  {i < segs.length - 1 ? '; ' : ''}
                </span>
              ))}
              ){suf}
            </>
          )}
      </span>
      {pageEdit && createPortal(
        <span
          data-iw-pagepop=""
          className="iw-nightable"
          contentEditable={false}
          onMouseDown={e => e.stopPropagation()}
          style={{
            position: 'fixed', left: pageEdit.x, top: pageEdit.y, zIndex: 300,
            transform: 'translate(-50%, calc(-100% - 8px))', // centred directly above the citation
            background: '#fff', border: `1px solid ${INK}55`, borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.16)', padding: '6px 8px',
            display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, fontSize: '12px', color: '#57534e',
            fontFamily: 'system-ui, sans-serif', userSelect: 'none',
          }}
        >
          {/* WHAT is being cited — page (the default, and what every existing citation keeps),
              section, paragraph, chapter, line, note. Peter, 2026-08-28: "cite paragraphs etc."
              You can also just TYPE it: "§2.1" or "ch. 2" is left exactly as written whatever this
              says (citations/locator.ts), so the picker is a convenience, never a toll gate. */}
          <select
            ref={bindStopPM as unknown as React.Ref<HTMLSelectElement>}
            value={asLocatorKind(attrs.locatorKind)}
            onChange={e => updateAttributes({ locatorKind: e.target.value === 'page' ? null : e.target.value })}
            title="What part of the source is being cited"
            style={{ fontSize: '12px', border: `1px solid ${INK}33`, borderRadius: 4, padding: '2px 3px', outline: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
          >
            {LOCATOR_KINDS.map(k => (
              <option key={k.kind} value={k.kind}>{k.short === '—' ? 'as written' : k.short}</option>
            ))}
          </select>
          <input
            ref={bindStopPM}
            autoFocus
            value={attrs.locator ?? ''}
            onChange={e => updateAttributes({ locator: e.target.value || null })}
            placeholder={asLocatorKind(attrs.locatorKind) === 'page' ? '2, 4–6' : '2.1'}
            style={{ width: 56, fontSize: '12px', border: `1px solid ${INK}33`, borderRadius: 4, padding: '2px 5px', outline: 'none' }}
          />
          {/* Go to the cited sentence: opens the embedded PDF at that quote if there is one, otherwise
              deep-links the web source (#:~:text=). Enter or → go both navigate. */}
          {(hasPdf(bibProvider.get(pageEdit.key)) || pageEditUrl) && (
            <>
              <input
                ref={bindStopPM}
                value={attrs.quote ?? ''}
                onChange={e => updateAttributes({ quote: e.target.value || null })}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); goToPinpoint() } }}
                placeholder={hasPdf(bibProvider.get(pageEdit.key)) ? 'cited sentence (opens the PDF there)' : 'cited sentence (opens the source there)'}
                style={{ width: 150, fontSize: '12px', border: `1px solid ${INK}33`, borderRadius: 4, padding: '2px 5px', outline: 'none' }}
              />
            </>
          )}
          {/* READ IT HERE — a web source opens in a panel over the document rather than a new tab
              (Peter, 2026-08-28: "an inbuilt browser open up the webpage in question for e.g.
              Stanford EP articles"). Only for web sources: a source with a PDF already has the
              in-app PDF viewer, which is the better reader AND can see your selection. */}
          {pageEditUrl && !hasPdf(bibProvider.get(pageEdit.key)) && (
            <button type="button" title="Read this source here"
              onClick={() => {
                const label = segs.find(s => s.key === pageEdit.key)?.text ?? pageEdit.key
                setReaderUrl({ url: pageEditUrl, title: label })
                setPageEdit(null)
              }}
              style={{ fontSize: '12px', color: INK, background: 'transparent', border: `1px solid ${INK}33`,
                borderRadius: 4, padding: '2px 7px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              read here
            </button>
          )}
          {/* Delete this page reference — only offered when the popover was opened from a PAGE NUMBER
              (not the author-year). Clears the manual pages AND removes this occurrence's highlights. */}
          {pageEdit.fromPage && (
            <button type="button" title="Delete this page reference" aria-label="Delete this page reference"
              onClick={deletePageRef}
              style={{ fontSize: '22px', color: '#9d174d', fontWeight: 700, background: 'transparent', border: 'none', cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}>
              ×
            </button>
          )}
        </span>,
        document.body,
      )}
      {readerUrl && <SourceBrowser url={readerUrl.url} title={readerUrl.title} onClose={() => setReaderUrl(null)} />}
    </NodeViewWrapper>
  )
}
