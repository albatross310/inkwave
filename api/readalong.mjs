/** ElevenLabs relay. No manuscript/key logging, no automatic paid retries, no public shared key. */
import { createHash, timingSafeEqual } from 'node:crypto';
const MODELS = new Set(['eleven_v3', 'eleven_multilingual_v2']);
const active = new Set();
const MAX_BODY = 20_000;
const MAX_RESPONSE = 3_900_000;
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export function allowedOrigin(origin, env = process.env) {
  const allowed = new Set(['https://iwzero.me', 'https://www.iwzero.me', 'https://inkwave.studio', 'https://www.inkwave.studio', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8787', 'http://127.0.0.1:8787']);
  for (const item of (env.READALONG_ALLOWED_ORIGINS || '').split(',')) if (item.trim()) allowed.add(item.trim());
  if (env.VERCEL_URL) allowed.add(`https://${env.VERCEL_URL}`);
  if (env.VERCEL_BRANCH_URL) allowed.add(`https://${env.VERCEL_BRANCH_URL}`);
  return typeof origin === 'string' && allowed.has(origin);
}
export function resolveKey(headers, env = process.env) {
  const supplied = headers['x-elevenlabs-key'];
  if (typeof supplied === 'string' && /^[\x21-\x7e]{8,512}$/.test(supplied)) return supplied;
  // Optional private, shared-account mode. Fail closed unless a strong access secret exists.
  const expected = env.READALONG_ACCESS_TOKEN;
  const token = headers['x-readalong-access'];
  if (env.ELEVENLABS_API_KEY && typeof expected === 'string' && expected.length >= 32 && typeof token === 'string' && token.length <= 512) {
    const a = createHash('sha256').update(expected).digest(), b = createHash('sha256').update(token).digest();
    if (timingSafeEqual(a, b)) return env.ELEVENLABS_API_KEY;
  }
  throw new HttpError(401, 'Connect your ElevenLabs API key, or enter the private reader access token. Credentials are not saved in the browser.');
}
export function validateInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected a JSON object.');
  if (body.action === 'voices') {
    if (body.cursor != null && (typeof body.cursor !== 'string' || body.cursor.length > 1000)) throw new HttpError(400, 'Invalid voice page.');
    return { action: 'voices', cursor: body.cursor || '' };
  }
  if (body.action !== 'render') throw new HttpError(400, 'Unknown reader action.');
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 1400 || /\0|[\x01-\x08\x0e-\x1f]/.test(body.text)) throw new HttpError(400, 'A render chunk must contain 1–1,400 text characters.');
  if (typeof body.voiceId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(body.voiceId)) throw new HttpError(400, 'Invalid voice ID.');
  if (!MODELS.has(body.model) || !['steady', 'natural'].includes(body.delivery)) throw new HttpError(400, 'Unsupported narration settings.');
  const voice_settings = body.model === 'eleven_v3'
    ? { stability: body.delivery === 'natural' ? 0.5 : 1, similarity_boost: 0.75, speed: 1 }
    : { stability: body.delivery === 'natural' ? 0.55 : 0.75, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 };
  return { action: 'render', voiceId: body.voiceId, payload: { text: body.text, model_id: body.model, voice_settings } };
}
async function readBody(req) {
  if (Number(req.headers['content-length'] || 0) > MAX_BODY) throw new HttpError(413, 'Request is too large.');
  if (req.body != null) {
    const raw = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
    if (Buffer.byteLength(raw) > MAX_BODY) throw new HttpError(413, 'Request is too large.');
    try { return JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON.'); }
  }
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw new HttpError(413, 'Request is too large.'); chunks.push(Buffer.from(chunk)); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON.'); }
}
async function limitedJson(response) {
  if (Number(response.headers.get('content-length') || 0) > MAX_RESPONSE) throw new HttpError(502, 'The audio response was too large. No automatic retry was made. The request may have been charged.');
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(502, 'The speech provider returned an empty response.');
  let size = 0; const parts = [];
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > MAX_RESPONSE) { await reader.cancel(); throw new HttpError(502, 'The provider response exceeded the safety limit. The request may have been charged.'); }
    parts.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new HttpError(502, 'The provider returned unreadable data. The request may have been charged.'); }
}
export async function relay(input, key, fetcher = fetch) {
  let url = 'https://api.elevenlabs.io/v2/voices?page_size=100';
  const headers = { 'xi-api-key': key, 'Content-Type': 'application/json' };
  let init = { headers, signal: AbortSignal.timeout(180_000), redirect: 'error' };
  if (input.action === 'voices') { if (input.cursor) url += `&next_page_token=${encodeURIComponent(input.cursor)}`; }
  else { url = `https://api.elevenlabs.io/v1/text-to-speech/${input.voiceId}/with-timestamps?output_format=mp3_44100_128`; init = { ...init, method: 'POST', body: JSON.stringify(input.payload) }; }
  const response = await fetcher(url, init);
  if (!response.ok) {
    await response.body?.cancel();
    const status = response.status;
    const messages = {
      401: 'ElevenLabs rejected the API key. Check its permissions.',
      402: 'ElevenLabs requires more credits or a different plan.',
      403: 'ElevenLabs denied access to this voice or model. Choose a voice available to your account.',
      404: 'That voice was not found. Choose another voice.',
      422: 'ElevenLabs rejected this voice/model combination or its settings. Try another voice or Multilingual v2.',
      429: 'ElevenLabs is rate-limiting requests. Rendering paused; retry explicitly later.',
    };
    throw new HttpError(status >= 500 ? 502 : status, messages[status] || `ElevenLabs returned status ${status}. No automatic retry was made.`);
  }
  const data = await limitedJson(response);
  if (input.action === 'voices') {
    if (!Array.isArray(data.voices)) throw new HttpError(502, 'The provider returned an invalid voice list.');
    return { voices: data.voices.map(v => ({ voice_id: v.voice_id, name: v.name, labels: v.labels || {}, description: v.description || '' })), has_more: !!data.has_more, next_page_token: data.next_page_token || null };
  }
  if (typeof data.audio_base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.audio_base64)) throw new HttpError(502, 'The provider did not return a valid recording. The request may have been charged.');
  return { audio_base64: data.audio_base64, alignment: data.alignment ?? null, mime: 'audio/mpeg', requestId: response.headers.get('request-id') || response.headers.get('x-request-id') || null };
}
function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(data));
}
export default async function handler(req, res) {
  let lock;
  try {
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw new HttpError(405, 'Use POST.'); }
    if (!allowedOrigin(req.headers.origin)) throw new HttpError(403, 'This reader origin is not allowed. Configure READALONG_ALLOWED_ORIGINS for a new deployment.');
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
    const key = resolveKey(req.headers);
    const input = validateInput(await readBody(req));
    lock = createHash('sha256').update(key).digest('hex');
    if (active.has(lock)) { lock = undefined; throw new HttpError(429, 'Another request on this account is running. Try again after it finishes.'); }
    active.add(lock);
    send(res, 200, await relay(input, key));
  } catch (error) {
    send(res, error instanceof HttpError ? error.status : 502, { error: error instanceof HttpError ? error.message : 'The speech request failed or timed out. It may already have been charged. No automatic retry was made; completed recordings remain saved.' });
  } finally { if (lock) active.delete(lock); }
}
