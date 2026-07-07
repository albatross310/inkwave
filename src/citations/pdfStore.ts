// Device-scoped storage for embedded source PDFs, kept in OPFS at library/pdfs/<citekey>.pdf.
// The library JSON only records the original filename (_iw.pdfName); the bytes live here so they
// never bloat the citation JSON or any provenance hash. Chromium/Firefox have OPFS; Safari too.

const DIR = 'library'
const SUB = 'pdfs'

// citekeys can contain characters invalid in a filename — encode, and always end in .pdf.
const fileName = (citekey: string) => `${encodeURIComponent(citekey)}.pdf`

async function pdfDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory()
    const lib = await root.getDirectoryHandle(DIR, { create })
    return await lib.getDirectoryHandle(SUB, { create })
  } catch {
    return null
  }
}

/** Store (or replace) the PDF bytes for a citekey. Throws if OPFS is unavailable. */
// In-memory version per citekey, bumped on every save/delete, so the export-bundle base64 cache can
// tell when a PDF actually changed and otherwise skip re-reading + re-encoding it.
const _pdfVersion = new Map<string, number>()
export const pdfVersion = (citekey: string): number => _pdfVersion.get(citekey) ?? 0
const bumpPdfVersion = (citekey: string) => _pdfVersion.set(citekey, pdfVersion(citekey) + 1)

export async function savePdf(citekey: string, file: Blob): Promise<void> {
  const dir = await pdfDir(true)
  if (!dir) throw new Error('Storage unavailable — cannot embed the PDF on this device.')
  const handle = await dir.getFileHandle(fileName(citekey), { create: true })
  const w = await handle.createWritable()
  await w.write(file)
  await w.close()
  bumpPdfVersion(citekey)
}

/** Read the stored PDF for a citekey, or null if none. */
export async function loadPdf(citekey: string): Promise<Blob | null> {
  const dir = await pdfDir(false)
  if (!dir) return null
  try {
    return await (await dir.getFileHandle(fileName(citekey))).getFile()
  } catch {
    return null
  }
}

// ── URL-PDF cache ──────────────────────────────────────────────────────────────
// A separate OPFS cache for PDFs fetched from a URL (via the proxy), keyed by a hash of the URL. Kept
// OUT of library/pdfs so it never embeds in the .studio bundle (no bloat) — it's purely a device-local
// speed cache so a URL PDF loads instantly the second time instead of re-fetching through the proxy.
const URLCACHE = 'urlcache'
const urlKey = (url: string): string => { let h = 0x811c9dc5; for (let i = 0; i < url.length; i++) { h ^= url.charCodeAt(i); h = Math.imul(h, 0x01000193) } return `${(h >>> 0).toString(16)}.pdf` }
async function urlCacheDir(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory()
    const lib = await root.getDirectoryHandle(DIR, { create })
    return await lib.getDirectoryHandle(URLCACHE, { create })
  } catch { return null }
}
export async function loadCachedUrlPdf(url: string): Promise<Blob | null> {
  const dir = await urlCacheDir(false)
  if (!dir) return null
  try { return await (await dir.getFileHandle(urlKey(url))).getFile() } catch { return null }
}
export async function cacheUrlPdf(url: string, blob: Blob): Promise<void> {
  const dir = await urlCacheDir(true)
  if (!dir) return
  try { const h = await dir.getFileHandle(urlKey(url), { create: true }); const w = await h.createWritable(); await w.write(blob); await w.close() } catch { /* storage full */ }
}

/** Remove the stored PDF for a citekey (no-op if absent). */
export async function deletePdf(citekey: string): Promise<void> {
  const dir = await pdfDir(false)
  if (!dir) return
  try { await dir.removeEntry(fileName(citekey)) } catch { /* already gone */ }
  bumpPdfVersion(citekey)
}

// ── base64 <-> Blob (for embedding PDFs in the .studio bundle) ──
export function blobToBase64(blob: Blob): Promise<string> {
  // FileReader.readAsDataURL encodes in the browser's NATIVE code (off the JS main thread) — the old
  // arrayBuffer + String.fromCharCode-loop + btoa did a 20 MB string build + encode on the main thread
  // every save, which was the editing/load lag. We strip the "data:...;base64," prefix it adds.
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)) }
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.readAsDataURL(blob)
  })
}

export function base64ToBlob(b64: string, type = 'application/pdf'): Blob {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}
