// Vercel serverless function: paragraph-summary relay. POST a JSON body:
//   { text: string }          → { summary: string }  (single paragraph, 5-10 words)
//   { texts: string[] }       → { summary: string }  (2-3 short paras, groups sep by semicolons)
//   { before: string, after: string }
//                             → { forward: string, backward: string }
//                               forward  = past tense, ≤50 words ("Added a discussion of…")
//                               backward = negative-yet tense ("Hadn't yet added…")
// Calls Claude Sonnet. API key stays server-side; the client only sees the summary text.

import { rateLimit, clientIp } from './_ratelimit.mjs'

const MODEL = 'claude-sonnet-4-6'       // paragraph summaries
const DIFF_MODEL = 'claude-haiku-4-5-20251001'  // diff summaries (cheap, sufficient)
const MAX_TOKENS = 80

async function callClaude(apiKey, prompt, maxTokens = MAX_TOKENS, model = MODEL) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!r.ok) throw new Error(`anthropic ${r.status}`)
  const data = await r.json()
  return data.content?.[0]?.text?.trim() ?? ''
}

// ── Citation extraction (the blog/website path) ───────────────────────────────
// Strip a page's HTML down to candidate text + the meta tags most likely to carry citation data,
// so Haiku sees a compact, high-signal input. Regex-based (no DOM in the serverless runtime).
// Exported for unit testing (the Anthropic call is a thin wrapper; this parsing is the logic).
export function extractCandidate(html) {
  const metas = {}
  // Capture every <meta …> tag as a raw attribute string, then pull key and content out
  // independently — handles both `name="x" content="y"` AND `content="y" name="x"` orderings.
  const tagRe = /<meta\b([^>]*?)>/gi
  const attrKey = /(?:name|property)=["']([^"']+)["']/i
  const attrContent = /content=["']([^"']*)["']/i
  let m
  while ((m = tagRe.exec(html)) && Object.keys(metas).length < 40) {
    const attrs = m[1]
    const km = attrKey.exec(attrs)
    const cm = attrContent.exec(attrs)
    if (!km || !cm) continue
    const key = km[1].toLowerCase()
    if (/title|author|date|published|site_name|description|type|publisher/.test(key)) metas[key] = cm[1]
  }
  const titleTag = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').trim()
  // JSON-LD blocks often carry author/datePublished cleanly.
  const ld = []
  const ldRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  while ((m = ldRe.exec(html)) && ld.length < 3) ld.push(m[1].slice(0, 1200))
  // Visible body text: drop scripts/styles/tags, collapse whitespace, keep the first ~1800 chars.
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1800)
  return { titleTag, metas, ld: ld.join('\n'), body }
}

async function callClaudeJson(apiKey, prompt, maxTokens = 500) {
  const raw = await callClaude(apiKey, prompt, maxTokens, DIFF_MODEL) // Haiku 4.5
  // Be forgiving: pull the first {...} block in case the model adds prose.
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no json')
  return JSON.parse(raw.slice(start, end + 1))
}

// oEmbed providers — deterministic, free, no AI needed for known video platforms.
const OEMBED_PROVIDERS = [
  { pattern: /(?:youtube\.com\/watch\?.*v=|youtu\.be\/)[\w-]{11}/, endpoint: 'https://www.youtube.com/oembed' },
  { pattern: /vimeo\.com\/\d+/, endpoint: 'https://vimeo.com/api/oembed.json' },
]

async function extractViaOEmbed(url) {
  const provider = OEMBED_PROVIDERS.find(p => p.pattern.test(url))
  if (!provider) return null
  try {
    const r = await fetch(`${provider.endpoint}?url=${encodeURIComponent(url)}&format=json`, {
      headers: { accept: 'application/json', 'user-agent': 'InkwaveCitationBot/1.0 (+https://inkwave.me)' },
    })
    if (!r.ok) return null
    const d = await r.json()
    if (!d.title) return null
    return {
      itemType: 'video',
      confidence: 'high',
      fields: {
        ...(d.title       ? { title:     { value: d.title,       quote: null } } : {}),
        ...(d.author_name ? { author:    { value: d.author_name, quote: null } } : {}),
        ...(d.provider_name ? { publisher: { value: d.provider_name, quote: null } } : {}),
      },
    }
  } catch { return null }
}

async function extractCitation(apiKey, url, html) {
  const c = extractCandidate(html)
  const metaLines = Object.entries(c.metas).map(([k, v]) => `${k}: ${v}`).join('\n')
  const prompt =
    `You are extracting bibliographic citation metadata from a web page. Return ONLY a JSON object, no prose.\n` +
    `Shape: {"itemType": one of "blogPost"|"webpage"|"newsArticle"|"article"|"report"|"video",\n` +
    `"confidence": "high"|"low",\n` +
    `"fields": { "title": {"value": string, "quote": string|null}, "author": {"value": string, "quote": string|null},\n` +
    `"date": {"value": "YYYY-MM-DD or YYYY", "quote": string|null}, "publisher": {"value": string, "quote": string|null} }}\n` +
    `Rules: "value" is the best reading; "quote" MUST be a verbatim substring of the PAGE TEXT below where you found it, or null if it came from a meta tag / can't be located verbatim. Omit a field entirely if unknown. Set confidence "low" if the page is not a citable article/post or fields are largely missing.\n\n` +
    `URL: ${url}\nTITLE TAG: ${c.titleTag}\nMETA:\n${metaLines}\nJSON-LD:\n${c.ld}\n\nPAGE TEXT:\n${c.body}`
  return callClaudeJson(apiKey, prompt, 500)
}

