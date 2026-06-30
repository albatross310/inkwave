// Format CSL-JSON items into in-text citations and reference lists.
// Uses citation-js + @citation-js/plugin-csl. Lazy-loaded (large dep).

import type { CSLItem } from '../types/document'
import { ensureStyle } from './styles'

// ── In-text cite ────────────────────────────────────────────────────────────

export async function formatInText(
  items: CSLItem[],
  styleId = 'apa',
  opts: { suppressAuthor?: boolean; locator?: string; prefix?: string; suffix?: string } = {},
): Promise<string> {
  if (items.length === 0) return ''
  await ensureStyle(styleId)
  const { Cite } = await import('@citation-js/core')
  const cite = new Cite(items)
  // citation-js in-text template
  const result: string = cite.format('citation', {
    format: 'text',
    template: styleId,
    lang: 'en-US',
  }) as string
  const base = result.trim()
  const prefix = opts.prefix ? `${opts.prefix} ` : ''
  const suffix = opts.suffix ? `, ${opts.suffix}` : ''
  return `${prefix}${base}${suffix}`
}

// ── Simple in-text fallback (no CSL engine) — "(Author, Year)" ──────────────

export function simpleInText(items: CSLItem[]): string {
  const parts = items.map(item => {
    const author = item.author?.[0]
    const name = author ? (author.family ?? author.literal ?? '?') : '?'
    const year = item.issued?.['date-parts']?.[0]?.[0] ?? '?'
    return `${name}, ${year}`
  })
  return `(${parts.join('; ')})`
}

// ── Reference list ──────────────────────────────────────────────────────────

export async function formatReferenceList(
  items: CSLItem[],
  styleId = 'apa',
): Promise<string> {
  if (items.length === 0) return ''
  await ensureStyle(styleId)
  const { Cite } = await import('@citation-js/core')
  const cite = new Cite(items)
  return cite.format('bibliography', {
    format: 'html',
    template: styleId,
    lang: 'en-US',
  }) as string
}

// Fallback plain-text reference list if CSL engine unavailable
export function simpleRefList(items: CSLItem[]): string {
  return items.map(item => {
    const authors = (item.author ?? []).map(a => {
      if (a.literal) return a.literal
      return [a.family, a.given].filter(Boolean).join(', ')
    }).join('; ')
    const year = item.issued?.['date-parts']?.[0]?.[0] ?? ''
    const title = item.title ?? item.id
    const source = item['container-title'] ?? ''
    return `${authors} (${year}). ${title}${source ? `. ${source}` : ''}.`
  }).join('\n\n')
}
