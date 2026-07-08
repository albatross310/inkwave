// "Export PDF" → a real, selectable-text A4 PDF, produced ENTIRELY ON THE DEVICE (nothing is uploaded).
//
// How: serialise the live editor's surface (incl. the page-gap widgets ProseMirror has rendered) plus
// the page's own stylesheets into one self-contained HTML document, open it in a new tab, and invoke
// the browser's own print → "Save as PDF". Because it re-uses the EXACT same HTML + CSS (Tailwind +
// index.css, incl. the @media print rules and the seal), the output matches the editor pixel-for-pixel
// — same font, wrapping, page breaks and margins as the on-screen pages. A highly-curated wrapper over
// the browser's native print / print-to-PDF, so the document never leaves the machine.

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

// Inline every same-origin stylesheet's text + any inline <style> blocks, so the server render uses
// the identical CSS the editor is using right now. Cross-origin sheets (Google Fonts) stay a <link>.
async function collectCss(): Promise<string> {
  const hrefs = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
    .map((l) => l.href)
    .filter((h) => h.startsWith(location.origin))
  const fetched = await Promise.all(
    hrefs.map((h) => fetch(h).then((r) => (r.ok ? r.text() : '')).catch(() => '')),
  )
  const inline = Array.from(document.querySelectorAll('style')).map((s) => s.textContent || '').join('\n')
  return fetched.join('\n') + '\n' + inline
}

async function buildPrintHtml(title: string): Promise<string> {
  if (!document.querySelector('.inkwave-editor-surface')) throw new Error('editor not ready')
  const css = await collectCss()
  // Clone the WHOLE body (minus scripts) so the server render has the identical DOM + ancestor layout
  // context that the browser's own print uses — the parchment's width/centering depends on that chain.
  // Anything not meant for print (toolbars, wave background, the sheet panels) is hidden by the
  // @media print rules already in the CSS, exactly as in a normal browser print. The print-seal lives
  // in the body too, so it comes along. Serialising only the surface dropped the context and mis-sized
  // the page (text squashed top-left with huge right/bottom margins).
  const bodyClone = document.body.cloneNode(true) as HTMLElement
  bodyClone
    .querySelectorAll('script,noscript,link[rel="modulepreload"],link[rel="preload"],.inkwave-export-omit')
    .forEach((n) => n.remove())
  // The self-hosted @font-face (from /fonts/inkwave-fonts.css) is already in `css` via collectCss, and
  // its woff2 URLs are same-origin, resolved by <base href>. No external font <link> needed.
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<base href="${location.origin}/">` +
    `<style>${css}</style>` +
    `<title>${escapeHtml(title)}</title>` +
    `</head><body class="${escapeHtml(document.body.className)}">${bodyClone.innerHTML}</body></html>`
  )
}

// Returns true if it opened the print tab; false if the caller should fall back to printing this page.
export async function exportPdfToNewTab(title: string): Promise<boolean> {
  const name = (title || 'inkwave').trim()
  // Build the identical self-contained HTML the render used, but print it ON THIS DEVICE — nothing is
  // sent anywhere. Open the tab SYNCHRONOUSLY (inside the click) so the popup blocker doesn't eat it,
  // then write the document and trigger the browser's print → "Save as PDF". The @media print rules in
  // the inlined CSS format it to A4 with the same fonts/wrapping/page breaks as the on-screen pages.
  let html: string
  try { html = await buildPrintHtml(name) } catch { return false }
  const win = window.open('', '_blank')
  if (!win) return false
  win.document.write(html)
  win.document.close()
  win.focus()
  // Print once the content has laid out (give self-hosted fonts a beat so wrapping is final). Close the
  // tab afterwards where the browser reports it (best-effort; a few browsers never fire onafterprint).
  win.onafterprint = () => { try { win.close() } catch { /* already closed */ } }
  const doPrint = () => { try { win.print() } catch { /* user closed the tab */ } }
  if (win.document.readyState === 'complete') setTimeout(doPrint, 450)
  else win.addEventListener('load', () => setTimeout(doPrint, 450))
  return true
}
