// "Export PDF" → a real, selectable-text A4 PDF opened in a NEW TAB, with no print dialog.
//
// How: serialise the live editor's surface (incl. the page-gap widgets ProseMirror has rendered) plus
// the page's own stylesheets into one self-contained HTML document, POST it to /api/pdf (headless
// Chromium), and open the returned PDF blob in a new tab. Because the server re-uses the EXACT same
// HTML + CSS (Tailwind + index.css, incl. the @media print rules and the seal), the output matches
// the editor pixel-for-pixel — same font, wrapping, page breaks and margins as the on-screen pages.
//
// Works in every visitor browser (the render is server-side). If the route is unavailable (e.g. local
// dev with no Chrome), the caller falls back to the browser print dialog.

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

// The placeholder shown in the new tab while Chromium renders: the Inkwave logo + a 5→0 countdown
// (no spinner). When the PDF arrives the tab navigates to it; if it overruns the countdown holds at ✓.
// `origin` is injected so the logo (and any URL) is absolute — the tab is about:blank with no base.
function loadingDoc(origin: string): string {
  return (
    '<!doctype html><meta charset="utf-8"><title>Preparing PDF…</title>' +
    '<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;' +
    "font-family:'EB Garamond',Georgia,serif;background:#FBF5EC;color:#5c2d8a}" +
    '.box{text-align:center}.box img{width:96px;height:96px;display:block;margin:0 auto 16px}' +
    '.n{font-size:46px;line-height:1;font-variant-numeric:tabular-nums}' +
    '.cap{margin-top:10px;font-size:15px;color:#9b5ccc}</style>' +
    `<div class="box"><img src="${origin}/icon-192.png" alt="Inkwave">` +
    '<div class="n" id="n">5</div><div class="cap">Preparing your PDF…</div></div>' +
    '<script>(function(){var n=5,e=document.getElementById("n");' +
    'var t=setInterval(function(){n-=1;if(n<=0){e.textContent="\\u2713";clearInterval(t);}else{e.textContent=String(n);}},1000);})();</script>'
  )
}

// Returns true if it produced the PDF; false if the caller should fall back to the print dialog.
export async function exportPdfToNewTab(title: string): Promise<boolean> {
  const name = (title || 'inkwave').trim()
  // Open the tab SYNCHRONOUSLY inside the click gesture, or the popup blocker eats it. We navigate it
  // to the PDF once it's ready (and close it on failure so the fallback dialog isn't doubled up).
  const win = window.open('', '_blank')
  if (win) { try { win.document.write(loadingDoc(location.origin)); win.document.close() } catch { /* ignore */ } }
  // Never hang the loading tab: abort after 45s and fall back to the print dialog.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45_000)
  try {
    const html = await buildPrintHtml(name)
    const res = await fetch('/api/pdf', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html, title: name }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`pdf route ${res.status}`)
    const blob = await res.blob()
    if (blob.type !== 'application/pdf') throw new Error('not a pdf')
    const url = URL.createObjectURL(blob)
    if (win) win.location.href = url
    else window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60_000) // let the new tab load it first
    return true
  } catch {
    if (win) { try { win.close() } catch { /* ignore */ } }
    return false
  }
}
