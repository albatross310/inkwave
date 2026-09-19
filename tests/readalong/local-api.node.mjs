import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import handler, { localOrigin } from '../../scripts/readalong-local.mjs';
import { validateLocal, splitSpeech, pcmWav } from '../../tools/readalong-local/speech.mjs';
const request = (origin, address = '127.0.0.1') => ({ headers: { origin }, socket: { remoteAddress: address } });
test('local CPU service requires both loopback browser origin and loopback peer', () => {
  assert.equal(localOrigin(request('http://localhost:5173')), true);
  assert.equal(localOrigin(request('https://evil.example')), false);
  assert.equal(localOrigin(request('http://localhost:5173', '192.168.1.4')), false);
  assert.equal(localOrigin(request('http://localhost.evil.example')), false);
  assert.equal(localOrigin(request(undefined)), false);
});
test('local input bounds never accept a remote model or arbitrary voice path', () => {
  const body = { action: 'render', model: 'kokoro_v1_0', delivery: 'steady', voiceId: 'kokoro_bf_emma', text: 'A line of narration.' };
  assert.equal(validateLocal(body), body);
  for (const patch of [{ model: 'eleven_v3' }, { voiceId: '../../secret' }, { text: 'x'.repeat(601) }]) assert.throws(() => validateLocal({ ...body, ...patch }));
});
test('local speech splitting preserves every source character and never truncates long tokens', () => {
  const text = 'A quiet sentence. '.repeat(30);
  const parts = splitSpeech(text);
  assert.equal(parts.join(''), text);
  assert.ok(parts.every(part => part.length <= 180));
  assert.throws(() => splitSpeech('x'.repeat(500)), /too long/);
});
test('WAV contains the complete PCM samples with a correct header', () => {
  const wav = pcmWav([new Float32Array([0, .5]), new Float32Array([-.5])]);
  assert.equal(wav.length, 50); assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 24000); assert.equal(wav.readUInt32LE(40), 6);
  assert.throws(() => pcmWav([new Float32Array([NaN])]), /invalid/);
});
test('local voices endpoint works with no credential, uses no-store, and makes no model request', async () => {
  const req = Readable.from([Buffer.from(JSON.stringify({ action: 'voices' }))]);
  req.method = 'POST'; req.headers = { origin: 'http://localhost:5173', 'content-type': 'application/json' }; req.socket = { remoteAddress: '127.0.0.1' };
  const headers = {}; let data;
  const res = { setHeader: (k,v) => { headers[k] = v; }, end: raw => { data = JSON.parse(raw); } };
  await handler(req, res);
  assert.equal(res.statusCode, 200); assert.equal(headers['Cache-Control'], 'private, no-store');
  assert.ok(data.voices.some(v => v.voice_id === 'kokoro_bf_emma'));
  assert.ok(data.voices.every(v => !v.labels.accent.includes('australian')));
});
