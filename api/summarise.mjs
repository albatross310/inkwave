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

    // Diff-summary mode: two Claude calls in parallel, forward and backward.
    if (typeof body.before === 'string' && typeof body.after === 'string') {
      const before = body.before.slice(0, 1500)
      const after = body.after.slice(0, 1500)
      const [forward, backward] = await Promise.all([
        callClaude(apiKey,
          `In max 50 words, describe in past tense what changed going from the BEFORE text to the AFTER text. Focus on content added or changed. Start with a verb, e.g. "Added…". Output ONLY the description.\n\nBEFORE:\n${before}\n\nAFTER:\n${after}`,
          120,
          DIFF_MODEL,
        ),
        callClaude(apiKey,
          `In max 50 words, describe what hadn't happened yet in the BEFORE text compared to the AFTER text. Use the "hadn't yet" / "not yet" tense. Start with "Hadn't". Output ONLY the description.\n\nBEFORE:\n${before}\n\nAFTER:\n${after}`,
          120,
          DIFF_MODEL,
        ),
      ])
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify({ forward, backward }))
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
