// Paste-back scanning + forgiving CSV parse — spec §A7.1.5.
//
// The writer pastes the WHOLE reply. Inkwave scans it for the fenced CSV block and parses it
// "forgivingly (handle quoting, whitespace, extra prose)". Every allowance below is a real thing
// a model does; none of them is an allowance about MEANING. This module answers "what shape is
// this text?" and nothing else — whether the table is the RIGHT table is judged.ts's job, and
// keeping the two apart is what stops forgiveness from sliding into accepting anything (a parser
// that shrugs at a wrong header is a parser that silently graphs the wrong data).

/** A fenced block found in the reply. */
export interface FencedBlock {
  text: string
  /** The info string on the opening fence, lower-cased ('csv', 'CSV', '', 'markdown', …). */
  tag: string
  /** False when the reply was truncated mid-block — the fence never closed. */
  closed: boolean
}

// Fences: ``` or ~~~, 3+ chars, optional leading whitespace, optional space before the tag.
const FENCE = /^[ \t]*(`{3,}|~{3,})[ \t]*([^\s`]*)[ \t]*$/

/** Every fenced block in the reply, in order. A block left open by a truncated reply is kept
 *  (marked `closed: false`) so the caller can say "this looks cut off" instead of "no table". */
export function findFencedBlocks(reply: string): FencedBlock[] {
  const lines = reply.split(/\r?\n/)
  const blocks: FencedBlock[] = []
  let open: { fence: string; tag: string; body: string[] } | null = null
  for (const line of lines) {
    const m = FENCE.exec(line)
    if (open) {
      // A closing fence must use the same character; a longer run is fine (CommonMark).
      if (m && m[1][0] === open.fence[0] && m[1].length >= open.fence.length && !m[2]) {
        blocks.push({ text: open.body.join('\n'), tag: open.tag, closed: true })
        open = null
      } else {
        open.body.push(line)
      }
      continue
    }
    if (m) open = { fence: m[1], tag: m[2].toLowerCase(), body: [] }
  }
  if (open) blocks.push({ text: open.body.join('\n'), tag: open.tag, closed: false })
  return blocks
}

/**
 * The blocks worth trying as the judged table, best first: explicitly `csv`-tagged blocks, then
 * untagged ones (a model that forgot the tag), then anything else. Deliberately does NOT decide
 * which is correct — validation does, and the caller tries them in this order.
 */
export function candidateCsvBlocks(reply: string): FencedBlock[] {
  const blocks = findFencedBlocks(reply)
  const rank = (b: FencedBlock) => (b.tag === 'csv' ? 0 : b.tag === '' ? 1 : 2)
  return blocks
    .map((b, i) => ({ b, i }))
    .sort((x, y) => rank(x.b) - rank(y.b) || x.i - y.i)
    .map(x => x.b)
}

// ─── The parse ──────────────────────────────────────────────────────────────────────────────

// Models emit curly quotes when prose-styling gets into a table. Treated as quote characters
// ONLY at a field boundary (see below), so a note containing “a quoted phrase” mid-sentence
// still parses as ordinary text.
function isQuote(c: string): boolean {
  return c === '"' || c === '“' || c === '”'
}

/** Is this a markdown pipe table rather than a CSV? (A model asked for CSV sometimes formats
 *  one anyway.) True only if most non-blank lines are pipe-delimited — not on a stray '|'. */
export function looksLikePipeTable(text: string): boolean {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return false
  const piped = lines.filter(l => l.startsWith('|') && l.includes('|', 1)).length
  return piped >= Math.ceil(lines.length * 0.6)
}

// A markdown separator row: |---|:--:|
const SEP_ROW = /^[\s|:-]+$/

function parsePipeTable(text: string): string[][] {
  return text.split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.startsWith('|') && !SEP_ROW.test(l))
    .map(l => {
      const cells = l.split('|')
      cells.shift()                              // text before the leading pipe
      if (cells.length && !cells[cells.length - 1].trim()) cells.pop()  // trailing pipe
      return cells.map(c => c.trim())
    })
    .filter(r => r.some(c => c !== ''))
}

/**
 * Parse delimited text into rows. Forgiving about: CRLF, blank lines, leading/trailing space
 * around fields, RFC-4180 doubled quotes, curly quotes, quoted fields containing commas and
 * newlines, a reply that stops mid-quote, and markdown pipe tables. NOT forgiving about
 * anything that would change what a cell MEANS: an unquoted field is trimmed, a quoted one is
 * returned byte-exact.
 */
export function parseDelimited(text: string): string[][] {
  if (looksLikePipeTable(text)) return parsePipeTable(text)

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false        // this field opened with a quote
  let inQuotes = false
  let atFieldStart = true

  const endField = () => {
    row.push(quoted ? field : field.trim())
    field = ''
    quoted = false
    atFieldStart = true
  }
  const endRow = () => {
    endField()
    if (row.some(c => c !== '')) rows.push(row)   // drop blank lines
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (isQuote(c)) {
        if (isQuote(text[i + 1])) { field += '"'; i++; continue }   // "" → a literal quote
        inQuotes = false
        continue
      }
      field += c
      continue
    }
    if (atFieldStart && (c === ' ' || c === '\t')) continue          // leading padding
    if (atFieldStart && isQuote(c)) { inQuotes = true; quoted = true; atFieldStart = false; continue }
    if (c === ',') { endField(); continue }
    if (c === '\r') continue
    if (c === '\n') { endRow(); continue }
    field += c
    atFieldStart = false
  }
  // A reply truncated mid-quote still yields its last partial row rather than vanishing.
  if (field !== '' || row.length) endRow()
  return rows
}
