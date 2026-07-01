// Lazy-load CSL style strings.
// We only bundle APA; other styles are fetched from the CDN at runtime to keep the bundle small.
// citation-js registers them via plugins.csl.add().

const CSL_CDN = 'https://cdn.jsdelivr.net/gh/citation-style-language/styles@master'

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

const loaded = new Set<string>()

export async function ensureStyle(styleId: string): Promise<void> {
  if (loaded.has(styleId)) return
  if (styleId === 'apa') {
    // APA is bundled in @citation-js/plugin-csl — just registering the plugin is enough.
    await ensureCslPlugin()
    loaded.add(styleId)
    return
  }
  await ensureCslPlugin()
  const { plugins } = await import('@citation-js/core')
  const res = await fetch(`${CSL_CDN}/${styleId}.csl`)
  if (!res.ok) throw new Error(`Failed to load CSL style ${styleId}`)
  const xml = await res.text()
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
  ;(plugins as any).config.get('@csl').templates.add(styleId, xml)
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