function buildPrompt(body) {
  if (Array.isArray(body.texts) && body.texts.length > 0) {
    const items = body.texts.map((t, i) => `${i + 1}. ${t.slice(0, 800)}`).join('\n')
    return `Summarise each of these ${body.texts.length} short paragraphs in 5-10 words each, separated by semicolons. Output ONLY the summaries, nothing else.\n\n${items}`
  }
  const text = String(body.text || '').slice(0, 1200)
  return `Summarise this paragraph in 5-10 words. Output ONLY the summary, nothing else.\n\n${text}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed') }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) { res.statusCode = 503; return res.end(JSON.stringify({ error: 'summarise unavailable' })) }

  const rl = await rateLimit(clientIp(req), 'summarise', 60, 60)
  if (!rl.ok) { res.statusCode = 429; return res.end(JSON.stringify({ error: 'rate limited' })) }

  try {
    // Vercel pre-parses req.body for JSON content-type; the Vite dev webhook wrapper does not.
    const body = typeof req.body === 'object' && req.body
      ? req.body
      : JSON.parse(await new Promise((resolve, reject) => {
          let s = ''; req.on('data', c => { s += c }); req.on('end', () => resolve(s)); req.on('error', reject)
        }).then(s => s || '{}').catch(() => '{}'))

    // Citation extraction mode: { extract: { url, html? } } → { itemType, fields, confidence }.
    // If html isn't supplied (PWA paste-URL path) the server fetches the page — no CORS problem,
    // and the page's text never touches the client until the citation is returned.
    if (body.extract && typeof body.extract === 'object') {
      const { url, html } = body.extract
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        res.statusCode = 400; return res.end(JSON.stringify({ error: 'extract needs a url' }))
      }
      res.setHeader('content-type', 'application/json')
      try {
        // Try oEmbed first for known video platforms — deterministic, no tokens used.
        const oembed = await extractViaOEmbed(url)
        if (oembed) return res.end(JSON.stringify(oembed))

        let pageHtml = typeof html === 'string' ? html : ''
        if (!pageHtml) {
          const pr = await fetch(url, { headers: { 'user-agent': 'InkwaveCitationBot/1.0 (+https://inkwave.me)', accept: 'text/html' }, redirect: 'follow' })
          if (!pr.ok) { res.statusCode = 502; return res.end(JSON.stringify({ error: `page fetch failed (${pr.status})` })) }
          pageHtml = (await pr.text()).slice(0, 400_000)
        }
        const result = await extractCitation(apiKey, url, pageHtml)
        return res.end(JSON.stringify(result))
      } catch (extractErr) {
        res.statusCode = 502
        return res.end(JSON.stringify({ error: String(extractErr?.message || extractErr) }))
      }
    }

    // Snapshot diff-summary mode: bullet points of what changed between two snapshots.
    if (typeof body.before === 'string' && typeof body.after === 'string') {
      const before = body.before.slice(0, 1500)
      const after = body.after.slice(0, 1500)
      const bullets = await callClaude(apiKey,
        `List up to 3 bullet points (using - ) describing the EDITING CHANGES made to the document from BEFORE to AFTER. Describe additions, deletions, and restructuring at a high level — e.g. "- 2 new points added", "- Opening rewritten", "- Section on X removed". Do NOT describe what the content is about. Use telegraphic style: omit articles (a, an, the) and conjunctions where meaning is clear. Max 50 words total. Output ONLY the bullet list.\n\nBEFORE:\n${before}\n\nAFTER:\n${after}`,
        80,
        DIFF_MODEL,
      )
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify({ bullets }))
    }

    // Version diff-summary mode: bullet points comparing two full versions.
    if (typeof body.verBefore === 'string' && typeof body.verAfter === 'string') {
      const verBefore = body.verBefore.slice(0, 2000)
      const verAfter = body.verAfter.slice(0, 2000)
      const versionBullets = await callClaude(apiKey,
        `List up to 4 bullet points (using - ) describing the high-level EDITORIAL CHANGES between these two versions of a document. Focus on what was added, removed, or restructured — e.g. "- New argument added in section 2", "- Introduction expanded", "- Conclusion removed". Do NOT summarise the content itself. Use telegraphic style: omit articles (a, an, the) where meaning is clear. Max 50 words total. Output ONLY the bullet list.\n\nVERSION BEFORE:\n${verBefore}\n\nVERSION AFTER:\n${verAfter}`,
        90,
        DIFF_MODEL,
      )
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify({ versionBullets }))
    }

    const prompt = buildPrompt(body)
    const summary = await callClaude(apiKey, prompt)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ summary }))
  } catch (err) {
    res.statusCode = 502
    res.end(JSON.stringify({ error: 'summarise failed' }))
  }
}
