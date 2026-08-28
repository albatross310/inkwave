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
import { splitMath, hasMath } from '../reader/readerMath'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { locateAll, markRuns, type ReaderMark, type MarkKind, type Located } from '../reader/marks'
import { v4 as uuidv4 } from 'uuid'
import type { LocatorKind } from '../citations/locator'
import {
  applyDockRoom, dockHandlePos, dockPanelPos, dockResize, dockRoom, NO_DOCK_ROOM,
  readStoredDockSide, readStoredOrientation, resolveOrientation, writeStoredDockSide,
  writeStoredOrientation, WIDE_QUERY, type DockOrientation,
} from './dockLayout'
import { isTouchDevice } from '../editor/Scroll'
import { tabDocId } from '../storage/tabDoc'
import { OPEN_PDF_EVENT } from '../citations/pdfViewer'

const INK = '#5c2d8a'

/** One formula. A KaTeX failure renders the SOURCE, never a gap: unreadable LaTeX still tells the
 *  reader what the argument's step was; a hole does not. */
function Katex({ tex, display }: { tex: string; display: boolean }) {
  const html = useMemo(() => {
    try { return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: false }) }
    catch { return null }
  }, [tex, display])
  if (!html) return <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.9em' }}>{tex}</code>
  return <span style={display ? { display: 'block', margin: '0.8em 0', textAlign: 'center' } : undefined}
    // KaTeX's own output, from a string we control the shape of — this is the one place markup is
    // generated rather than described, and it is generated HERE, not fetched.
    dangerouslySetInnerHTML={{ __html: html }} />
}

// Reader-mode faces (Peter, 2026-08-28: "an option to change the font in the second mode to a
// number of preset sexy fonts"). Drawn from the app's own certified set — these are already
// fetched for the editor, so choosing one costs no new download and they sit beside the writing
// rather than against it. Reader mode only: LIVE mode is the publisher's page and its typography
// is theirs.
// The PDF viewer's own palette, so a highlight means the same colour in both readers.
const MARK_COLORS = ['#ffe066', '#a0e8a0', '#8ec5ff', '#ffb3c6']
// No dark pair: a sticky note in maroon or navy is a note you cannot read (Peter, 2026-08-28).
const NOTE_COLORS = ['#ffe066', '#a0e8a0', '#8ec5ff', '#ffb3c6']

const READER_FONTS: Array<{ label: string; css: string }> = [
  { label: 'Garamond', css: "'EB Garamond', Georgia, serif" },
  { label: 'Fell',     css: "'IM Fell DW Pica', Georgia, serif" },
  { label: 'Spectral', css: "'Spectral', Georgia, serif" },
  { label: 'Lora',     css: "'Lora', Georgia, serif" },
  { label: 'Crimson',  css: "'Crimson Pro', Georgia, serif" },
  { label: 'Carlito',  css: "'Carlito', system-ui, sans-serif" },
  { label: 'Atkinson', css: "'Atkinson Hyperlegible', system-ui, sans-serif" },
]

// ⚠ SEARCH GOES THROUGH THE READER, NOT THE LIVE FRAME — and it has to be DuckDuckGo's HTML
// endpoint, not Google. Peter asked for Google ("effectively search google") and then hit the wall:
// "having trouble using the google thingo". MEASURED, both ways, because this is exactly the kind of
// thing that should not be guessed:
//   • FRAMING: google.com, duckduckgo.com, html.duckduckgo.com and bing all send X-Frame-Options or
//     frame-ancestors 'self'. NO search engine can be shown in the live frame. That is not something
//     any code here can change.
//   • READING: google.com/search fetched server-side returns ONE block and the words "click here" —
//     its results need JavaScript, so there is nothing to extract. html.duckduckgo.com/html returns
//     31 blocks and 123 real result links.
// So: Google satisfies neither path, and DuckDuckGo's no-JS endpoint satisfies the reader path
// completely. Searching switches to Reader mode, where it works, rather than to Live mode, where it
// can only ever show a refusal.
export const SEARCH_URL = 'https://html.duckduckgo.com/html/?q='

// ── PLAYABLE MEDIA ───────────────────────────────────────────────────────────────────────────────
// Peter, 2026-08-28: "if gpt can play youtube then surely we can?" — with a screenshot of ChatGPT
// showing youtube.com in a panel, tabs and all.
//
// THE DIFFERENCE IS NOT EFFORT, IT IS WHAT KIND OF PROGRAM EACH ONE IS. X-Frame-Options and
// frame-ancestors govern EMBEDDING ONE PAGE INSIDE ANOTHER PAGE, and that is the only thing a web
// app can do: `<iframe>` (and `<embed>`/`<object>`) are the entire vocabulary, and all of them are
// covered. That restriction is not an oversight we can route around — it is what stops a page
// wrapping your bank in an invisible frame, so no browser offers an escape hatch. ChatGPT's panel
// is not an iframe: it is a NATIVE app hosting a real browser view (Electron/WKWebView), which is a
// TOP-LEVEL browsing context, and the header simply does not apply to it. The day Inkwave ships as
// a desktop app it gets the same thing for free; as a web page it never can.
//
// BUT VIDEOS ARE A DIFFERENT MATTER, and here the answer is simply yes. YouTube publishes an
// endpoint whose whole purpose is to be embedded, and it sends NO framing restriction at all
// (checked: /embed/ returns 200 with no X-Frame-Options and no frame-ancestors, unlike /watch).
// So a YouTube link is rewritten to it and plays. Same for Vimeo.
const YT_ID = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([\w-]{6,})/i
const VIMEO_ID = /vimeo\.com\/(?:video\/)?(\d{6,})/i

/** A watch URL → the publisher's embeddable player. Anything else is returned unchanged. */
export function embeddableUrl(url: string): string {
  const yt = YT_ID.exec(url)
  if (yt) {
    let start = ''
    try {
      const t = new URL(url).searchParams.get('t') ?? ''
      const secs = /^(\d+)s?$/.exec(t)?.[1]
      if (secs) start = `?start=${secs}`
    } catch { /* not parseable — no start time, which is fine */ }
    // -nocookie: the same player, without YouTube setting tracking cookies for a video the reader
    // opened from inside their own document. It frames identically (checked).
    return `https://www.youtube-nocookie.com/embed/${yt[1]}${start}`
  }
  const v = VIMEO_ID.exec(url)
  if (v) return `https://player.vimeo.com/video/${v[1]}`
  return url
}

/** True when this URL became a player — the panel then shows it as media, not as a page. */
export function isPlayable(url: string): boolean {
  return embeddableUrl(url) !== url || /(youtube-nocookie\.com|player\.vimeo\.com)\/(embed|video)\//i.test(url)
}

/** True when this address can only be read, never framed — searches, and the engines themselves. */
export function mustUseReader(url: string): boolean {
  return /(^|\/\/)([\w-]+\.)*(duckduckgo|google|bing)\.[a-z.]+\//i.test(url)
}

/** A typed address → a URL. Bare hosts get https://; anything that is plainly a SEARCH (spaces, or
 *  no dot) goes to the search endpoint, because a reader who types words expects to find something
 *  rather than an error. */
export function addressToUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (/^https?:\/\//i.test(t)) return t
  const looksLikeHost = /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t) && !/\s/.test(t)
  if (looksLikeHost) return `https://${t}`
  return SEARCH_URL + encodeURIComponent(t)
}

