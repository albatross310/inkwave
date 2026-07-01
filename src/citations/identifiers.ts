// Identifier detection — the no-AI, high-precision citation path. Given a pasted string or URL,
// find a DOI / arXiv id / PubMed id / ISBN. Pure + synchronous so it's cheap and unit-testable.
// Priority: DOI > arXiv > PMID > ISBN (DOI is the most canonical and most common for journals).

export type IdentifierKind = 'doi' | 'arxiv' | 'pmid' | 'isbn'

export interface DetectedIdentifier {
  kind: IdentifierKind
  value: string   // normalised: bare DOI, arXiv id, digits for PMID, ISBN-13/10 without separators
}

// DOI: 10.<registrant>/<suffix>. The suffix is permissive; we trim trailing punctuation/brackets
// that commonly cling to a DOI when copied from prose or a URL.
const DOI_RE = /10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/
// arXiv: new scheme (2401.12345 / 2401.12345v2) or legacy (hep-th/0603057). Optional "arXiv:" label
// and /abs/ URL segment.
const ARXIV_NEW_RE = /(?:arxiv:|\/abs\/)?(\d{4}\.\d{4,5})(v\d+)?/i
const ARXIV_OLD_RE = /(?:arxiv:|\/abs\/)?([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i
const PMID_RE = /(?:pmid:?\s*|pubmed\.ncbi\.nlm\.nih\.gov\/)(\d{6,9})/i

function trimDoi(raw: string): string {
  // Drop trailing punctuation a DOI never legitimately ends with when lifted from text/URLs.
  return raw.replace(/[.,;:)\]}>'"]+$/, '')
}

/** Normalise an ISBN candidate: strip separators, validate ISBN-10/13 checksums. Returns null if invalid. */
export function normalizeIsbn(raw: string): string | null {
  const digits = raw.replace(/[\s-]/g, '').toUpperCase()
  if (/^\d{9}[\dX]$/.test(digits)) {
    // ISBN-10 checksum
    let sum = 0
    for (let i = 0; i < 10; i++) {
      const c = digits[i]
      const v = c === 'X' ? 10 : Number(c)
      sum += v * (10 - i)
    }
    return sum % 11 === 0 ? digits : null
  }
  if (/^\d{13}$/.test(digits)) {
    let sum = 0
    for (let i = 0; i < 13; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3)
    return sum % 10 === 0 ? digits : null
  }
  return null
}

/** Detect the first (highest-priority) identifier in an arbitrary input string or URL. */
export function detectIdentifier(input: string): DetectedIdentifier | null {
  const s = input.trim()
  if (!s) return null

  const doi = DOI_RE.exec(s)
  if (doi) return { kind: 'doi', value: trimDoi(doi[0]) }

  // arXiv — try new scheme then legacy. Guard: don't misread a bare 4.5-digit run inside other text
  // by requiring the arxiv/abs context OR a clean standalone match.
  const arxivCtx = /arxiv|\/abs\//i.test(s)
  const arxNew = ARXIV_NEW_RE.exec(s)
  if (arxNew && (arxivCtx || /^\d{4}\.\d{4,5}(v\d+)?$/.test(s))) {
    return { kind: 'arxiv', value: arxNew[1] + (arxNew[2] ?? '') }
  }
  const arxOld = ARXIV_OLD_RE.exec(s)
  if (arxOld && arxivCtx) return { kind: 'arxiv', value: arxOld[1] + (arxOld[2] ?? '') }

  const pmid = PMID_RE.exec(s)
  if (pmid) return { kind: 'pmid', value: pmid[1] }

  // ISBN — look for a labelled or standalone 10/13-run and checksum it.
  const isbnLabel = /isbn[:\s]*([\dxX][\dxX\s-]{8,})/i.exec(s)
  if (isbnLabel) {
    const norm = normalizeIsbn(isbnLabel[1])
    if (norm) return { kind: 'isbn', value: norm }
  }
  for (const m of s.matchAll(/[\dX][\dX\s-]{8,}[\dX]/gi)) {
    const norm = normalizeIsbn(m[0])
    if (norm) return { kind: 'isbn', value: norm }
  }

  return null
}

/** True when the input looks like an http(s) URL (used to route to the LLM scrape path). */
export function isUrl(input: string): boolean {
  return /^https?:\/\/\S+$/i.test(input.trim())
}
