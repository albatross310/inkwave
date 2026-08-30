// THE CAPTURE PANEL'S PURE FIELD HELPERS — MOVED OUT OF THE EXTENSION SO THE GATE CAN REACH THEM.
//
// `vite.config.ts` includes only `src/**`, so all 1,153 lines of `extension-src/` sat outside
// `pnpm test` — including these, which decide what the capture-verification panel offers as a
// hover target on whatever page the writer is citing. They touch no `browser.*` API and no DOM, so
// nothing but their address was keeping them untested. `content-source.ts` now imports them.
//
// Same direction as extensionProtocol.ts and framingRule.ts: the extension imports from src/ and
// never the reverse, because the app is the only side that cannot import from the other.
//
// ⚠ EVERY BODY BELOW IS BYTE-IDENTICAL TO THE SHIPPED ORIGINAL, INCLUDING THE BUG NAMED NEXT.
// `sourceFields.test.ts` was written against a verbatim extraction of the originals FIRST and
// passed there before this file existed, so it is scoring the shipped behaviour rather than my
// rewrite of it. Two of its assertions contradicted me; both are marked in that file.
//
// ⚠ ALL FOLDING CLASSES USE \uXXXX ESCAPES, NOT LITERAL CHARACTERS, AND THAT IS THE FIX.
// The quote-folding classes shipped as /['']/ and /[""]/ — i.e. containing ONLY the ASCII form,
// so they were `'`->`'` and `"`->`"`, two no-ops. The curly codepoints had been straightened out of
// the source at some point; the space and dash classes still carried theirs, which is why it went
// unseen for so long. Cost: a page rendering a curly apostrophe never matched an extracted straight
// one, so the capture panel silently offered no hover target on most published prose. It failed
// SAFE — textHighlight.ts folds those codepoints explicitly, so the panel under-promised rather
// than pointing at nothing — which is exactly why nobody noticed.
//
// Correcting the two classes would leave the MECHANISM in place, so every class is escaped: a
// literal curly character in source is one careless paste from becoming a no-op again, with no
// error and no visible diff. `sourceFields.test.ts` keeps it that way.

// normNode: normalises a single text node without trimming — preserving the trailing
// space in "Tyler " so cross-element names like "Tyler Graham" are found when the
// first name and surname are in separate inline elements.
export function normNode(s: string): string {
  return s.normalize('NFC')
    .replace(/[\u00A0\u202F\u2009]/g, ' ')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00AD/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
  // no .trim() here: trimming strips trailing spaces from nodes, breaking cross-element name matching
}

// Walk visible text nodes and return true if `needle` is found (normalised).
// normText: needle normalizer — same as normNode but trims outer whitespace.
export function normText(s: string): string { return normNode(s).trim() }
// Multi-author values ("Tyler Graham, Katie Collins" / "Tyler Graham and Katie Collins") rarely
// appear contiguously in the page — each author sits in its own byline card. Offer the whole value
// first, then each individual author, so hover can at least snap to the primary author.
export function authorCandidates(value: string): string[] {
  const parts = value.split(/\s*(?:,|;|&|\band\b)\s*/i).map(s => s.trim()).filter(s => s.length >= 3)
  return parts.length > 1 ? [value, ...parts] : [value]
}

// YouTube shows a RELATIVE date ("13 days ago") next to the view count; the absolute date hides
// behind the "…more" dropdown. Derive the likely relative strings from the ISO date + today so hover
// can snap to what's actually on screen. ±1 on each unit absorbs YouTube's timestamp-vs-midnight
// rounding. Video-only (relative forms would false-match elsewhere on ordinary pages).
export function relativeDateCandidates(iso: string): string[] {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return []
  const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const now = new Date()
  const days = Math.round((now.getTime() - then.getTime()) / 86_400_000)
  if (!Number.isFinite(days) || days < 0) return []
  const ago = (n: number, u: string) => `${n} ${u}${n === 1 ? '' : 's'} ago`
  if (days === 0) return ['today']
  if (days === 1) return ['yesterday', '1 day ago']
  const weeks = Math.round(days / 7), months = Math.round(days / 30), years = Math.round(days / 365)
  // Primary form first, matching YouTube's unit thresholds (days→weeks at 14, →months ~8wk, →years
  // at a year). Coarse fallbacks next; the raw "N days ago" goes LAST so a comment's day-stamp is the
  // least-preferred match (comments are full of relative dates; the video's own form is the target).
  const out: string[] = []
  if (days <= 13) out.push(ago(days, 'day'))
  else if (days < 56) out.push(ago(weeks, 'week'))
  else if (days < 365) out.push(ago(months, 'month'))
  else out.push(ago(years, 'year'))
  if (weeks >= 1) out.push(ago(weeks, 'week'))
  if (months >= 1) out.push(ago(months, 'month'))
  if (years >= 1) out.push(ago(years, 'year'))
  out.push(ago(days, 'day'))
  return [...new Set(out)]
}

// For date values the AI returns ISO format (2017-08-28) but pages show
// "August 28, 2017" etc. Try several common renderings before giving up.
export function dateSearchCandidates(value: string): string[] {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return [value]
  const [, y, mo, d] = m
  try {
    const dt = new Date(Number(y), Number(mo) - 1, Number(d))
    return [
      value,
      dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long',  day: 'numeric' }), // August 28, 2017
      dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }), // Aug 28, 2017
      `${Number(d)} ${dt.toLocaleDateString('en-US', { month: 'long' })} ${Number(y)}`,    // 28 August 2017
      `${Number(d)} ${dt.toLocaleDateString('en-US', { month: 'short' })} ${Number(y)}`,   // 28 Aug 2017
      `${dt.toLocaleDateString('en-US', { month: 'long' })} ${Number(d)}`,                 // August 28
      y,                                                                                    // 2017 (year alone)
    ]
  } catch { return [value] }
}
export function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
