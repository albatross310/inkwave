import test from 'node:test';
import assert from 'node:assert/strict';
import { exportBook, importBook } from '../../public/readalong/archive.mjs';
import { digest, splitChunks, cacheKey } from '../../public/readalong/core.mjs';
const profile = { voiceId: 'testvoice1234', voiceName: 'Fixture', model: 'eleven_v3', delivery: 'steady' };
function memoryStorage() {
  const stores = { books: new Map(), audio: new Map(), prefs: new Map() };
  return {
    stores,
    async get(store, id) { return stores[store].get(id); },
    async put(store, value) { stores[store].set(value.id, value); },
    async addIfAbsent(store, value) { if (!stores[store].has(value.id)) stores[store].set(value.id, value); return stores[store].get(value.id); },
    async addBookIfAbsent(book) { if (!stores.books.has(book.id)) stores.books.set(book.id, book); return stores.books.get(book.id); },
  };
}
async function fixture() {
  const text = 'A'.repeat(1400) + '\n\n' + 'A'.repeat(1400);
  const book = { id: await digest(text), text, title: 'Repeated passage fixture' };
  const chunks = splitChunks(text), id = await cacheKey(chunks[0], profile);
  return { book, chunks, asset: { id, blob: new Blob(['offline audio fixture']), words: [], mode: 'passage' } };
}
test('repeated passages export once and import into a fresh shelf, including recovery audio', async () => {
  const { book, chunks, asset } = await fixture();
  assert.equal(chunks.length, 2);
  assert.equal(await cacheKey(chunks[1], profile), asset.id);
  for (const recovery of [false, true]) {
    const source = memoryStorage(), destination = memoryStorage();
    if (!recovery) await source.put('audio', asset);
    const blob = await exportBook(book, profile, chunks, { chunk: 1, time: 2, marks: [] }, recovery ? asset : null, source);
    const imported = await importBook(blob, destination);
    assert.equal(imported.assetCount, 1);
    assert.equal(destination.stores.audio.size, 1);
    assert.equal(imported.book.text, book.text);
    assert.equal(await destination.stores.audio.get(asset.id).blob.text(), await asset.blob.text());
    assert.equal([...destination.stores.prefs.values()][0].chunk, 1);
  }
});
test('corrupt recording rejects the whole archive before any writes', async () => {
  const { book, chunks, asset } = await fixture(), destination = memoryStorage();
  const exported = await exportBook(book, profile, chunks, null, asset, memoryStorage());
  const bytes = new Uint8Array(await exported.arrayBuffer()); bytes[bytes.length - 1] ^= 1;
  await assert.rejects(importBook(new Blob([bytes]), destination), /integrity check/);
  assert.equal(Object.values(destination.stores).reduce((n, store) => n + store.size, 0), 0);
});
test('a storage read failure never becomes permission to overwrite existing paid audio', async () => {
  const { book, chunks, asset } = await fixture(), destination = memoryStorage();
  const exported = await exportBook(book, profile, chunks, null, asset, memoryStorage());
  destination.addIfAbsent = async () => { throw new Error('Unreadable device storage'); };
  await assert.rejects(importBook(exported, destination), /Unreadable device storage/);
  assert.equal(destination.stores.audio.size, 0);
});
test('import preserves an existing recording and listening position in the destination', async () => {
  const { book, chunks, asset } = await fixture(), destination = memoryStorage();
  const existing = { ...asset, blob: new Blob(['newer paid take']) };
  const placeId = `place:${book.id}:${profile.voiceId}:${profile.model}:${profile.delivery}`;
  await destination.put('audio', existing);
  await destination.put('prefs', { id: placeId, chunk: 1, time: 12, marks: [{ label: 'Keep my bookmark' }] });
  const exported = await exportBook(book, profile, chunks, { chunk: 0, time: 0, marks: [] }, asset, memoryStorage());
  await importBook(exported, destination);
  assert.equal(await destination.stores.audio.get(asset.id).blob.text(), 'newer paid take');
  assert.equal(destination.stores.prefs.get(placeId).time, 12);
  assert.equal(destination.stores.prefs.get(placeId).marks[0].label, 'Keep my bookmark');
});
test('export refuses an asset count its importer cannot restore', async () => {
  const chunks = Array.from({ length: 3001 }, (_, i) => ({ text: `Distinct fixture ${i}.` }));
  const storage = { async get(_, id) { return { id, blob: new Blob(['fixture']), mode: 'passage', words: [] }; } };
  await assert.rejects(exportBook({ id: 'fixture', title: 'Fixture', text: '' }, profile, chunks, null, null, storage), /3,000 distinct recordings/);
});
test('local WAV backups round-trip using the same 600-character boundaries as playback', async () => {
  const { defaultProfile, chunksForProfile } = await import('../../public/readalong/core.mjs');
  const local = defaultProfile('localhost'), text = 'A'.repeat(600) + '\n\n' + 'B'.repeat(600);
  const book = { id: await digest(text), title: 'Local WAV fixture', text }, chunks = chunksForProfile(text, local);
  assert.equal(chunks.length, 2); assert.equal(splitChunks(text).length, 1);
  const source = memoryStorage(), destination = memoryStorage();
  for (const chunk of chunks) await source.put('audio', { id: await cacheKey(chunk, local), blob: new Blob(['RIFF offline WAV fixture'], { type: 'audio/wav' }), words: [], mode: 'passage', reason: 'No verified word timings.' });
  const backup = await exportBook(book, local, chunks, { chunk: 1, time: 3, marks: [] }, null, source);
  const restored = await importBook(backup, destination);
  assert.equal(restored.profile.model, 'kokoro_v1_0'); assert.equal(restored.assetCount, 2);
  for (const row of destination.stores.audio.values()) { assert.equal(row.blob.type, 'audio/wav'); assert.equal(row.mode, 'passage'); assert.equal(row.reason, 'No verified word timings.'); }
  assert.equal([...destination.stores.prefs.values()][0].chunk, 1);
});
test('legacy archives without MIME restore as MP3 with unchanged recording IDs', async () => {
  const { book, chunks, asset } = await fixture();
  const backup = await exportBook(book, profile, chunks, null, asset, memoryStorage());
  const magicLength = new TextEncoder().encode('IWLISTEN1\n').length;
  const head = await backup.slice(0, magicLength + 4).arrayBuffer(), oldLength = new DataView(head).getUint32(magicLength);
  const manifest = JSON.parse(await backup.slice(magicLength + 4, magicLength + 4 + oldLength).text());
  for (const row of manifest.assets) delete row.mime;
  const metadata = new TextEncoder().encode(JSON.stringify(manifest)), length = new Uint8Array(4); new DataView(length.buffer).setUint32(0, metadata.length);
  const legacy = new Blob([backup.slice(0, magicLength), length, metadata, backup.slice(magicLength + 4 + oldLength)]);
  const destination = memoryStorage(); await importBook(legacy, destination);
  assert.equal(destination.stores.audio.get(asset.id).blob.type, 'audio/mpeg');
  assert.equal(await destination.stores.audio.get(asset.id).blob.text(), await asset.blob.text());
});
