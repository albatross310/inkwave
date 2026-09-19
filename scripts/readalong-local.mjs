/** Local-development relay only; never deployed as a paid/public server function. */
import { Worker } from 'node:worker_threads';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { LOCAL_VOICES, validateLocal } from '../tools/readalong-local/speech.mjs';
let worker, busy = false;
export function localOrigin(req) {
  let origin;
  try { origin = new URL(req.headers.origin); } catch { return false; }
  const loopback = value => ['localhost', '127.0.0.1', '[::1]'].includes(value);
  return loopback(origin.hostname) && ['http:', 'https:'].includes(origin.protocol)
    && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
}
function send(res, status, data) {
  res.statusCode = status; res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(data));
}
export async function generateLocal(input) {
  validateLocal(input);
  if (busy) throw new Error('Another local passage is rendering. Let it finish first.');
  busy = true;
  try {
    try {
      await access(new URL('../tools/readalong-local/models/kokoro-v1.0/onnx/model_quantized.onnx', import.meta.url));
      await access(new URL('../tools/readalong-local/node_modules/kokoro-js', import.meta.url));
    } catch { throw new Error('Local speech needs its one-time setup. Run pnpm setup:readalong-local, then try again.'); }
    if (!worker) { worker = new Worker(new URL('../tools/readalong-local/worker.mjs', import.meta.url), { execArgv: [] }); worker.unref(); }
    const current = worker, id = randomUUID();
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { void current.terminate(); if (worker === current) worker = null; finish(new Error('Local rendering timed out. Shorten this passage and retry.')); }, 590_000);
      const done = message => { if (message.id === id) finish(message.error ? new Error(message.error) : null, message.result); };
      const failed = () => { if (worker === current) worker = null; finish(new Error('Local speech could not start. Run pnpm setup:readalong-local and try again.')); };
      function finish(error, result) { clearTimeout(timer); current.off('message', done); current.off('error', failed); current.off('exit', failed); error ? reject(error) : resolve(result); }
      current.on('message', done); current.once('error', failed); current.once('exit', failed);
      current.postMessage({ id, text: input.text, voiceId: input.voiceId });
    });
  } finally { busy = false; }
}
export async function stopLocalWorker() { const previous = worker; worker = null; if (previous) await previous.terminate(); }
export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
  if (!localOrigin(req)) return send(res, 403, { error: 'Local speech is available only from a browser on this computer.' });
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, { error: 'Use application/json.' });
  try {
    let size = 0; const parts = [];
    for await (const part of req) { size += part.length; if (size > 20_000) return send(res, 413, { error: 'Reader request too large.' }); parts.push(part); }
    let body;
    try { body = validateLocal(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch (error) { return send(res, 400, { error: error.message }); }
    if (body.action === 'voices') return send(res, 200, { voices: LOCAL_VOICES.map(v => ({ voice_id: `kokoro_${v.id}`, name: `${v.name} · ${v.accent}`, labels: { accent: v.accent.toLowerCase(), gender: v.gender }, description: 'Local Kokoro voice. Runs on your CPU; no API key or usage fee.' })), has_more: false });
    if (busy) return send(res, 429, { error: 'Another local passage is rendering. Let it finish first.' });
    send(res, 200, await generateLocal(body));
  } catch { send(res, 503, { error: 'Local speech could not finish. Check the local setup and try a shorter passage; no paid request was made.' }); }
}
