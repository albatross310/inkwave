// Pure .studio/.trace.json text→bundle parsing — worker-safe (no DOM, no stores). Split from
// bundle.ts so the parse worker (src/workers/parse.worker.ts) can run it off the main thread
// without dragging the bundle-assembly graph (bibProvider, pool, OPFS helpers) into the worker.

import type { ExportBundle } from './bundle'

export const TRACE_DATA_MARKER = '══════ INKWAVE RECORD · verify at iwzero.me/verify ══════'
// Older domains, still accepted on read so files exported before the iwzero.me migration keep opening.
export const TRACE_DATA_MARKERS_LEGACY = [
  '══════ INKWAVE RECORD · verify at inkwave.studio/verify ══════',
  '══════ INKWAVE RECORD · verify at inkwave.me/verify ══════',
]

// Cap the dropped-file size before JSON.parse (audit F7): a real record is well under this, so a
// huge file is either a mistake or a DoS attempt — reject it cheaply rather than parse it.
export const MAX_TRACE_BYTES = 120_000_000 // 120 MB — allows a few base64-embedded source PDFs

/** Read a .trace.json file back into a bundle (hybrid text-header format OR a legacy pure-JSON file). */
export function parseTraceFile(fileText: string): ExportBundle {
  if (fileText.length > MAX_TRACE_BYTES) throw new Error('file too large to be an Inkwave record')
  // Anchor on the FULL marker line, not a substring an attacker could plant earlier in the prose
  // to redirect the JSON slice (audit F7). Accept both the current domain and the legacy one so
  // files exported before the inkwave.studio domain continue to open.
  let i = fileText.indexOf(TRACE_DATA_MARKER)
  if (i < 0) for (const m of TRACE_DATA_MARKERS_LEGACY) { i = fileText.indexOf(m); if (i >= 0) break }
  const json = i < 0 ? fileText : fileText.slice(fileText.indexOf('{', i))
  return JSON.parse(json) as ExportBundle
}
