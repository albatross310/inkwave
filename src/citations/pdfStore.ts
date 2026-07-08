// Device-scoped storage for embedded source PDFs, kept in OPFS at library/pdfs/<citekey>.pdf.
// The library JSON only records the original filename (_iw.pdfName); the bytes live here so they
// never bloat the citation JSON or any provenance hash. Chromium/Firefox have OPFS; Safari too.

import { writeOpfsFile } from '../storage/opfsWrite'
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
  const dir = await pdfDir(true) // ensures the dirs exist (and errors politely when OPFS is absent)
  if (!dir) throw new Error('Storage unavailable — cannot embed the PDF on this device.')
  // iOS-safe write (no createWritable on WebKit — worker sync-access fallback).
  await writeOpfsFile([DIR, SUB, fileName(citekey)], new Uint8Array(await file.arrayBuffer()))
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

// (The URL-PDF cache that lived here was removed with URL-linked PDFs, 2026-07-08. Stale
// library/urlcache dirs in existing browsers are harmless orphans.)

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

export async function base64ToBlob(b64: string, type = 'application/pdf'): Promise<Blob> {
  // Native data-URL decode (off the JS heap's hot path) — the old atob + per-char loop was a
  // 20M-iteration main-thread stall when opening a .studio with embedded PDFs.
  const res = await fetch(`data:${type};base64,${b64}`)
  return res.blob()
}