/** Tracking parameters a link picked up on its way to you. Peter, 2026-08-28, seeing
 *  `?utm_source=chatgpt.com` in the address bar: they are added by whoever gave you the link, not
 *  by us — but a reader is a place you READ, and carrying someone's campaign tag into every request
 *  and every citation is noise at best. Stripped on navigation; nothing else about the URL changes. */
const TRACKING_PARAMS = /^(utm_[a-z]+|gclid|fbclid|mc_[a-z]+|ref|ref_src|igshid|si|spm|_hsenc|_hsmi|vero_id|oly_enc_id|oly_anon_id)$/i
export function stripTracking(url: string): string {
  try {
    const u = new URL(url)
    let hit = false
    for (const k of [...u.searchParams.keys()]) if (TRACKING_PARAMS.test(k)) { u.searchParams.delete(k); hit = true }
    return hit ? u.toString() : url
  } catch { return url }
}

/** DuckDuckGo wraps every result in a redirect (`/l/?uddg=<encoded>`). Unwrap it, so clicking a
 *  result goes to the SITE — otherwise every navigation from a search lands on a redirector, which
 *  the reader then has nothing to extract from. */
export function unwrapRedirect(url: string): string {
  try {
    const u = new URL(url)
    if (/(^|\.)duckduckgo\.com$/i.test(u.hostname) && u.pathname.startsWith('/l/')) {
      const target = u.searchParams.get('uddg')
      if (target && /^https?:\/\//i.test(target)) return target
    }
  } catch { /* not a URL we can improve */ }
  return url
}

/** Hosts known to refuse framing, so the FALLBACK can say so before showing an empty rectangle. */
// Hosts known to send X-Frame-Options / frame-ancestors. NOT a security control and never
// exhaustive — the deadline below is what catches the general case; this just skips the wait for
// the ones we have already met (Peter hit abc.net.au and youtube.com within a minute of each other).
const KNOWN_NO_FRAME = [/(^|\.)jstor\.org$/i, /(^|\.)sciencedirect\.com$/i, /(^|\.)tandfonline\.com$/i,
  /(^|\.)springer\.com$/i, /(^|\.)wiley\.com$/i, /(^|\.)x\.com$/i, /(^|\.)twitter\.com$/i,
  /(^|\.)youtube\.com$/i, /(^|\.)google\.[a-z.]+$/i, /(^|\.)abc\.net\.au$/i, /(^|\.)facebook\.com$/i,
  /(^|\.)instagram\.com$/i, /(^|\.)linkedin\.com$/i, /(^|\.)reddit\.com$/i]

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

/** Paint the mark runs over a block's text. Splitting happens on PLAIN-TEXT offsets, so the block's
 *  own runs (links, emphasis) are walked in step and a mark that starts mid-link still paints. */
function markedStyle(ms: Located[]): React.CSSProperties | undefined {
  if (!ms.length) return undefined
  const hl = ms.find((m) => m.kind === 'highlight')
  const note = ms.find((m) => m.kind === 'note')
  return {
    background: hl ? hl.color : undefined,
    borderBottom: note ? `2px solid ${note.color}` : undefined,
    borderRadius: hl ? 2 : undefined,
  }
}

function Runs({ runs, onNavigate, marks, onEraseMark }: {
  runs: Run[]; onNavigate?: (url: string) => void; marks?: Located[]; onEraseMark?: (id: string) => void
}) {
  if (marks && marks.length) {
    // Walk the runs and the mark boundaries together on one plain-text cursor.
    const total = runs.reduce((n, r) => n + r.text.length, 0)
    const segs = markRuns(total, marks)
    const out: React.ReactNode[] = []
    let cur = 0
    for (const r of runs) {
      const rStart = cur, rEnd = cur + r.text.length
      cur = rEnd
      for (const g of segs) {
        const from = Math.max(g.from, rStart), to = Math.min(g.to, rEnd)
        if (to <= from) continue
        const piece = { ...r, text: r.text.slice(from - rStart, to - rStart) }
        const st = markedStyle(g.marks)
        out.push(
          <span key={`${rStart}-${from}`} style={st}
            onClick={g.marks.length && onEraseMark ? () => onEraseMark(g.marks[0].id) : undefined}
            title={g.marks.find((m) => m.kind === 'note')?.body || undefined}>
            <Runs runs={[piece]} onNavigate={onNavigate} />
          </span>,
        )
      }
    }
    return <>{out}</>
  }
  return (
    <>
      {runs.map((r, i) => {
        // LaTeX arrives RAW because the publisher typesets it with MathJax in the browser and we
        // fetched the page before any script ran (reader/readerMath.ts). KaTeX is already bundled.
        let node: React.ReactNode = hasMath(r.text)
          ? splitMath(r.text).map((seg, k) => seg.kind === 'text'
              ? <span key={k}>{seg.value}</span>
              : <Katex key={k} tex={seg.value} display={!!seg.display} />)
          : r.text
        if (r.code) node = <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.92em' }}>{node}</code>
        if (r.em) node = <em>{node}</em>
        if (r.strong) node = <strong>{node}</strong>
        // href is validated on BOTH sides (the server refuses anything but http/s, and so does this)
        // — one rule in two places is how a hole opens, so neither trusts the other.
        if (r.href && /^https?:\/\//i.test(r.href)) {
          const href = r.href
          node = (
            <a href={href} rel="noreferrer noopener" style={{ color: INK, textDecoration: 'underline' }}
              // Plain click = follow it HERE. ⌘/Ctrl/middle-click keeps the browser's own meaning
              // (a real tab), because a panel that swallows every modifier is not a browser either.
              onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); onNavigate?.(href) }}>
              {node}
            </a>
          )
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
  // ── IN-PANEL NAVIGATION (Peter, 2026-08-28: "can we make it a fully functioning browser … so you
  // can navigate to new tabs and so on") ────────────────────────────────────────────────────────
  // A link in the reader loads INSIDE the reader, with real back/forward, instead of throwing the
  // writer out to a new tab. The stack is the panel's own history — deliberately not the browser's,
  // because this is a panel over a document the writer must not lose their place in.
  const [stack, setStack] = useState<string[]>([url])
  const [idx, setIdx] = useState(0)
  useEffect(() => { setStack([url]); setIdx(0) }, [url])
  const here = stack[idx] ?? url
  const [addr, setAddr] = useState(url)
  useEffect(() => { setAddr(here) }, [here])

  const docKey = (() => { try { return tabDocId() ?? 'global' } catch { return 'global' } })()
  // ── MARKUP (Peter: "roughly the same markup tools as for the pdfs … reproduce the same
  // ecosystem") ─────────────────────────────────────────────────────────────────────────────────
  // Highlights and sticky notes over the fetched text. Anchored by the TEXT they cover, not by an
  // offset — see reader/marks.ts for why that distinction is load-bearing on a page the publisher
  // can edit between visits.
  const [tool, setTool] = useState<MarkKind | 'erase' | null>(null)
  const [markColor, setMarkColor] = useState(MARK_COLORS[0])
  const markColorRef = useRef(markColor); markColorRef.current = markColor
  const [paletteOpen, setPaletteOpen] = useState<MarkKind | null>(null)
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heldRef = useRef(false)
  const [marks, setMarks] = useState<ReaderMark[]>([])
  const [leading, setLeading] = useState(() => {
    try { return Number(localStorage.getItem('inkwave:readerLeading')) || 1.62 } catch { return 1.62 }
  })
  const [font, setFont] = useState(() => {
    try { return localStorage.getItem('inkwave:readerFont') || READER_FONTS[0].css } catch { return READER_FONTS[0].css }
  })
  const marksStoreKey = `inkwave:readerMarks:${docKey}:${here}`
  useEffect(() => {
    try {
      const raw = localStorage.getItem(marksStoreKey)
      setMarks(raw ? (JSON.parse(raw) as ReaderMark[]) : [])
    } catch { setMarks([]) }
  }, [marksStoreKey])
  const writeMarks = (next: ReaderMark[]) => {
    setMarks(next)
    try { localStorage.setItem(marksStoreKey, JSON.stringify(next)) } catch { /* private / full */ }
  }
  /** Same page, different #fragment — SEP's section links, and every "contents" list on the web. */
  const sameDocHash = (a: string, bStr: string): string | null => {
    try {
      const x = new URL(a), y = new URL(bStr)
      if (x.origin !== y.origin || x.pathname !== y.pathname || x.search !== y.search) return null
      return y.hash ? y.hash.slice(1) : null
    } catch { return null }
  }

  const go = (raw: string) => {
    const next = stripTracking(unwrapRedirect(raw))
    if (!/^https?:\/\//i.test(next)) return
    // ⚠ AN IN-PAGE ANCHOR IS NOT A NAVIGATION (2026-08-28, Peter: "on SEP these hyperlinks don't
    // work in reader mode"). SEP's contents list is `#Intr`, `#RelaIden`… — the SAME page with a
    // fragment. Pushing that onto the history stack refetches the whole article and lands you back
    // at the top, which is indistinguishable from the link doing nothing. The extractor already
    // keeps each heading's own id from the source (`b.id`), so the anchor has somewhere real to go.
    const frag = sameDocHash(here, next)
    if (frag) {
      const el = document.getElementById(`iw-rd-${frag}`)
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
      // No heading with that id — fall through and let it navigate rather than silently doing
      // nothing, which is the failure being fixed.
    }
    // A search (or a search engine) can only ever be READ — see the note on SEARCH_URL. Switching
    // here rather than letting the live frame show a refusal is the difference between a browser
    // and a browser-shaped disappointment.
    if (mustUseReader(next)) setFramed(false)
    // A video has no article to extract — the reader would fetch it and find nothing. Play it.
    else if (isPlayable(next)) setFramed(true)
    setStack((st) => [...st.slice(0, idx + 1), next])
    setIdx((i) => i + 1)
  }
  const [doc, setDoc] = useState<ReaderDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  // ⚠ THE MODE IS REMEMBERED (Peter, 2026-08-28: "clicking the link goes straight to the website no
  // delay"). Reader mode has to FETCH before it can show anything — perhaps a second — and once
  // someone is using this as a browser that second is the whole complaint. So the mode is sticky per
  // document: choose Live once and every link opens straight into the live site.
  const [framed, setFramed] = useState(() => {
    try { return localStorage.getItem('inkwave:readerLive') === '1' } catch { return false }
  })
  useEffect(() => { try { localStorage.setItem('inkwave:readerLive', framed ? '1' : '0') } catch { /* private */ } }, [framed])
  // ── PAGE WIDTH IN LIVE MODE (Peter, 2026-08-28: "it's not using the whole space") ────────────
  // The iframe's width IS the CSS viewport the site lays out for, so "not using the whole space" is
  // not something we can fix by stretching anything — it is the site's own responsive layout at
  // whatever width we hand it. Britannica at ~900px picks its DESKTOP layout, right rail and all,
  // and leaves the rail empty; the same site at ~500px picks its phone layout and fills the width.
  // So this is a CHOICE, and it belongs to the reader:
  //   auto   — the panel's real width, 1:1 (what it did before)
  //   narrow — lay out at 520px and scale UP: the phone layout, big text, no empty rails
  //   wide   — lay out at 1400px and scale DOWN: the full desktop layout, smaller text
  // Implemented by sizing the iframe to the chosen viewport and transform-scaling it to fit, which
  // is the only way to give a cross-origin document a viewport it did not ask for.
  const [pageWidth, setPageWidth] = useState<'auto' | 'narrow' | 'wide'>(() => {
    try { return (localStorage.getItem('inkwave:readerPageWidth') as 'auto' | 'narrow' | 'wide') || 'auto' } catch { return 'auto' }
  })
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose
  const handingOverRef = useRef(false)
  const frameHostRef = useRef<HTMLDivElement>(null)
  const [hostBox, setHostBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = frameHostRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setHostBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setHostBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [framed])
  const frameGeom = (() => {
    const w = hostBox.w || 900, h = hostBox.h || 600
    if (pageWidth === 'auto' || w === 0) return { w, h, scale: 1 }
    const target = pageWidth === 'narrow' ? 520 : 1400
    const scale = w / target
    return { w: target, h: h / scale, scale }
  })()

  const [frameRefused, setFrameRefused] = useState(false)
  // ⚠ ASK THE SERVER; `onLoad` LIES (2026-08-28, Peter: "we need to replace this with a proper
  // error message that explains some pages can't be read in their original form"). A refused frame
  // FIRES `load` — on Chrome's own "refused to connect" page — so the deadline-cancelled-by-onLoad
  // detector written earlier never fired at all, and the grey broken-page icon kept showing. I had
  // written that exact trap down in a probe ("onLoad is worthless on its own") and then relied on it
  // in the component anyway. Nothing INSIDE the page discriminates either: contentWindow and
  // contentDocument throw identically for a real cross-origin document and for the error page.
  // The HEADERS do, and only the server can read them (/api/reader?probe=1 → checkFramable).
  // The probe runs IN PARALLEL with the frame, so a page that works is never delayed by the question.
  useEffect(() => {
    if (!framed) { setFrameRefused(false); return }
    if (isPlayable(here)) { setFrameRefused(false); return }   // an embed endpoint — known frameable
    let live = true
    setFrameRefused(likelyRefusesFraming(here))                 // the hosts we already know, instantly
    fetch(`/api/reader?probe=1&url=${encodeURIComponent(here)}`)
      .then((r) => r.json())
      .then((j) => { if (live && j && j.framable === false) setFrameRefused(true) })
      .catch(() => { /* the probe failing is not evidence of refusal — let the frame try */ })
    return () => { live = false }
  }, [framed, here])
  const [sel, setSel] = useState<{ text: string; x: number; y: number } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // ── THE DOCK — the PDF panel's rules, not a copy of them (components/dockLayout.ts) ──────────
  // Peter: "can you get it to open in the side or below with same width and placing as the pdf
  // reader?" Shared preferences too, so moving one moves both.
  const [width, setWidth] = useState(() => Math.round((typeof window !== 'undefined' ? window.innerWidth : 1280) * 0.5))
  const [height, setHeight] = useState(() => Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.5))
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ axis: 'x' | 'y'; start: number; size: number } | null>(null)
  const [storedOrient, setStoredOrient] = useState<'bottom' | 'side'>(readStoredOrientation)
  const [dockSide, setDockSide] = useState(readStoredDockSide)
  const [isWide, setIsWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(WIDE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY)
    const h = (e: MediaQueryListEvent) => setIsWide(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  const isPhone = isTouchDevice()
  const orientation: DockOrientation = resolveOrientation(isPhone, isWide, storedOrient)

  // The section list and the privacy footer are both dismissible, and both remember PER DOCUMENT
  // (Peter, 2026-08-28: "You need an x to get rid of this — and save per document", "a button to
  // hide the menu"). Per document rather than per origin because which sources you are reading, and
  // how much room you want for them, is a property of the piece you are writing.
  const [showNav, setShowNav] = useState(() => {
    try { return localStorage.getItem(`inkwave:readerNav:${docKey}`) !== '0' } catch { return true }
  })
  const [showNotice, setShowNotice] = useState(() => {
    try { return localStorage.getItem(`inkwave:readerNotice:${docKey}`) !== '0' } catch { return true }
  })
  const toggleNav = () => setShowNav((v) => {
    const n = !v
    try { localStorage.setItem(`inkwave:readerNav:${docKey}`, n ? '1' : '0') } catch { /* private */ }
    return n
  })
  const dismissNotice = () => {
    setShowNotice(false)
    try { localStorage.setItem(`inkwave:readerNotice:${docKey}`, '0') } catch { /* private */ }
  }

  useEffect(() => {
    if (!dragging) return
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      const delta = (d.axis === 'x' ? e.clientX : e.clientY) - d.start
      // The panel grows toward the editor, so a LEFT dock and a BOTTOM dock read the drag in
      // opposite senses from a right dock — same arithmetic, one sign.
      const sign = d.axis === 'x' ? (dockSide === 'left' ? 1 : -1) : -1
      const next = dockResize(d.axis, d.size, delta * sign)
      if (d.axis === 'x') setWidth(next); else setHeight(next)
    }
    const up = () => { drag.current = null; setDragging(false) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  }, [dragging, dockSide])

  // Carve the room out of the editor — the SAME four CSS variables the PDF panel writes, so the
  // editor surface and every floating pill already know how to get out of the way.
  useEffect(() => {
    applyDockRoom(dockRoom({ open: true, fullscreen: false, orientation, dockSide, width, height }))
    return () => {
      // Hand the strip over rather than blanking it: if a PDF is opening into the same dock, the
      // editor must not snap wide for a frame and back again.
      if (!handingOverRef.current) applyDockRoom(NO_DOCK_ROOM)
      handingOverRef.current = false
    }
  }, [orientation, dockSide, width, height])

  useEffect(() => {
    let live = true
    setDoc(null); setError(null)
    fetch(`/api/reader?url=${encodeURIComponent(here)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({ error: 'fetch failed' }))
        if (!live) return
        if (!r.ok || j.error) { setError(ERRORS[j.error] ?? 'That page couldn’t be read here.'); return }
        setDoc(j as ReaderDoc)
      })
      .catch(() => { if (live) setError('That page couldn’t be reached.') })
    return () => { live = false }
  }, [here])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // ⚠ ONE DOCK, ONE OCCUPANT (2026-08-28, Peter: "clicking a pdf when browser is open doesn't
  // replace it. They should seamlessly replace each other with the same page sizing etc"). Both
  // panels write the SAME four room variables (components/dockLayout.ts) — that is what makes their
  // placement identical — which also means two open at once fight over one strip and the second one
  // to write wins. So the reader stands down the moment a PDF is opened. It does NOT clear the room
  // on the way out: the PDF panel is about to claim the same geometry, and blanking it first is a
  // frame of the editor snapping wide and back, which is the opposite of seamless.
  useEffect(() => {
    const onPdf = () => { handingOverRef.current = true; onCloseRef.current() }
    window.addEventListener(OPEN_PDF_EVENT, onPdf)
    return () => window.removeEventListener(OPEN_PDF_EVENT, onPdf)
  }, [])

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
      // ⚠ AN ARMED TOOL MARKS ON SELECT (Peter, 2026-08-28: "switching on highlight mode should
      // mean anything we highlight gets highlighted"). A mode that still made you press a button
      // afterwards was not a mode, it was a button with extra steps.
      if (toolRef.current === 'highlight' || toolRef.current === 'note') { markSelectionRef.current(toolRef.current); return }
      const r = range.getBoundingClientRect()
      setSel({ text, x: r.left + r.width / 2, y: r.top })
    }
    const t = () => window.setTimeout(read, 0) // let the browser finish the selection first
    el.addEventListener('pointerup', t)
    el.addEventListener('keyup', t)
    return () => { el.removeEventListener('pointerup', t); el.removeEventListener('keyup', t) }
  }, [doc])

  // Blocks as plain text, for anchoring. `list` blocks join their items — a list is one block for
  // marking purposes, which is the same granularity the extractor produced.
  const blockTexts = useMemo(
    () => (doc?.blocks ?? []).map((b) => ('text' in b ? b.text : b.items.map((i) => i.map((r) => r.text).join('')).join('\n'))),
    [doc],
  )
  const located = useMemo(() => locateAll(marks, blockTexts), [marks, blockTexts])
  const byBlock = useMemo(() => {
    const m = new Map<number, Located[]>()
    for (const l of located.placed) { const a = m.get(l.block) ?? []; a.push(l); m.set(l.block, a) }
    return m
  }, [located])

  const headings = useMemo(
    () => (doc?.blocks ?? []).filter((b): b is Extract<ReaderBlock, { kind: 'heading' }> => b.kind === 'heading'),
    [doc],
  )

  const toolRef = useRef(tool); toolRef.current = tool
  const markSelectionRef = useRef<(k: MarkKind) => void>(() => {})

  // ⚠ REMEMBER WHERE YOU WERE WHEN SWITCHING MODES (Peter, 2026-08-28: "we also want the browser
  // to remember where we were on the page when we hit change between read mode and original mode").
  // Reader mode only, and that is not a shortcut — a live page is a cross-origin document, and the
  // browser will not let us read or set its scroll. What we CAN do is return you to your place in
  // the reader, which is the half that involves our own scroller.
  const readerScrollRef = useRef(new Map<string, number>())
  const [sectionNow, setSectionNow] = useState(0)
  const [readPct, setReadPct] = useState(0)
  useEffect(() => {
    const el = bodyRef.current
    if (!el || framed) return
    let raf = 0
    const read = () => {
      raf = 0
      const range = Math.max(1, el.scrollHeight - el.clientHeight)
      setReadPct(Math.min(100, Math.round((el.scrollTop / range) * 100)))
      // The last heading whose top has passed the pane's upper third — the section you are IN.
      const mark = el.getBoundingClientRect().top + el.clientHeight * 0.33
      const hs = el.querySelectorAll('[id^="iw-rd-"]')
      let n = 0
      hs.forEach((h, i) => { if (h.getBoundingClientRect().top <= mark) n = i })
      setSectionNow(n)
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(read); readerScrollRef.current.set(here, el.scrollTop) }
    read()
    // Restore the place we left this article at, once it has its height.
    const want = readerScrollRef.current.get(here)
    if (want && want > 8) requestAnimationFrame(() => { if (el.scrollHeight - el.clientHeight > want) el.scrollTop = want })
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf) }
  }, [doc, framed, here])

  const eraseMark = (id: string) => { if (tool === 'erase') writeMarks(marks.filter((m) => m.id !== id)) }

  /** One shape for every header action — that is what "symmetric" means here. */
  const btn = (glyph: string, title: string, onPress: () => void, lit: boolean) => (
    <button type="button" title={title} aria-label={title} onClick={onPress}
      style={{ width: 24, height: 24, flexShrink: 0, borderRadius: 6, display: 'flex', alignItems: 'center',
        justifyContent: 'center', cursor: 'pointer', fontSize: '13px', lineHeight: 1,
        border: `1px solid ${lit ? INK : 'var(--iw-nightable-border, #d6cfe0)'}`,
        background: lit ? `${INK}14` : 'transparent', color: INK }}>{glyph}</button>
  )

  /** below → side-right → side-left → below. Two controls' worth of state on one button. */
  const cycleDock = () => {
    if (orientation !== 'side') { setStoredOrient('side'); writeStoredOrientation('side'); setDockSide('right'); writeStoredDockSide('right'); return }
    if (dockSide === 'right') { setDockSide('left'); writeStoredDockSide('left'); return }
    setStoredOrient('bottom'); writeStoredOrientation('bottom')
  }

  /** The nearest heading ABOVE the block this text sits in — the section a reader would name. */
  const sectionFor = (text: string): string | null => {
    let bi = -1
    for (let i = 0; i < blockTexts.length; i++) if (blockTexts[i].includes(text)) { bi = i; break }
    if (bi < 0) return null
    const blocks = doc?.blocks ?? []
    for (let i = bi; i >= 0; i--) {
      const b = blocks[i]
      if (b && b.kind === 'heading' && b.text.trim()) return b.text
    }
    return null
  }
  const formatSection = (loc: { kind: string; value: string }) =>
    loc.kind === 'section' ? `§${loc.value}` : loc.kind === 'chapter' ? `ch. ${loc.value}` : `“${loc.value.slice(0, 24)}”`

  // ⚠ AN ACTION WITH NO FEEDBACK READS AS A DEAD BUTTON (Peter: "clicking the left option doesn't
  // do anything"). It DID do something — it wrote the quote onto the citation, out of sight in the
  // document behind the panel — which is indistinguishable from nothing at all.
  const [toast, setToast] = useState<string | null>(null)
  const flash = (msg: string) => { setToast(msg); window.setTimeout(() => setToast(null), 2200) }

  const citeHeading = (text: string) => { onCite?.(locatorForHeading(text)); setSel(null) }

  /** Turn the live selection into a mark. The BLOCK is found by the selected text, not by walking
   *  the DOM — the same identification the mark is stored under, so creating and re-finding can
   *  never disagree about what a mark covers. */
  const markSelection = (kind: MarkKind) => {
    const s2 = window.getSelection()
    if (!s2 || s2.isCollapsed) return
    const text = s2.toString().replace(/\s+/g, ' ').trim()
    if (text.length < 2) return
    let block = -1, start = -1
    for (let i = 0; i < blockTexts.length; i++) {
      const at = blockTexts[i].indexOf(text)
      if (at >= 0) { block = i; start = at; break }
    }
    if (block < 0) return  // the selection spans blocks — refuse rather than mark the wrong words
    const m: ReaderMark = {
      id: uuidv4(), kind, color: markColorRef.current, block, start, text,
      body: kind === 'note' ? '' : undefined, createdAt: new Date().toISOString(),
    }
    writeMarks([...marks, m])
    s2.removeAllRanges()
    setSel(null)
  }
  markSelectionRef.current = markSelection

  return createPortal(
    <div className="iw-nightable iw-touch-guard flex flex-col bg-white"
      style={{ position: 'fixed', zIndex: 80, ...dockPanelPos({ orientation, dockSide, width, height }) }}
      onMouseDown={(e) => e.stopPropagation()}>
      {/* Resize handle on the edge facing the editor — the same rule and the same 10px grab strip
          the PDF panel uses (components/dockLayout.ts). */}
      {orientation !== 'top' && (
        <div title="Drag to resize"
          onPointerDown={(e) => {
            e.preventDefault()
            const axis = orientation === 'side' ? 'x' : 'y'
            drag.current = { axis, start: axis === 'x' ? e.clientX : e.clientY, size: axis === 'x' ? width : height }
            setDragging(true)
          }}
          style={{ position: 'absolute', zIndex: 2, background: dragging ? `${INK}22` : 'transparent', ...dockHandlePos(orientation, dockSide) }} />
      )}
      <div className="flex flex-col flex-1 min-h-0">

        <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-200" style={{ fontSize: '13px' }}>
          <button type="button" title="Back" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}
            style={{ background: 'transparent', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: idx === 0 ? '#d6d3d1' : INK, fontSize: '15px', padding: '0 2px' }}>←</button>
          <button type="button" title="Forward" disabled={idx >= stack.length - 1} onClick={() => setIdx((i) => Math.min(stack.length - 1, i + 1))}
            style={{ background: 'transparent', border: 'none', cursor: idx >= stack.length - 1 ? 'default' : 'pointer', color: idx >= stack.length - 1 ? '#d6d3d1' : INK, fontSize: '15px', padding: '0 2px' }}>→</button>
          <span style={{ color: INK, fontWeight: 600, whiteSpace: 'nowrap', maxWidth: '30%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {doc?.title || title || hostOf(here)}
          </span>
          {/* ADDRESS BAR (Peter, 2026-08-28: "we should be able to search the web by url"). It is
              an address bar in the ordinary sense: a URL goes there, a bare host gets https://, and
              words with no dot go to GOOGLE (Peter named it) — a reader who types
              words expects to find something, not an error. */}
          <input value={addr} onChange={(e) => setAddr(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              const next = addressToUrl(addr)
              if (next) { go(next); (e.currentTarget as HTMLInputElement).blur() }
            }}
            placeholder="address or search"
            title={framed
              ? 'The page this panel loaded. Links you follow inside the live page are the site’s own — Inkwave can’t see where they go.'
              : 'Type an address, or words to search'}
            spellCheck={false}
            className="iw-nightable"
            style={{ flex: 1, minWidth: 80, height: 22, fontSize: '11px', padding: '0 7px', borderRadius: 999,
              border: '1px solid var(--iw-nightable-border, rgba(92,45,138,0.28))', background: 'transparent',
              color: 'inherit', outline: 'none', fontFamily: 'system-ui, sans-serif' }} />
          {/* FOUR SYMMETRIC BUTTONS (Peter, 2026-08-28: "this could be reduced down to a button.
              Four symmetric buttons"). "open in a tab ↗" was a wide underlined link sitting among
              icons; it is an action like the others and now looks like one. The dock button CYCLES
              (below → right → left) so the two separate dock controls collapse into one, which is
              what makes four the right number rather than a number things were squeezed into. */}
          {/* ⚠ THE TOGGLE NAMES THE PAGE IT WILL SHOW (Peter, 2026-08-28: "when I click the house
              button at the top it goes to wikipedia.com not the current page"). Following a link
              INSIDE the live frame is a cross-origin navigation: the browser tells us nothing about
              it — not the URL, not that it happened — so switching to Reader can only go back to the
              page we loaded. That is a boundary, not a bug we can close, and the tooltip says so
              rather than letting the button look broken. */}
          {btn(framed ? '⌂' : '⛶',
            framed ? `Reader view — shows ${hostOf(here)}${new URL(here).pathname.length > 1 ? new URL(here).pathname : ''} (the page this panel loaded; links you followed inside the live page aren’t visible to Inkwave)` : 'Live page — the real site, with its own navigation',
            () => setFramed((f) => !f), framed)}
          {btn('▤', `Dock: ${orientation === 'side' ? (dockSide === 'left' ? 'left' : 'right') : 'below'} — click to move`, cycleDock, false)}
          {btn('↗', 'Open in a browser tab', () => window.open(here, '_blank', 'noopener,noreferrer'), false)}
          {btn('✕', 'Close (Esc)', onClose, false)}
        </div>

        <div className="flex flex-1 min-h-0" style={{ position: 'relative' }}>
          {/* Section list — the fastest way to cite a section is to not have to find it first. */}
          {/* ☰ SITS OVER THE NAVIGATOR (Peter, 2026-08-28: "this button needs to be over the
              navigator"), not adrift in the header — a control that hides a column belongs at the
              top of that column, where what it acts on is unambiguous. When the column is hidden it
              becomes a thin re-open tab in its place, so the action stays reversible in situ. */}
          {/* A BUTTON, NOT A COLUMN (Peter, 2026-08-28: "move this little bar thing up to the top
              and make it not a whole column just a little button at the top"). A full-height strip
              to re-open a list is a piece of furniture standing in for a control; it also stole
              22px of reading width down the entire article for a click you make once. */}
          {!framed && headings.length > 1 && !showNav && (
            <button type="button" title="Show the section list" onClick={toggleNav}
              style={{ position: 'absolute', left: 6, top: 6, zIndex: 5, width: 24, height: 24,
                borderRadius: 6, border: '1px solid var(--iw-nightable-border, #d6cfe0)',
                background: 'rgba(255,255,255,0.92)', color: INK, cursor: 'pointer', fontSize: '13px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 1px 4px rgba(0,0,0,0.10)' }}>☰</button>
          )}
          {!framed && showNav && headings.length > 1 && (
            <nav className="hidden md:flex flex-col overflow-hidden border-r border-stone-200" style={{ width: 220, fontSize: '12px' }}>
              {/* ☰ at the RIGHT END of its own row (Peter, 2026-08-28: "put this button over to the
                  right of the column … the cell that it's in"). It closes the column leftward, so
                  it belongs on the edge it collapses toward — and it sits where the re-open tab
                  will appear, so the control does not jump across the panel when you use it. */}
              <div className="flex items-center gap-1 px-2 py-1 border-b border-stone-100" style={{ flexShrink: 0 }}>
                <span className="text-stone-400" style={{ fontSize: '11px' }}>Sections</span>
                <button type="button" title="Hide the section list" onClick={toggleNav}
                  className="ml-auto"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: INK, fontSize: '13px', padding: '0 2px' }}>☰</button>
              </div>
              <div className="overflow-y-auto py-1">
              {headings.map((h, hi) => (
                <button key={h.id} type="button"
                  onClick={() => document.getElementById(`iw-rd-${h.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className="w-full text-left px-3 py-1 hover:bg-stone-50 flex items-center gap-1 group"
                  // WHERE YOU ARE (Peter, 2026-08-28: "this lhs panel also needs to highlight where
                  // we're currently at"). Driven by the same reading position the § n/x readout
                  // uses, so the list and the counter can never disagree.
                  style={{ paddingLeft: 8 + Math.min(3, Math.max(0, h.level - 1)) * 10,
                    color: hi === sectionNow ? INK : '#57534e',
                    fontWeight: hi === sectionNow ? 600 : 400,
                    background: hi === sectionNow ? `${INK}12` : undefined,
                    borderLeft: `2px solid ${hi === sectionNow ? INK : 'transparent'}` }}>
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1">{h.text}</span>
                  {onCite && (
                    <span role="button" title={`Cite this section`}
                      onClick={(e) => { e.stopPropagation(); citeHeading(h.text) }}
                      className="opacity-0 group-hover:opacity-100 px-1 flex-shrink-0"
                      style={{ color: INK, fontWeight: 700 }}>§</span>
                  )}
                </button>
              ))}
              </div>
            </nav>
          )}

          {/* ⚠ NO PADDING (AND NO SCROLLER) IN LIVE MODE (2026-08-28, Peter: "nevertheless it has
              this weird white space around it"). The reading column's px-8/py-6 is right for OUR
              typography and wrong for a real web page, which brings its own margins and its own
              scrollbar — so the site rendered inside a cream frame with a second scroller around
              it. The iframe fills the pane edge to edge and scrolls itself. */}
          <div ref={bodyRef} data-iw-selectable=""
            className={`flex-1 min-w-0 ${framed ? 'overflow-hidden' : 'overflow-y-auto px-8 py-6'}`}
            // EVERY TOOL CHANGES THE CURSOR (Peter: "each button needs to change the cursor"). An
            // armed mode you cannot see is a mode you will forget you are in.
            data-iw-tool={tool ?? undefined}
            style={framed ? undefined : { fontFamily: font, fontSize: '17px', lineHeight: leading, color: '#2c2a28' }}>
            {error && !framed && (
              <div className="flex flex-col items-center justify-center gap-3 h-full text-center" style={{ fontSize: '14px', color: '#57534e' }}>
                <div style={{ color: INK, fontSize: '15px' }}>{error}</div>
                {!likelyRefusesFraming(here) && (
                  <button type="button" onClick={() => setFramed(true)}
                    className="rounded-full px-3 py-1.5" style={{ border: `1px solid ${INK}55`, color: INK, fontSize: '13px' }}>
                    Try showing the live page instead
                  </button>
                )}
                <a href={here} target="_blank" rel="noreferrer noopener" className="rounded-full px-3 py-1.5 text-white"
                  style={{ background: `linear-gradient(135deg, #7a4fb0, ${INK})`, fontSize: '13px' }}>Open it in a tab ↗</a>
              </div>
            )}
            {!error && !doc && !framed && (
              <div className="flex items-center justify-center h-full" style={{ color: '#a8a29e', fontSize: '13px' }}>reading…</div>
            )}
            {framed && frameRefused && (
              // ⚠ SAY IT, DON'T SHOW CHROME'S GREY FACE (2026-08-28, Peter: "it's not working for
              // this abc website" — iview.abc.net.au sends X-Frame-Options and the panel showed the
              // browser's "refused to connect" error, which reads as OUR bug). A refused frame
              // fires no error event, so the detector is a deadline; generous, because a slow site
              // called "refused" would be the worse lie.
              <div className="flex flex-col items-center justify-center gap-3 h-full text-center px-8" style={{ fontSize: '14px', color: '#57534e' }}>
                <div style={{ color: INK, fontSize: '15px' }}>{hostOf(here)} can’t be shown in its original form here.</div>
                <div style={{ maxWidth: 470, lineHeight: 1.55 }}>
                  Some sites send a header telling browsers not to display them inside another page. It’s
                  what stops a page wrapping your bank in a disguise, so nothing in Inkwave can override
                  it. Reader view usually still works — it fetches the article text and shows it here,
                  where you can highlight and cite it.
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setFramed(false)}
                    className="rounded-full px-3 py-1.5" style={{ border: `1px solid ${INK}55`, color: INK, fontSize: '13px' }}>
                    Read it here instead
                  </button>
                  <a href={here} target="_blank" rel="noreferrer noopener" className="rounded-full px-3 py-1.5 text-white"
                    style={{ background: `linear-gradient(135deg, #7a4fb0, ${INK})`, fontSize: '13px' }}>Open in a tab ↗</a>
                </div>
              </div>
            )}
            {framed && !frameRefused && (
              // Live page: readable, but the browser keeps its text out of our reach — so the
              // selection actions are absent here rather than present and silently inert.
              <div ref={frameHostRef} style={{ width: '100%', height: '100%', overflow: 'hidden', background: '#fff' }}>
                <iframe src={embeddableUrl(here)} title={doc?.title || here}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                  allowFullScreen
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
                  // NO referrerPolicy override: many image CDNs use the referer for hotlink
                  // protection, and stripping it is a plausible cause of the missing pictures Peter
                  // saw. The default (strict-origin-when-cross-origin) sends the origin only —
                  // enough for those checks, and it leaks no path.
                  style={{ display: 'block', border: 'none', background: '#fff',
                    width: frameGeom.w, height: frameGeom.h,
                    transform: frameGeom.scale === 1 ? undefined : `scale(${frameGeom.scale})`,
                    transformOrigin: '0 0' }} />
              </div>
            )}
            {doc && !framed && doc.blocks.map((b, i) => {
              if (b.kind === 'heading') {
                const Tag = (`h${Math.min(4, Math.max(1, b.level))}`) as 'h1'
                return (
                  <Tag key={i} id={`iw-rd-${b.id}`} className="group"
                    style={{ fontSize: b.level <= 1 ? '1.5em' : b.level === 2 ? '1.22em' : '1.06em', fontWeight: 600, margin: '1.4em 0 0.5em', color: '#1c1a19' }}>
                    <Runs onNavigate={go} runs={b.runs} marks={byBlock.get(i)} onEraseMark={eraseMark} />
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
                    {b.items.map((it, j) => <li key={j} style={{ margin: '0.25em 0' }}><Runs onNavigate={go} runs={it} /></li>)}
                  </L>
                )
              }
              if (b.kind === 'quote') {
                return <blockquote key={i} style={{ margin: '0.9em 0', paddingLeft: '1em', borderLeft: `3px solid ${INK}33`, color: '#4b4844' }}><Runs onNavigate={go} runs={b.runs} /></blockquote>
              }
              if (b.kind === 'code') {
                return <pre key={i} style={{ margin: '0.9em 0', padding: '0.7em', background: '#00000008', borderRadius: 6, overflowX: 'auto', fontSize: '0.88em' }}><Runs onNavigate={go} runs={b.runs} /></pre>
              }
              return <p key={i} style={{ margin: '0.85em 0' }}><Runs onNavigate={go} runs={b.runs} marks={byBlock.get(i)} onEraseMark={eraseMark} /></p>
            })}
          </div>
        </div>

        {/* Floating actions over a selection — the whole reason the page is fetched rather than framed. */}
        {sel && !framed && (onCite || onQuote) && (
          <div className="iw-nightable fixed z-[401] flex items-center gap-1 bg-white rounded-full shadow-lg px-1.5 py-1"
            style={{ left: sel.x, top: Math.max(8, sel.y - 42), transform: 'translateX(-50%)', border: `1px solid ${INK}44`, fontSize: '12px' }}
            onMouseDown={(e) => e.preventDefault()}>
            {/* THE SAME COLOURED DOTS AS THE PDF (Peter: "highlighting text without any mode on
                should put up the coloured dots and link to citation panel"). One gesture, one
                vocabulary, in both readers — a dot highlights in that colour immediately. */}
            {MARK_COLORS.map((c) => (
              <button key={c} type="button" title="Highlight"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setMarkColor(c); markColorRef.current = c; markSelection('highlight') }}
                style={{ width: 18, height: 18, borderRadius: '50%', background: c, border: '1px solid rgba(0,0,0,0.15)', cursor: 'pointer', flexShrink: 0 }} />
            ))}
            <span style={{ width: 1, height: 16, background: `${INK}22`, margin: '0 2px' }} />
            {onQuote && (
              <button type="button" onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onQuote(sel.text); setSel(null); flash('Saved as the cited sentence') }}
                className="rounded-full px-2.5 py-1" style={{ color: INK, background: 'transparent', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                quote this
              </button>
            )}
            {onCite && (() => {
              // ⚠ CITE THE SECTION THE SELECTION IS IN — not the selection (Peter, 2026-08-28: "if
              // we cite as locator what we really want is for it to cite the heading or section
              // number as the locator"). It used to hand the SELECTED SENTENCE to
              // locatorForHeading, which of course found no number in it and returned the whole
              // sentence verbatim as the locator: "(Smith 2005, Each object is, at the later time,
              // composed…)". Nonsense, and my mistake — the function was built for headings and I
              // fed it prose.
              const sec = sectionFor(sel.text)
              if (!sec) return null            // no heading above it ⇒ nothing honest to cite
              const loc = locatorForHeading(sec)
              return (
                <button type="button" onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onCite(loc); setSel(null); flash(`Cited ${formatSection(loc)}`) }}
                  className="rounded-full px-2.5 py-1" style={{ color: INK, background: 'transparent', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  title={`Use "${sec}" as this citation's locator`}>
                  cite {formatSection(loc)}
                </button>
              )
            })()}
          </div>
        )}

        {/* ── THE MARKUP BAR (Peter, 2026-08-28: "a tab at the bottom with roughly the same markup
            tools as for the pdfs … reproduce the same ecosystem") ────────────────────────────────
            Same three tools, same gesture (click arms, HOLD opens the colours), same palette, so a
            highlight means the same thing in both readers. READER MODE ONLY: a live page is the
            publisher's document and the browser seals it off from us — we cannot mark what we
            cannot read, and offering a tool that silently does nothing is worse than not offering
            it, so the bar renders the reason instead. */}
        {!framed && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-stone-200 flex-wrap"
            style={{ fontSize: '12px', background: 'var(--iw-panel-bg, #faf8fc)' }}>
            {([
              { kind: 'highlight' as const, label: '▮', title: 'Highlight — select text, then click · hold for colours', palette: MARK_COLORS },
              { kind: 'note' as const, label: '🗒', title: 'Sticky note — select text, then click · hold for colours', palette: NOTE_COLORS },
            ]).map((t) => (
              <div key={t.kind} style={{ position: 'relative' }}>
                <button type="button" title={t.title}
                  onPointerDown={() => { holdRef.current = setTimeout(() => { heldRef.current = true; setPaletteOpen(t.kind) }, 400) }}
                  onPointerUp={() => { if (holdRef.current) clearTimeout(holdRef.current) }}
                  onPointerLeave={() => { if (holdRef.current) clearTimeout(holdRef.current) }}
                  onClick={() => {
                    if (heldRef.current) { heldRef.current = false; return }
                    // Text already selected → mark it now. Nothing selected → arm the tool.
                    const sel2 = window.getSelection()
                    if (sel2 && !sel2.isCollapsed) { markSelection(t.kind); return }
                    setTool((cur) => (cur === t.kind ? null : t.kind))
                  }}
                  style={{ width: 26, height: 26, borderRadius: 6, cursor: 'pointer', fontSize: '0.9rem',
                    border: `1px solid ${tool === t.kind ? INK : '#d6cfe0'}`, background: tool === t.kind ? `${INK}14` : '#fff',
                    color: t.kind === 'highlight' ? '#c99a06' : INK }}>{t.label}</button>
                {paletteOpen === t.kind && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 20 }} onMouseDown={() => setPaletteOpen(null)} />
                    <div className="iw-nightable" style={{ position: 'absolute', bottom: 32, left: 0, zIndex: 21, display: 'flex', gap: 6, padding: '7px 8px', borderRadius: 10, background: '#fff', border: `1px solid ${INK}44`, boxShadow: '0 4px 16px rgba(0,0,0,0.16)' }}>
                      {t.palette.map((c) => (
                        <button key={c} type="button" onMouseDown={(ev) => ev.preventDefault()}
                          onClick={() => { setMarkColor(c); setPaletteOpen(null) }}
                          style={{ width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer', border: markColor === c ? `2px solid ${INK}` : '1px solid rgba(0,0,0,0.15)' }} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
            {/* The PDF's eraser, glyph for glyph (Peter: "the erasor button needs to look same as
                for pdfs"). Same tool, same picture — a different icon reads as a different thing. */}
            <button type="button" title="Eraser — click a mark to remove it"
              onClick={() => setTool((cur) => (cur === 'erase' ? null : 'erase'))}
              style={{ width: 26, height: 26, borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `1px solid ${tool === 'erase' ? INK : '#d6cfe0'}`, background: tool === 'erase' ? `${INK}14` : '#fff' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#e8a0c0" stroke="#c76fa0" strokeWidth="1.1"
                  d="M15.6 3.5 3.5 15.6a2 2 0 0 0 0 2.8l2.1 2.1a2 2 0 0 0 2.8 0L20.5 8.4a2 2 0 0 0 0-2.8l-2.1-2.1a2 2 0 0 0-2.8 0Z" />
                <path fill="none" stroke="#c76fa0" strokeWidth="1.1" d="m10.2 8.8 5 5" />
              </svg>
            </button>

            <span style={{ width: 1, height: 16, background: `${INK}22`, margin: '0 3px' }} />
            {/* Reading face — Peter's "preset sexy fonts". Reader mode only; a live page's
                typography is the publisher's. */}
            <select value={font} title="Reading font"
              onChange={(e) => { setFont(e.target.value); try { localStorage.setItem('inkwave:readerFont', e.target.value) } catch { /* private */ } }}
              className="iw-nightable"
              style={{ height: 26, borderRadius: 6, border: '1px solid #d6cfe0', background: '#fff', color: INK, fontSize: '0.76rem', padding: '0 4px', cursor: 'pointer' }}>
              {READER_FONTS.map((f) => <option key={f.css} value={f.css}>{f.label}</option>)}
            </select>
            {/* Line spacing (Peter, 2026-08-28). Sits beside the face because they are one decision
                — how this article should read — and a source you are working THROUGH wants more air
                than one you are skimming. */}
            <select value={String(leading)} title="Line spacing"
              onChange={(e) => { const v = Number(e.target.value); setLeading(v); try { localStorage.setItem('inkwave:readerLeading', String(v)) } catch { /* private */ } }}
              className="iw-nightable"
              style={{ height: 26, borderRadius: 6, border: '1px solid #d6cfe0', background: '#fff', color: INK, fontSize: '0.76rem', padding: '0 4px', cursor: 'pointer' }}>
              <option value="1.35">Tight</option>
              <option value="1.62">Normal</option>
              <option value="1.9">Airy</option>
              <option value="2.3">Double</option>
            </select>

            {located.orphaned.length > 0 && (
              // A mark whose text the publisher has since changed. Said out loud rather than
              // silently dropped OR silently re-placed over words the reader never marked.
              <span className="ml-auto text-stone-400" style={{ fontSize: '11px' }}
                title="These marks covered text that is no longer on the page — the publisher has edited it.">
                {located.orphaned.length} mark{located.orphaned.length === 1 ? '' : 's'} lost their place
              </span>
            )}
          </div>
        )}

        {/* WHERE AM I (Peter, 2026-08-28: "an indicator at bottom left of both pdf and webpage of
            which page n/x you're at"). A web article has no pages, so the honest unit is its own
            SECTIONS — which is also what you cite by. With no headings it falls back to a
            percentage rather than inventing a page number the source does not have. */}
        {!framed && doc && (
          <div style={{ position: 'absolute', left: 8, bottom: 46, zIndex: 401, pointerEvents: 'none',
            background: 'rgba(255,255,255,0.92)', color: '#57534e', border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 999, padding: '2px 9px', fontSize: '11px', fontFamily: 'system-ui, sans-serif',
            boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}>
            {headings.length > 1 ? `§ ${Math.min(headings.length, sectionNow + 1)} / ${headings.length}` : `${readPct}%`}
          </div>
        )}

        {toast && (
          <div style={{ position: 'absolute', left: '50%', bottom: 54, transform: 'translateX(-50%)', zIndex: 402,
            background: INK, color: '#fff', fontSize: '12px', padding: '6px 12px', borderRadius: 999,
            boxShadow: '0 3px 12px rgba(0,0,0,0.25)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>{toast}</div>
        )}

        {/* LIVE MODE gets its own thin bar — just the width choice. It is not a fifth header button
            (Peter asked for four, symmetric) and it is not a markup tool, because there is nothing
            in a live page we are allowed to mark. */}
        {framed && !frameRefused && (
          <div className="flex items-center gap-2 px-2 py-1.5 border-t border-stone-200"
            style={{ fontSize: '11px', background: 'var(--iw-panel-bg, #faf8fc)', color: 'var(--iw-pill-fg, #78716c)' }}>
            <span>Page width</span>
            <select value={pageWidth} title="How wide a screen the site should lay out for"
              onChange={(e) => { const v = e.target.value as 'auto' | 'narrow' | 'wide'; setPageWidth(v); try { localStorage.setItem('inkwave:readerPageWidth', v) } catch { /* private */ } }}
              className="iw-nightable"
              style={{ height: 22, borderRadius: 6, border: '1px solid #d6cfe0', background: '#fff', color: INK, fontSize: '11px', padding: '0 4px', cursor: 'pointer' }}>
              <option value="auto">Fit the panel</option>
              <option value="narrow">Big text (phone layout)</option>
              <option value="wide">Wide (desktop layout)</option>
            </select>
          </div>
        )}

        {/* ⚠ DISMISSIBLE, NOT DELETED. The framed case's line is the one that explains why selecting
            text does nothing there, so it is worth keeping available — the × remembers per document
            and the ☰/mode change brings it back for a source where it matters. */}
        {showNotice && (
          <div className="px-3 py-1.5 border-t border-stone-200 text-stone-400 flex items-start gap-2" style={{ fontSize: '11px' }}>
            <span style={{ flex: 1 }}>{framed
              ? 'Live page — your browser keeps it separate from Inkwave, so text selected here can’t be picked up.'
              : 'Article text, fetched for you. Inkwave keeps no log and no copy of what you read — but it does see the address for the moment it takes to fetch.'}</span>
            <button type="button" onClick={dismissNotice} title="Hide this note" aria-label="Hide this note"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#a8a29e', fontSize: '14px', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>×</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
