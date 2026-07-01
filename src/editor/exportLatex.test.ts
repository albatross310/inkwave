import { describe, it, expect } from 'vitest'
import { documentToLatex, extractEquations } from './exportLatex'
import type { PMNode } from './exportLatex'

// Minimal style so the preamble is deterministic in tests.
const STYLE = {
  fontPackage: 'ebgaramond',
  familyName: 'EB Garamond',
  fontSizePt: 13.5,
  baselinePt: 33.75,
  marginSideMm: 16.93,
  marginVertMm: 19.05,
}

function docOf(...blocks: PMNode[]): PMNode {
  return { type: 'doc', content: blocks }
}

function para(text: string, marks?: Array<{ type: string; attrs?: Record<string, unknown> }>): PMNode {
  return { type: 'paragraph', content: [{ type: 'text', text, marks }] }
}

function heading(level: number, text: string): PMNode {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] }
}

describe('documentToLatex', () => {
  it('wraps content in a preamble + document environment', () => {
    const tex = documentToLatex(docOf(para('Hello.')), STYLE)
    expect(tex).toContain('\\documentclass')
    expect(tex).toContain('\\begin{document}')
    expect(tex).toContain('\\end{document}')
  })

  it('renders plain paragraph text', () => {
    const tex = documentToLatex(docOf(para('Alpha beta gamma.')), STYLE)
    expect(tex).toContain('Alpha beta gamma.')
  })

  it('escapes LaTeX special characters in text', () => {
    const tex = documentToLatex(docOf(para('cost 50% & $5 for #1 item {a}')), STYLE)
    expect(tex).toContain('cost 50\\% \\& \\$5 for \\#1 item \\{a\\}')
  })

  it('escapes backslash to \\textbackslash{}', () => {
    const tex = documentToLatex(docOf(para('path\\file')), STYLE)
    expect(tex).toContain('path\\textbackslash{}file')
  })

  it('renders bold text with \\textbf', () => {
    const n: PMNode = { type: 'paragraph', content: [{ type: 'text', text: 'strong', marks: [{ type: 'bold' }] }] }
    const tex = documentToLatex(docOf(n), STYLE)
    expect(tex).toContain('\\textbf{strong}')
  })

  it('renders italic text with \\textit', () => {
    const n: PMNode = { type: 'paragraph', content: [{ type: 'text', text: 'slant', marks: [{ type: 'italic' }] }] }
    const tex = documentToLatex(docOf(n), STYLE)
    expect(tex).toContain('\\textit{slant}')
  })

  it('renders code spans with \\texttt', () => {
    const n: PMNode = { type: 'paragraph', content: [{ type: 'text', text: 'foo()', marks: [{ type: 'code' }] }] }
    const tex = documentToLatex(docOf(n), STYLE)
    expect(tex).toContain('\\texttt{foo()}')
  })

  it('renders headings as starred section commands', () => {
    const tex = documentToLatex(docOf(heading(1, 'Introduction')), STYLE)
    expect(tex).toContain('\\section*{Introduction}')
  })

  it('renders h2 as subsection', () => {
    const tex = documentToLatex(docOf(heading(2, 'Methods')), STYLE)
    expect(tex).toContain('\\subsection*{Methods}')
  })

  it('renders a blockquote', () => {
    const node: PMNode = { type: 'blockquote', content: [para('The text.')] }
    const tex = documentToLatex(docOf(node), STYLE)
    expect(tex).toContain('\\begin{quote}')
    expect(tex).toContain('\\end{quote}')
  })

  it('renders an unordered list', () => {
    const node: PMNode = {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [para('first')] },
        { type: 'listItem', content: [para('second')] },
      ],
    }
    const tex = documentToLatex(docOf(node), STYLE)
    expect(tex).toContain('\\begin{itemize}')
    expect(tex).toContain('\\item first')
    expect(tex).toContain('\\item second')
    expect(tex).toContain('\\end{itemize}')
  })

  it('renders an ordered list', () => {
    const node: PMNode = {
      type: 'orderedList',
      content: [{ type: 'listItem', content: [para('step one')] }],
    }
    const tex = documentToLatex(docOf(node), STYLE)
    expect(tex).toContain('\\begin{enumerate}')
    expect(tex).toContain('\\item step one')
  })

  it('renders a code block with verbatim', () => {
    const node: PMNode = { type: 'codeBlock', content: [{ type: 'text', text: 'fn f() {}' }] }
    const tex = documentToLatex(docOf(node), STYLE)
    expect(tex).toContain('\\begin{verbatim}')
    expect(tex).toContain('fn f() {}')
    expect(tex).toContain('\\end{verbatim}')
  })

  it('includes the font package in preamble', () => {
    const tex = documentToLatex(docOf(para('x')), STYLE)
    expect(tex).toContain('\\usepackage{ebgaramond}')
  })

  it('emits a comment when font package is null', () => {
    const style = { ...STYLE, fontPackage: null, familyName: 'Mystery Font' }
    const tex = documentToLatex(docOf(para('x')), style)
    expect(tex).toContain('% No LaTeX package mapped for "Mystery Font"')
  })

  it('emits a horizontal rule', () => {
    const tex = documentToLatex(docOf({ type: 'horizontalRule' }), STYLE)
    expect(tex).toContain('\\noindent\\rule')
  })

  it('renders empty paragraph as a blank line', () => {
    const node: PMNode = { type: 'paragraph', content: [] }
    const tex = documentToLatex(docOf(node), STYLE)
    // Empty paragraph produces a single newline (not content)
    expect(tex).toContain('\n')
  })
})

describe('extractEquations', () => {
  it('returns empty array for a doc with no math blocks', () => {
    expect(extractEquations(docOf(para('text')))).toHaveLength(0)
  })

  it('finds a mathBlock at its top-level line number', () => {
    const doc = docOf(
      para('intro'),                                  // line 1
      { type: 'mathBlock', attrs: { latex: 'x^2' } }, // line 2
    )
    const eq = extractEquations(doc)
    expect(eq).toHaveLength(1)
    expect(eq[0].lineNum).toBe(2)
    expect(eq[0].source).toBe('x^2')
  })

  it('numbers multiple equations by their position in the block list', () => {
    const doc = docOf(
      para('p1'),
      { type: 'mathBlock', attrs: { latex: 'a+b' } },
      para('p2'),
      { type: 'mathBlock', attrs: { latex: 'c*d' } },
    )
    const eq = extractEquations(doc)
    expect(eq).toHaveLength(2)
    expect(eq[0]).toEqual({ lineNum: 2, source: 'a+b' })
    expect(eq[1]).toEqual({ lineNum: 4, source: 'c*d' })
  })

  it('reads formula/content attr as fallback when latex is absent', () => {
    const doc = docOf({ type: 'mathBlock', attrs: { formula: 'E=mc^2' } })
    const eq = extractEquations(doc)
    expect(eq[0].source).toBe('E=mc^2')
  })
})
