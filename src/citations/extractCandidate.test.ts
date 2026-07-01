import { describe, it, expect } from 'vitest'
import { extractCandidate } from '../../api/summarise.mjs'

const HTML = `
<!doctype html><html><head>
  <title>How Attention Works — A Blog</title>
  <meta property="og:title" content="How Attention Works">
  <meta name="author" content="Jane Smith">
  <meta property="article:published_time" content="2024-03-15">
  <meta property="og:site_name" content="The Deep Learning Blog">
  <script>var tracking = 1; console.log('noise')</script>
  <style>.x{color:red}</style>
  <script type="application/ld+json">{"@type":"Article","author":{"name":"Jane Smith"},"datePublished":"2024-03-15"}</script>
</head><body>
  <h1>How Attention Works</h1>
  <p>Written by Jane Smith on March 15, 2024. This post explains the attention mechanism in transformers.</p>
</body></html>`

describe('extractCandidate (server-side page scraping)', () => {
  const c = extractCandidate(HTML)

  it('pulls the <title>', () => {
    expect(c.titleTag).toBe('How Attention Works — A Blog')
  })
  it('captures citation-relevant meta tags only', () => {
    expect(c.metas['og:title']).toBe('How Attention Works')
    expect(c.metas['author']).toBe('Jane Smith')
    expect(c.metas['article:published_time']).toBe('2024-03-15')
    expect(c.metas['og:site_name']).toBe('The Deep Learning Blog')
  })
  it('extracts the JSON-LD block', () => {
    expect(c.ld).toContain('datePublished')
    expect(c.ld).toContain('Jane Smith')
  })
  it('strips scripts/styles/tags from the body text', () => {
    expect(c.body).not.toContain('tracking')
    expect(c.body).not.toContain('color:red')
    expect(c.body).not.toContain('<')
    expect(c.body).toContain('attention mechanism in transformers')
  })
  it('bounds the body length', () => {
    expect(c.body.length).toBeLessThanOrEqual(1800)
  })
  it('handles reversed attribute order (content before name)', () => {
    const reversed = '<html><head><meta content="Bob Jones" name="author"><meta content="2025" property="article:published_time"></head></html>'
    const r = extractCandidate(reversed)
    expect(r.metas['author']).toBe('Bob Jones')
    expect(r.metas['article:published_time']).toBe('2025')
  })
})
