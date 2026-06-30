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
    const body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}')

    // Snapshot diff-summary mode: bullet points of what changed between two snapshots.
    if (typeof body.before === 'string' && typeof body.after === 'string') {
      const before = body.before.slice(0, 1500)
      const after = body.after.slice(0, 1500)
      const bullets = await callClaude(apiKey,
        `List up to 4 bullet points (using - ) describing the EDITING CHANGES made to the document from BEFORE to AFTER. Describe additions, deletions, and restructuring at a high level — e.g. "- 2 new points added", "- Opening rewritten", "- Section on X removed". Do NOT describe what the content is about. Max 10 words per bullet. Output ONLY the bullet list.\n\nBEFORE:\n${before}\n\nAFTER:\n${after}`,
        160,
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
        `List up to 5 bullet points (using - ) describing the high-level EDITORIAL CHANGES between these two versions of a document. Focus on what was added, removed, or restructured — e.g. "- New argument added in section 2", "- Introduction expanded", "- Conclusion removed". Do NOT summarise the content itself. Max 12 words per bullet. Output ONLY the bullet list.\n\nVERSION BEFORE:\n${verBefore}\n\nVERSION AFTER:\n${verAfter}`,
        200,
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
