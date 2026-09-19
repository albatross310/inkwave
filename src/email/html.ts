// Convert the live Tiptap HTML into an inert, email-safe fragment. This is outbound-only: it never
// renders remote HTML. Unknown application nodes are flattened to their visible text, and only the
// small formatting vocabulary exposed by StyleBar survives.

const TAGS = new Map([
  ['P', 'p'], ['BR', 'br'], ['STRONG', 'strong'], ['B', 'strong'], ['EM', 'em'], ['I', 'em'],
  ['U', 'u'], ['S', 's'], ['STRIKE', 's'], ['UL', 'ul'], ['OL', 'ol'], ['LI', 'li'],
  ['BLOCKQUOTE', 'blockquote'], ['H1', 'h1'], ['H2', 'h2'], ['H3', 'h3'], ['A', 'a'],
  ['SPAN', 'span'], ['MARK', 'span'],
])

const STYLE_PROPERTIES = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration',
  'color', 'background-color', 'text-align', 'line-height',
  'margin-top', 'margin-bottom', 'padding-left', 'padding-right', 'text-indent', 'list-style-type',
] as const

function safeStyleValue(value: string): boolean {
  return !!value && !/url\s*\(|expression\s*\(|@import|javascript:/i.test(value)
}

function safeHref(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value, 'https://inkwave.invalid')
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? value : null
  } catch { return null }
}

export function emailHtmlFromEditor(source: string): string {
  if (typeof DOMParser === 'undefined') return ''
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  const output = document.implementation.createHTMLDocument('')

  const copy = (node: Node): Node => {
    if (node.nodeType === Node.TEXT_NODE) return output.createTextNode(node.textContent ?? '')
    if (!(node instanceof Element)) return output.createDocumentFragment()
    const tag = TAGS.get(node.tagName)
    const target = tag ? output.createElement(tag) : output.createDocumentFragment()

    if (target instanceof HTMLElement) {
      if (node.tagName === 'LI' && node.hasAttribute('data-checked')) {
        target.appendChild(output.createTextNode(node.getAttribute('data-checked') === 'true' ? '☑ ' : '☐ '))
      }
      for (const property of STYLE_PROPERTIES) {
        const value = (node as HTMLElement).style.getPropertyValue(property)
        if (safeStyleValue(value)) target.style.setProperty(property, value)
      }
      if (node.tagName === 'MARK') {
        const color = (node as HTMLElement).style.backgroundColor || node.getAttribute('data-color') || ''
        if (safeStyleValue(color)) target.style.backgroundColor = color
      }
      if (node.tagName === 'A') {
        const href = safeHref(node.getAttribute('href'))
        if (href) {
          target.setAttribute('href', href)
          target.setAttribute('rel', 'noopener noreferrer')
        }
      }
      if (node.tagName === 'OL') {
        const start = Number(node.getAttribute('start'))
        if (Number.isInteger(start) && start > 1) target.setAttribute('start', String(start))
      }
    }

    for (const child of [...node.childNodes]) target.appendChild(copy(child))
    return target
  }

  for (const child of [...parsed.body.childNodes]) output.body.appendChild(copy(child))
  return output.body.innerHTML
}

/**
 * Gmail draft reconciliation currently hashes and compares the provider's plain-text body. Until
 * that model also owns the HTML alternative, a caller must not quietly flatten StyleBar marks.
 * Bare paragraphs and line breaks are Tiptap structure rather than writer-applied formatting.
 */
export function emailHtmlHasFormatting(source: string | undefined): boolean {
  if (!source || typeof DOMParser === 'undefined') return false
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  return [...parsed.body.querySelectorAll('*')].some((element) =>
    !['P', 'BR'].includes(element.tagName) || element.hasAttribute('style'))
}
