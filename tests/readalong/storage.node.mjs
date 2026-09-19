import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAudioRow, decodeAudioRow } from '../../public/readalong/storage.mjs';
test('audio bytes and MIME survive storage without serializing a Blob', async () => {
  const original = { id: 'fixture', blob: new Blob([new Uint8Array([0, 255, 37, 80])], { type: 'audio/wav' }), words: [{ start: 0, end: 4, from: 0, to: 1 }], mode: 'word', requestId: 'offline' };
  const stored = await encodeAudioRow(original);
  assert.ok(stored.audioBytes instanceof ArrayBuffer);
  assert.equal(stored.blob, undefined);
  const decoded = decodeAudioRow(structuredClone(stored));
  assert.equal(decoded.blob.type, original.blob.type);
  assert.deepEqual(new Uint8Array(await decoded.blob.arrayBuffer()), new Uint8Array(await original.blob.arrayBuffer()));
  assert.deepEqual(decoded.words, original.words);
  assert.equal(decoded.requestId, 'offline');
  assert.equal(original.blob.size, 4, 'Writing must leave the in-memory recovery asset intact.');
});
test('legacy Blob rows remain playable without rewriting or deleting them', () => {
  const legacy = { id: 'legacy', blob: new Blob(['saved recording'], { type: 'audio/mpeg' }), words: [], mode: 'passage' };
  assert.equal(decodeAudioRow(legacy), legacy);
  assert.equal(decodeAudioRow(undefined), undefined);
});
test('malformed audio storage is an error rather than an absent recording', async () => {
  assert.throws(() => decodeAudioRow({ id: 'corrupt', audioBytes: 'not bytes' }), /unreadable/);
  await assert.rejects(encodeAudioRow({ id: 'corrupt' }), /no readable audio/);
});
