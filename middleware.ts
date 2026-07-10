// Vercel Edge Middleware — per-request CSP nonce (audit F6).
//
// The app is a static, prerendered SPA (ssr:false), so there's no per-request server to mint a CSP
// nonce. This edge layer does it instead: for every HTML document it injects a fresh nonce into each
// <script> tag and sets a strict `script-src` (NO 'unsafe-inline') carrying that nonce + 'strict-dynamic'.
// 'strict-dynamic' means scripts loaded BY a trusted (nonce'd) script are themselves trusted — that's
// how Clerk/Stripe keep working (the recon showed they inject only via createElement, never inline).
// Non-HTML responses (assets, fonts, /api JSON) pass straight through untouched.
//
// Why this and not hashes: React Router's hydration scripts embed build- and route-specific data, so
// their hashes change every build/page — a per-request nonce is the stable mechanism.

const NONCE_BYTES = 16

// The full policy, parameterised by the request's nonce. Mirrors the directives previously in
// vercel.json, with script-src switched from 'unsafe-inline' to nonce + strict-dynamic. style-src
// keeps 'unsafe-inline' — React's style={} inline-style ATTRIBUTES can't carry a nonce (nonces apply
// only to <style>/<script> elements), and there are no style-based injection sinks.
function csp(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    // 'wasm-unsafe-eval' lets pdf.js instantiate its JBIG2/JPEG2000 WebAssembly decoders (scanned PDFs).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval' https:`,
    // clerk.iwzero.me / clerk.inkwave.studio: the PRODUCTION Clerk instance's frontend API lives on
    // a first-party subdomain of the app's own domain (pk_live keys encode it), NOT *.clerk.accounts.dev
    // — that wildcard only covers dev instances. Omitting it blocked every sign-in POST in production
    // and Clerk's modal reset to "Continue" with no visible error (2026-07-10 incident, all browsers).
    "connect-src 'self' https://clerk.iwzero.me https://clerk.inkwave.studio https://api.stripe.com https://m.stripe.com https://m.stripe.network https://r.stripe.com https://q.stripe.com https://accounts.google.com https://apis.google.com https://www.googleapis.com https://content.googleapis.com https://www.gstatic.com https://*.clerk.accounts.dev https://*.clerk.com https://clerk-telemetry.com https://api.datamuse.com https://mempool.space https://blockstream.info https://login.microsoftonline.com https://graph.microsoft.com https://fonts.googleapis.com https://fonts.gstatic.com https://api.crossref.org https://export.arxiv.org https://eutils.ncbi.nlm.nih.gov https://openlibrary.org",
    "img-src 'self' data: https:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    // blob: — the embedded-source PDF viewer frames a blob: URL of the OPFS-stored PDF (same-origin,
    // created by our own code) in the citation side panel.
    "frame-src 'self' blob: https://js.stripe.com https://hooks.stripe.com https://m.stripe.network https://accounts.google.com https://content.googleapis.com https://docs.google.com https://drive.google.com https://clerk.iwzero.me https://clerk.inkwave.studio https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com https://login.microsoftonline.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; ')
}

// Only HTML navigations — exclude API, hashed assets, fonts, icons, and any file with an extension.
export const config = {
  matcher: ['/((?!api/|assets/|fonts/|icons/|.*\\.[a-zA-Z0-9]+$).*)'],
}

export default async function middleware(request: Request): Promise<Response> {
  const res = await fetch(request) // subrequest does NOT re-enter middleware
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('text/html')) return res

  const bytes = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const nonce = btoa(String.fromCharCode(...bytes)).replace(/[^a-zA-Z0-9]/g, '')

  // Add the nonce to every <script> (inline + module). Harmless on external <script src>. RR escapes
  // '<' inside serialized hydration data, so "<script" only ever appears as a real tag.
  const html = (await res.text()).replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`)

  const headers = new Headers(res.headers)
  headers.set('Content-Security-Policy', csp(nonce))
  headers.delete('Content-Security-Policy-Report-Only')
  headers.delete('content-length') // body length changed
  return new Response(html, { status: res.status, statusText: res.statusText, headers })
}
