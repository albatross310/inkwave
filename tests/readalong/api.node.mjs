import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { allowedOrigin, resolveKey, validateInput, relay } from '../../api/readalong.mjs';
const render = { action: 'render', voiceId: 'testvoice1234', model: 'eleven_v3', delivery: 'steady', text: 'An ordinary sentence.' };
test('same-origin allowlist denies missing/null/spoofed origins', () => {
  assert.equal(allowedOrigin('https://inkwave.studio'), true);
  assert.equal(allowedOrigin('https://iwzero.me', {}), true);
  assert.equal(allowedOrigin('https://www.iwzero.me', {}), true);
  for (const origin of [undefined, 'null', 'https://inkwave.studio.attacker.test', 'https://iwzero.me.attacker.test', 'https://evil.test']) assert.equal(allowedOrigin(origin), false);
  assert.equal(allowedOrigin('https://preview.vercel.app', { VERCEL_URL: 'preview.vercel.app' }), true);
});
test('unconfigured shared key is never public', () => {
  assert.throws(() => resolveKey({}, { ELEVENLABS_API_KEY: 'secret' }));
  assert.throws(() => resolveKey({ 'x-readalong-access': 'tiny' }, { ELEVENLABS_API_KEY: 'secret', READALONG_ACCESS_TOKEN: 'tiny' }));
  assert.equal(resolveKey({ 'x-elevenlabs-key': 'my-long-key' }, {}), 'my-long-key');
  const token = 'x'.repeat(40), env = { ELEVENLABS_API_KEY: 'server-secret', READALONG_ACCESS_TOKEN: token };
  assert.equal(resolveKey({ 'x-readalong-access': token }, env), 'server-secret');
  assert.throws(() => resolveKey({ 'x-readalong-access': 'y'.repeat(40) }, env));
});
test('fixed host / request schema rejects path injection and oversized text', () => {
  for (const body of [null, [], {}, { ...render, voiceId: '../foo' }, { ...render, model: 'arbitrary' }, { ...render, text: 'x'.repeat(1401) }, { ...render, text: '\0x' }, { action: 'voices', cursor: [] }]) assert.throws(() => validateInput(body));
  const valid = validateInput({ ...render, url: 'https://evil.test', secret: 'no' });
  assert.deepEqual(Object.keys(valid.payload).sort(), ['model_id', 'text', 'voice_settings']);
});
test('render relay forwards exact text and never inserts directions', async () => {
  let calls = 0;
  const data = await relay(validateInput(render), 'test-api-key', async (url, init) => {
    calls++; assert.equal(url, 'https://api.elevenlabs.io/v1/text-to-speech/testvoice1234/with-timestamps?output_format=mp3_44100_128');
    assert.equal(init.headers['xi-api-key'], 'test-api-key'); assert.equal(JSON.parse(init.body).text, render.text); assert.equal(init.redirect, 'error');
    return new Response(JSON.stringify({ audio_base64: 'YWJj', alignment: null }), { status: 200, headers: { 'request-id': 'request-1' } });
  });
  assert.equal(calls, 1); assert.equal(data.requestId, 'request-1');
});
test('rate limiting and provider failure are not automatically retried or echoed', async () => {
  let calls = 0;
  await assert.rejects(relay(validateInput(render), 'secret', async () => { calls++; return new Response('secret-private-manuscript', { status: 429 }); }), /rate-limiting/);
  assert.equal(calls, 1);
});
test('voice pagination is requested and returned, not silently dropped', async () => {
  const out = await relay(validateInput({ action: 'voices', cursor: 'a&b' }), 'test-api-key', async url => {
    assert.match(url, /next_page_token=a%26b/);
    return Response.json({ voices: [{ voice_id: 'one', name: 'Test', labels: { accent: 'australian' }, private_data: 'redact' }], has_more: true, next_page_token: 'next' });
  });
  assert.equal(out.next_page_token, 'next'); assert.equal(out.voices[0].private_data, undefined);
});
test('handler rejects unauthenticated / cross-origin requests before upstream', async () => {
  async function invoke(req) { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = JSON.parse(body); } }; await handler(req, res); return res; }
  assert.equal((await invoke({ method: 'GET', headers: {} })).statusCode, 405);
  assert.equal((await invoke({ method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' } })).statusCode, 403);
  const res = await invoke({ method: 'POST', headers: { origin: 'https://inkwave.studio', 'content-type': 'application/json' } });
  assert.equal(res.statusCode, 401); assert.equal(res.headers['Cache-Control'], 'private, no-store');
});
