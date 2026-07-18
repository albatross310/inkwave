// CSL style registration — the four non-APA styles are BUNDLED (vendored `.csl` XML), not fetched.
//
// WHY BUNDLED, NOT A CDN FETCH (2026-07-18). The previous version lazy-loaded Chicago / MLA /
// Vancouver / Harvard from `cdn.jsdelivr.net` at runtime. That host was never in `middleware.ts`'s
// CSP `connect-src` (`default-src 'self'`), and that CSP is a Vercel EDGE middleware — `pnpm dev`
// and `pnpm test` never run it, so the fetch worked on every dev machine and in every test and was
// BLOCKED only in production. A blocked fetch threw in `ensureStyle`, `bibFormat.ts` caught it and
// fell back to plain author-year text, and a writer who picked Vancouver silently got a plain list.
// Bundling makes the failure impossible rather than merely allowed — no network, so no host to list,
// matching every prior call in this repo (minimal connect-src, URL-PDFs removed, privacy-first).
//
// LAZY, NOT MAIN-ENTRY. Each style is a dynamic `import('./csl/<id>.csl?raw')`, so Vite splits it
// into its OWN chunk fetched from our origin only when that style is first selected. APA and
// Vancouver are ALSO carried by `@citation-js/plugin-csl` itself, but we register vendored copies so
// each declared id maps to a definite, self-contained CSL definition rather than to whatever the
// plugin version happens to bundle (a plugin bump dropping a style would otherwise silently fall the
// selection back to APA — the same class of quiet degrade this change removes).
//
// LICENSING: the vendored `.csl` files are CC-BY-SA 3.0 (citation-style-language/styles). Each file
// keeps its own `<info><rights>` attribution header verbatim — do not strip it.

import { plugins } from '@citation-js/core'

export interface CslStyle {
  id: string
  label: string
}

export const CSL_STYLES: CslStyle[] = [
  { id: 'apa',                  label: 'APA 7th' },
  { id: 'chicago-author-date',  label: 'Chicago (author-date)' },
  { id: 'modern-language-association', label: 'MLA 9th' },
  { id: 'vancouver',            label: 'Vancouver' },
  { id: 'harvard-cite-them-right', label: 'Harvard' },
]

// Each loader is its own lazy chunk (`?raw` → the XML as a string). Registering a style is
// idempotent, so loading once per session is enough; APA needs no entry (the plugin bundles it).
const STYLE_LOADERS: Record<string, () => Promise<string>> = {
  'chicago-author-date':         () => import('./csl/chicago-author-date.csl?raw').then(m => m.default),
  'modern-language-association': () => import('./csl/modern-language-association.csl?raw').then(m => m.default),
  'vancouver':                   () => import('./csl/vancouver.csl?raw').then(m => m.default),
  'harvard-cite-them-right':     () => import('./csl/harvard-cite-them-right.csl?raw').then(m => m.default),
}

const loaded = new Set<string>()

export async function ensureStyle(styleId: string): Promise<void> {
  if (loaded.has(styleId)) return
  await ensureCslPlugin()
  if (styleId === 'apa') {
    // APA is bundled in @citation-js/plugin-csl — registering the plugin is enough.
    loaded.add(styleId)
    return
  }
  const load = STYLE_LOADERS[styleId]
  if (!load) {
    // Unknown id: don't fetch, don't throw. The CSL engine falls back to APA for an unregistered
    // template, which is a benign default (and no id outside CSL_STYLES ever reaches here in-app).
    loaded.add(styleId)
    return
  }
  const xml = await load()
  plugins.config.get('@csl').templates.add(styleId, xml)
  loaded.add(styleId)
}

let cslPluginPromise: Promise<void> | null = null

async function ensureCslPlugin(): Promise<void> {
  if (cslPluginPromise) return cslPluginPromise
  cslPluginPromise = (async () => {
    await import('@citation-js/plugin-csl')
  })()
  return cslPluginPromise
}
