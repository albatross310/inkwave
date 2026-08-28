// LATEX IN A FETCHED ARTICLE.
//
// Peter, 2026-08-28, looking at an SEP entry rendering `\[\tag{LL} \forall x\forall y[x=y ...]\]`
// as literal source: "we need to incorporate some kind of latex engine or something for reading
// this kind of thing."
//
// WHY IT ARRIVES RAW. SEP (and arXiv, and most philosophy/maths sites) ship LaTeX in the HTML and
// let MathJax typeset it IN THE BROWSER. Our reader fetches the page server-side, so it gets what
// the author wrote, before any script has run — which is the same reason a Google results page
// comes back empty. Live mode shows it typeset because the site's own MathJax runs there.
//
// The fix needs no new dependency: KaTeX is already bundled for the editor's own maths, and it is
// synchronous and side-effect-free, so it can render straight into the reader.
//
// SPLITTING IS THE WHOLE PROBLEM, and it is done conservatively:
//   • delimiters must be BALANCED — an unmatched `\[` is prose about LaTeX, not LaTeX;
//   • `$…$` is NOT treated as maths. Money and ranges ("$5", "$10–$20") are far commoner in prose
//     than inline TeX, and a mis-split renders the surrounding sentence as a formula. `\(…\)` and
//     `$$…$$` are unambiguous; `$…$` is not, so it is left alone.
// A segment that KaTeX refuses is returned as TEXT, never dropped: unreadable source beats a gap
// where an argument's key formula used to be.

export type MathSeg = { kind: 'text' | 'math'; value: string; display?: boolean }

const PATTERNS: Array<{ open: string; close: string; display: boolean }> = [
  { open: '\\[', close: '\\]', display: true },
  { open: '$$', close: '$$', display: true },
  { open: '\\(', close: '\\)', display: false },
]

export function splitMath(text: string): MathSeg[] {
  const out: MathSeg[] = []
  let i = 0
  let buf = ''
  outer: while (i < text.length) {
    for (const p of PATTERNS) {
      if (!text.startsWith(p.open, i)) continue
      const end = text.indexOf(p.close, i + p.open.length)
      if (end < 0) continue                      // unbalanced ⇒ not maths, just characters
      const body = text.slice(i + p.open.length, end).trim()
      if (!body) continue                        // `\[\]` is nothing; leave it as text
      if (buf) { out.push({ kind: 'text', value: buf }); buf = '' }
      out.push({ kind: 'math', value: body, display: p.display })
      i = end + p.close.length
      continue outer
    }
    buf += text[i]
    i++
  }
  if (buf) out.push({ kind: 'text', value: buf })
  return out
}

/** True when a string contains anything worth running the splitter over. */
export function hasMath(text: string): boolean {
  return /\\\[|\\\(|\$\$/.test(text)
}
