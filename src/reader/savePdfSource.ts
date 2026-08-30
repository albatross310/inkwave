// THE IMPORT ITSELF: a browsed PDF → an entry in the citation library with its bytes in OPFS.
//
// ⚠ THIS IS NOT A SECOND PDF STORE, AND IT MUST NOT BECOME ONE. `citations/pdfStore.ts` already
// solved every hard part — `writeOpfsFile` (WebKit has NO createWritable; `savePdf` THREW on iOS
// until the worker shim) and the native base64 pair (the hand-rolled btoa was a 20MB main-thread
// stall per save). `media/mediaStore.ts` imports them for exactly this reason and so does this. A
// copy would not merely duplicate code; it would re-acquire both bugs on the one platform Peter
// tests on. The only thing this module owns is the ORDER of the writes.
//
// ⚠ AND THE ORDER IS THE WHOLE DESIGN, because `_iw.pdfName` IS the claim that bytes exist —
// `hasPdf` is `!!pdfName` and nothing else. So:
//     1. write the entry WITHOUT pdfName, to learn the citekey `addToLibrary` actually assigned
//        (`freeCitekey` may suffix it, and the bytes have to be filed under the real one);
//     2. write the BYTES under that key;
//     3. only then write `pdfName`.
// Fail at 2 and the writer is left with an ordinary URL-only source — incomplete, and TRUE. The
// reverse order would leave an entry claiming a PDF that is not there, which is the shape of every
// "the file is gone" bug in this repo, discovered months later when they open it.
//
// ⚠ A FAILED READ IS NOT AN ABSENCE, here as everywhere. `addToLibrary` can keep a change in memory
// only — `persistLibrary` REFUSES to write while the library's own hydration failed — so this
// module never reports "saved" on the strength of having called it. It reads the entry back through
// `bibProvider` and says what it actually finds.

import { addToLibrary } from '../citations/library'
import { bibProvider } from '../citations/bibProvider'
import { savePdf } from '../citations/pdfStore'
import { detectPageOffset } from '../citations/pageOffset'
import type { CSLItem, IwCitationMeta } from '../types/document'
import { citekeyForPdfUrl, looksLikePdfBytes, mbOf, PDF_MAX_BYTES, pdfFileNameFor, titleForPdfUrl } from './pdfAddress'
import { NEEDS_PERMISSION } from './extensionProtocol'

export type SavePdfResult =
  | { ok: true; citekey: string; pdfName: string }
  | { ok: false; reason: string; offerExtension?: boolean }

/**
 * Turn a fetch failure into a sentence.
 *
 * `offerExtension` is the only flag here that changes what the panel DRAWS, so it is set only where
 * the extension genuinely removes the wall: a route the page cannot take, and a permission it holds
 * but has not been given. A file that is too large or is not a PDF at all would fail identically
 * with the extension installed, and offering it there would be the panel promising a fix it knows
 * will not work.
 */
export function explainFetchFailure(code: string): SavePdfResult {
  switch (code) {
    case 'no route':
      return {
        ok: false,
        reason: 'This site won’t let Inkwave read the file directly, and there’s no extension here to fetch it from your own connection.',
        offerExtension: true,
      }
    case NEEDS_PERMISSION:
      return {
        ok: false,
        reason: 'The Inkwave extension is installed but hasn’t been allowed to fetch pages yet — turn that on in its popup and try again.',
        offerExtension: false,
      }
    case 'too large':
      return { ok: false, reason: `That file is over ${mbOf(PDF_MAX_BYTES)}, which is more than Inkwave will embed in a document.` }
    case 'not a pdf':
      return { ok: false, reason: 'That address didn’t return a PDF — some publishers answer a download link with a sign-in page.' }
    case 'timed out':
      return { ok: false, reason: 'The download timed out.' }
    case 'bad url':
      return { ok: false, reason: 'That isn’t an address Inkwave can fetch.' }
    default:
      return /^http \d+$/.test(code)
        ? { ok: false, reason: `The site answered ${code.replace('http ', '')} — the file may need a sign-in Inkwave doesn’t have.` }
        : { ok: false, reason: 'The file couldn’t be downloaded.' }
  }
}

/**
 * Store a fetched PDF as a source in THIS document's citation library.
 *
 * The entry is deliberately saved with NO author and NO year. We have a URL and a filename, which
 * is genuinely all a browsed file tells us — and the citation panel already shows an entry missing
 * its required fields as needing them. Inventing an attribution the file never carried would be
 * worse than an obviously-incomplete row: it would look finished.
 */
export async function savePdfAsSource(o: {
  url: string
  bytes: Uint8Array
  pageTitle?: string | null
  now?: Date
}): Promise<SavePdfResult> {
  if (!looksLikePdfBytes(o.bytes)) return { ok: false, reason: 'That file isn’t a PDF.' }
  if (o.bytes.byteLength > PDF_MAX_BYTES) {
    return { ok: false, reason: `That file is ${mbOf(o.bytes.byteLength)} — the limit is ${mbOf(PDF_MAX_BYTES)}.` }
  }

  const pdfName = pdfFileNameFor(o.url)
  const meta: IwCitationMeta = {
    addedAt: (o.now ?? new Date()).toISOString(),
    sourceUrl: o.url,
  }
  const draft = {
    id: citekeyForPdfUrl(o.url),
    type: 'article',
    title: titleForPdfUrl(o.url, o.pageTitle),
    URL: o.url,
    _iw: meta,
  } as unknown as CSLItem

  // ── 1. the entry, so we learn the key the library actually gave it ────────────────────────────
  let citekey: string
  try {
    citekey = (await addToLibrary(draft)).id
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Couldn’t add that source to the library.' }
  }
  // `addToLibrary` resolving is not proof it PERSISTED — a library that failed to hydrate keeps
  // changes in memory and logs rather than writing. Ask the store what is actually there.
  if (!bibProvider.get(citekey)) {
    return { ok: false, reason: 'Inkwave couldn’t write to this document’s source list.' }
  }

  // ── 2. the bytes, under that key ──────────────────────────────────────────────────────────────
  try {
    await savePdf(citekey, new Blob([o.bytes as unknown as BlobPart], { type: 'application/pdf' }))
  } catch (e) {
    // The source survives as a URL — say exactly that, rather than reporting a success the writer
    // will discover is hollow, or a failure that hides the half that worked.
    return {
      ok: false,
      reason: `Saved “${citekey}” as a source, but the PDF itself couldn’t be stored on this device${
        e instanceof Error && e.message ? ` — ${e.message}` : '.'}`,
    }
  }

  // ── 3. only now is the claim true ─────────────────────────────────────────────────────────────
  const stored = bibProvider.get(citekey)
  if (stored) {
    const iw: IwCitationMeta = { ...((stored as { _iw?: IwCitationMeta })._iw ?? meta), pdfName }
    await addToLibrary({ ...stored, _iw: iw })
  }
  // Same one-time reconciliation the manual attach does (it has its own consent gate). Fire and
  // forget: a page-offset that never arrives costs a page label, not the source.
  void detectPageOffset(citekey)

  return { ok: true, citekey, pdfName }
}
