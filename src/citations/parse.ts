// BibTeX → CSL-JSON via citation-js.
// We register the bibtex plugin once and keep the import lazy (large bundle).
// The id of each CSLItem is forced to the BibTeX entry key, which equals the BBT citekey.

import type { CSLItem } from '../types/document'

let registered = false

async function getCite(): Promise<typeof import('@citation-js/core').Cite> {
  // Register bibtex plugin once
  if (!registered) {
    await import('@citation-js/plugin-bibtex')
    registered = true
  }
  const { Cite } = await import('@citation-js/core')
  return Cite
}

export async function parseBibtex(bibtex: string): Promise<CSLItem[]> {
  const Cite = await getCite()
  const cite = await Cite.async(bibtex, { forceType: '@bibtex/text' })
  const raw: CSLItem[] = cite.get({ type: 'json', style: 'csl' }) as CSLItem[]

  // citation-js sometimes puts the entry key in 'citation-key' or emits a generated id.
  // We override id with the raw bibtex entry key, which IS the BBT citekey.
  // The raw plugin stores it in 'citation-key' for @bibtex entries.
  return raw.map((item) => {
    const key = (item as Record<string, unknown>)['citation-key']
    if (typeof key === 'string' && key) return { ...item, id: key }
    return item
  })
}
