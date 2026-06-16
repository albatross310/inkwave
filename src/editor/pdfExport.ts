// Proper A4 PDF export — a real paginated document with selectable text (NOT a print-to-PDF of the
// web page). Walks the Tiptap/ProseMirror JSON into headings + paragraphs, lays them onto A4 with
// 1-inch margins, a serif body, automatic page breaks, and page numbers. jsPDF is imported lazily so
// it's a separate client chunk and never enters the prerender/SSR graph.
import type { TiptapJSON } from '../types/document'

type Node = { type?: string; text?: string; content?: Node[]; attrs?: { level?: number } }

// Flatten a block's inline content to text; hard breaks become newlines (splitTextToSize honours them).
function inlineText(node: Node): string {
  if (node.type === 'hardBreak') return '\n'
  if (typeof node.text === 'string') return node.text
  if (Array.isArray(node.content)) return node.content.map(inlineText).join('')
  return ''
}

function slug(title: string): string {
  return (title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled'
}

export async function exportDocPdf(title: string, contentJson: TiptapJSON): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 72 // 1 inch
  const contentW = pageW - margin * 2
  let y = margin

  const newPageIfNeeded = (lineH: number) => { if (y + lineH > pageH - margin) { doc.addPage(); y = margin } }
  const writeLines = (text: string, size: number, style: 'normal' | 'bold' | 'italic', leading: number, after: number) => {
    doc.setFont('times', style)
    doc.setFontSize(size)
    const lineH = size * leading
    const lines = doc.splitTextToSize(text.length ? text : ' ', contentW) as string[]
    for (const ln of lines) { newPageIfNeeded(lineH); doc.text(ln, margin, y); y += lineH }
    y += after
  }

  // Document title at the top.
  const clean = (title || '').trim()
  if (clean) { writeLines(clean, 22, 'bold', 1.25, 18) }

  const blocks = (contentJson as unknown as Node)?.content ?? []
  for (const block of blocks) {
    const text = inlineText(block)
    if (block.type === 'heading') {
      const level = block.attrs?.level ?? 2
      const size = level === 1 ? 18 : level === 2 ? 15 : 13
      if (y > margin) y += size * 0.4 // a little space before a heading
      writeLines(text, size, 'bold', 1.3, size * 0.35)
    } else if (!text.trim()) {
      y += 12 * 1.5 // blank paragraph = blank line
    } else {
      writeLines(text, 12, 'normal', 1.5, 12 * 0.6)
    }
  }

  // Page numbers, centred in the bottom margin.
  const pages = doc.getNumberOfPages()
  doc.setFont('times', 'normal')
  doc.setFontSize(10)
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.text(String(i), pageW / 2, pageH - margin / 2, { align: 'center' })
  }

  doc.save(`${slug(title)}.pdf`)
}
