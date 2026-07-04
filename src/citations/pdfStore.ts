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
export async function savePdf(citekey: string, file: Blob): Promise<void> {
  const dir = await pdfDir(true)
  if (!dir) throw new Error('Storage unavailable — cannot embed the PDF on this device.')
  const handle = await dir.getFileHandle(fileName(citekey), { create: true })
  const w = await handle.createWritable()
  await w.write(file)
  await w.close()
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

/** Remove the stored PDF for a citekey (no-op if absent). */
export async function deletePdf(citekey: string): Promise<void> {
  const dir = await pdfDir(false)
  if (!dir) return
  try { await dir.removeEntry(fileName(citekey)) } catch { /* already gone */ }
}
