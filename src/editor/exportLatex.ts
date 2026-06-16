// LaTeX export. Walks the editor's ProseMirror document (editor.getJSON()) and emits a standalone
// .tex file the writer can typeset themselves — the source-code companion to the finished-PDF export.
//
// Fidelity: it can't be pixel-identical to the browser (different engines), but the preamble matches
// the editor's look — EB Garamond (the body font), the airy line spacing, left-aligned/ragged-right
// text with per-paragraph alignment, A4 page margins, and UNNUMBERED headings. Best results compile
// with XeLaTeX/LuaLaTeX (uses the real EB Garamond + covers non-Latin scripts); pdfLaTeX also works
// (the ebgaramond package handles both). Needs the standard `ebgaramond`, `ragged2e`, `setspace`
// packages (present in TeX Live / Overleaf).
//
// Scope: paragraphs, headings, bold/italic/underline/strike/code, links, bullet/ordered lists,
// blockquotes, code blocks, rules, per-block text alignment. SCAS highlighting is editor-only (a
// decoration, not stored) so it never reaches the document. Math is STUBBED (see isMath) ready for a
// KaTeX node; figures will need a bundle (a .tex can't carry image binaries).

export interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  text?: string
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
}

// LaTeX special characters → escaped forms. Backslash/tilde/caret can't be a simple prefix-escape.
const SPECIAL: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
}

