// Client-side wrapper for /api/summarise. Fire-and-forget — callers should .catch(() => {}).
// The server holds the Anthropic key; we only send paragraph text, never the full document.

async function callSummarise(body: Record<string, unknown>): Promise<string> {
  const r = await fetch('/api/summarise', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`summarise ${r.status}`)
  const { summary } = await r.json() as { summary: string }
  return summary || ''
}

export function summariseParagraph(text: string): Promise<string> {
  return callSummarise({ text })
}

export function summariseBullets(texts: string[]): Promise<string> {
  return callSummarise({ texts })
}