function escapeText(s: string): string {
  return s.replace(/[\\&%$#_{}~^]/g, (c) => SPECIAL[c])
}

// URLs inside \href: escape the chars TeX would otherwise consume. (Most URL chars are fine.)
function escapeUrl(s: string): string {
  return s.replace(/[\\%#&]/g, (c) => '\\' + c)
}

function rawText(node: PMNode): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(rawText).join('')
}

// ── Math (STUB) ──────────────────────────────────────────────────────────────────────────────────
// Math isn't in the editor yet. A KaTeX extension typically adds nodes named inlineMath/blockMath
// with the source in attrs.latex. This emits that source RAW (never escaped). Tune the attr/type
// names to the chosen extension when math lands.
function isMath(n: PMNode): boolean { return /math/i.test(n.type) }
function isDisplayMath(n: PMNode): boolean { return /block|display/i.test(n.type) }
function mathSource(n: PMNode): string {
  return String(n.attrs?.latex ?? n.attrs?.formula ?? n.attrs?.content ?? rawText(n) ?? '')
}

function applyMarks(text: string, marks?: PMNode['marks']): string {
  if (!marks?.length) return text
  let out = text
  for (const m of marks) {
    switch (m.type) {
      case 'bold': case 'strong': out = `\\textbf{${out}}`; break
      case 'italic': case 'em': out = `\\textit{${out}}`; break
      case 'underline': out = `\\underline{${out}}`; break
      case 'strike': out = `\\sout{${out}}`; break
      case 'code': out = `\\texttt{${out}}`; break
      case 'link': {
        const href = (m.attrs?.href as string) || ''
        if (href) out = `\\href{${escapeUrl(href)}}{${out}}`
        break
      }
      // Unknown marks (e.g. the provenance slot mark) pass through as plain text.
      default: break
    }
  }
  return out
}

function inline(nodes?: PMNode[]): string {
  if (!nodes) return ''
  return nodes
    .map((n) => {
      if (n.type === 'text') return applyMarks(escapeText(n.text ?? ''), n.marks)
      if (n.type === 'hardBreak') return '\\\\\n'
      if (isMath(n) && !isDisplayMath(n)) return `$${mathSource(n)}$`
      return inline(n.content)
    })
    .join('')
}

const HEADING_CMD = ['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph']

function listItems(node: PMNode): string {
  return (node.content ?? [])
    .map((li) => {
      const inner = (li.content ?? [])
        .map((child) => (child.type === 'paragraph' ? inline(child.content) : block(child)))
        .join(' ')
        .trim()
      return `  \\item ${inner}\n`
    })
    .join('')
}

// Wrap a block for its TextAlign attr. Default/left = the document's global \RaggedRight (set in the
// preamble to match the editor's left-aligned, ragged-right text); the others use ragged2e commands.
function alignWrap(body: string, align?: unknown): string {
  switch (align) {
    case 'center': return `{\\Centering ${body}\\par}`
    case 'right': return `{\\RaggedLeft ${body}\\par}`
    case 'justify': return `{\\justifying ${body}\\par}`
    default: return body
  }
}

function block(node: PMNode): string {
  switch (node.type) {
    case 'paragraph': {
      const body = inline(node.content)
      return body.trim() ? alignWrap(body, node.attrs?.textAlign) + '\n\n' : '\n'
    }
    case 'heading': {
      const lvl = Math.min(Number(node.attrs?.level ?? 1), HEADING_CMD.length) - 1
      // Starred = unnumbered, matching the editor (headings carry no 1., 1.1 … on the page).
      return `\\${HEADING_CMD[Math.max(0, lvl)]}*{${inline(node.content)}}\n\n`
    }
    case 'blockquote':
      return `\\begin{quote}\n${(node.content ?? []).map(block).join('')}\\end{quote}\n\n`
    case 'bulletList':
      return `\\begin{itemize}\n${listItems(node)}\\end{itemize}\n\n`
    case 'orderedList':
      return `\\begin{enumerate}\n${listItems(node)}\\end{enumerate}\n\n`
    case 'codeBlock':
      return `\\begin{verbatim}\n${rawText(node)}\n\\end{verbatim}\n\n`
    case 'horizontalRule':
      return '\\begin{center}\\noindent\\rule{0.5\\textwidth}{0.4pt}\\end{center}\n\n'
    default:
      if (isMath(node)) return `\\[${mathSource(node)}\\]\n\n` // display-math stub
      // Unknown container: recurse so we never silently drop text.
      return (node.content ?? []).map(block).join('')
  }
}

// The editor's typographic identity, read live so the .tex tracks the editor — change the font or
// size in CSS and the export follows. (px → pt: 1px = 0.75pt, so 18px = 13.5pt, line-height 45px =
// 33.75pt baselineskip.)
export interface LatexStyle {
  fontPackage: string | null // LaTeX package for the body font (null → default roman + a note)
  familyName: string // the CSS primary family, for the comment when unmapped
  fontSizePt: number
  baselinePt: number // the line box height in pt = the editor's line-height
  marginSideMm: number // page side margin = the parchment's side padding (.scroll-paper px-16)
  marginVertMm: number // page top/bottom margin = the editor's per-page margin (72px)
}

const DEFAULT_STYLE: LatexStyle = {
  fontPackage: 'ebgaramond', familyName: 'EB Garamond', fontSizePt: 13.5, baselinePt: 33.75,
  marginSideMm: 16.93, marginVertMm: 19.05,
}

// CSS primary font-family (lowercased) → LaTeX font package. Extend when the editor gains fonts.
const FONT_PACKAGE: Record<string, string> = {
  'eb garamond': 'ebgaramond',
  garamond: 'ebgaramond',
  'im fell dw pica': 'ebgaramond', // no standard package; ebgaramond is the closest match
}

// Read font-family / font-size / line-height off the live editor so the export mirrors it. Falls back
// to DEFAULT_STYLE off the DOM (tests, SSR).
export function editorLatexStyle(): LatexStyle {
  if (typeof document === 'undefined') return DEFAULT_STYLE
  const pm = document.querySelector('.ProseMirror')
  if (!pm) return DEFAULT_STYLE
  const cs = getComputedStyle(pm)
  const px = parseFloat(cs.fontSize) || 18
  let linePx = parseFloat(cs.lineHeight)
  if (!isFinite(linePx)) linePx = px * 1.2 // "normal"
  const primary = (cs.fontFamily.split(',')[0] || '').replace(/["']/g, '').trim()
  const toPt = (v: number) => Math.round(v * 0.75 * 100) / 100
  const toMm = (v: number) => Math.round((v / 96) * 25.4 * 100) / 100
  // Side margin = the parchment's side padding (.scroll-paper px-16). Top/bottom = the editor's
  // per-page margin (72px), so they track the same constants the screen + PDF use.
  const sheet = document.querySelector('.scroll-paper')
  const sidePx = sheet ? parseFloat(getComputedStyle(sheet).paddingLeft) : 64
  return {
    fontPackage: FONT_PACKAGE[primary.toLowerCase()] ?? null,
    familyName: primary || 'EB Garamond',
    fontSizePt: toPt(px),
    baselinePt: toPt(linePx),
    marginSideMm: toMm(isFinite(sidePx) ? sidePx : 64),
    marginVertMm: toMm(72),
  }
}

export function documentToLatex(doc: PMNode, style: LatexStyle = DEFAULT_STYLE): string {
  const body = (doc.content ?? []).map(block).join('').trimEnd()
  const m = style
  const fontPkg = m.fontPackage
    ? `\\usepackage{${m.fontPackage}}` // matches the editor's body font
    : `% No LaTeX package mapped for "${m.familyName}" — using the default roman. Add one to FONT_PACKAGE in exportLatex.ts.`
  const geometry = `\\usepackage[a4paper,top=${m.marginVertMm}mm,bottom=${m.marginVertMm}mm,left=${m.marginSideMm}mm,right=${m.marginSideMm}mm]{geometry}`
  const preamble = [
    '% Generated by Inkwave. Best compiled with XeLaTeX or LuaLaTeX (real EB Garamond + full Unicode);',
    '% pdfLaTeX also works. Needs the font package above plus ragged2e, titlesec and anyfontsize.',
    '\\documentclass[12pt,a4paper]{article}',
    '\\usepackage[utf8]{inputenc}',
    '\\usepackage[T1]{fontenc}',
    fontPkg,
    '\\usepackage{anyfontsize}', // allow the exact (non-standard) editor size below
    geometry, // page margins matched to the editor
    '\\usepackage[document]{ragged2e}', // editor text is left-aligned / ragged-right, not justified
    '\\usepackage[normalem]{ulem}',
    '\\usepackage{hyperref}',
    '\\usepackage{titlesec}',
    // Headings: same font/weight as the body (the editor doesn't bold or number them), just larger.
    '\\titleformat{\\section}{\\normalfont\\Large}{}{0pt}{}',
    '\\titleformat{\\subsection}{\\normalfont\\large}{}{0pt}{}',
    '\\titleformat{\\subsubsection}{\\normalfont\\normalsize}{}{0pt}{}',
  ]
  // Exact editor font size + line spacing, applied to the whole body (\fontsize{size}{baselineskip}).
  // No \maketitle: the editor has no separate title block — the first heading/line IS the heading.
  const sizeLine = `\\fontsize{${m.fontSizePt}}{${m.baselinePt}}\\selectfont`
  return (
    preamble.join('\n') +
    '\n\n\\begin{document}\n' +
    sizeLine + '\n\n' +
    body +
    '\n\n\\end{document}\n'
  )
}

function safeName(title?: string): string {
  return (title ?? 'inkwave').trim().replace(/[^\w.-]+/g, '_').slice(0, 80) || 'inkwave'
}

// Trigger a .tex download of the document. `title` is used for the FILENAME only — there's no title
// block in the .tex (the editor doesn't render one).
export function exportLatexDownload(doc: PMNode, title?: string): void {
  const tex = documentToLatex(doc, editorLatexStyle())
  const blob = new Blob([tex], { type: 'application/x-tex' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeName(title)}.tex`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
