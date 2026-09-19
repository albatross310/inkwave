import * as db from './storage.mjs';
import { VERSION, cleanText, digest, chunksForProfile, cacheKey, validateProfile, words, isLocalProfile } from './core.mjs';
const MAGIC = new TextEncoder().encode('IWLISTEN1\n');
const MAX_ARCHIVE = 1_500_000_000;
const MAX_ASSETS = 3000;
const hex = array => [...new Uint8Array(array)].map(n => n.toString(16).padStart(2, '0')).join('');
async function blobHash(blob) { return hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())); }
export async function exportBook(book, profile, chunks, position, rescueAsset, storage = db) {
  const assets = [], blobs = [], seen = new Set();
  for (const chunk of chunks) {
    const id = await cacheKey(chunk, profile);
    // Repeated passages share a recording; archive IDs must be unique too.
    if (seen.has(id)) continue;
    seen.add(id);
    const asset = rescueAsset?.id === id ? rescueAsset : await storage.get('audio', id);
    if (!asset) continue;
    if (assets.length >= MAX_ASSETS) throw new Error('A listening-book backup supports at most 3,000 distinct recordings. No backup was created.');
    assets.push({ id, size: asset.blob.size, mime: asset.blob.type || 'audio/mpeg', hash: await blobHash(asset.blob), words: asset.words, mode: asset.mode, reason: asset.reason || '', requestId: asset.requestId || null });
    blobs.push(asset.blob);
  }
  const meta = new TextEncoder().encode(JSON.stringify({ version: VERSION, book: { id: book.id, title: book.title, text: book.text, importNote: book.importNote || '' }, profile, position, assets }));
  if (meta.length > 20_000_000) throw new Error('The backup manifest is too large.');
  const size = new Uint8Array(4); new DataView(size.buffer).setUint32(0, meta.length);
  const result = new Blob([MAGIC, size, meta, ...blobs], { type: 'application/octet-stream' });
  if (result.size > MAX_ARCHIVE) throw new Error('This browser edition limits a single export to 1.5 GB.');
  return result;
}
export async function importBook(file, storage = db) {
  if (file.size > MAX_ARCHIVE) throw new Error('Listening books must be smaller than 1.5 GB.');
  const head = new Uint8Array(await file.slice(0, MAGIC.length + 4).arrayBuffer());
  if (head.length !== MAGIC.length + 4 || MAGIC.some((b, i) => head[i] !== b)) throw new Error('Not an Inkwave listening book.');
  const len = new DataView(head.buffer).getUint32(MAGIC.length);
  let offset = MAGIC.length + 4 + len;
  if (len > 20_000_000 || offset > file.size) throw new Error('Invalid listening book manifest.');
  let data;
  try { data = JSON.parse(await file.slice(MAGIC.length + 4, offset).text()); } catch { throw new Error('The listening book manifest is unreadable.'); }
  if (data.version !== VERSION || !data.book || !Array.isArray(data.assets) || data.assets.length > MAX_ASSETS) throw new Error('Unsupported listening book.');
  const text = cleanText(data.book.text), id = await digest(text), profile = validateProfile(data.profile);
  if (id !== data.book.id) throw new Error('The book text failed its integrity check.');
  const book = { id, title: String(data.book.title || 'Imported book').slice(0, 180), text, importNote: typeof data.book.importNote === 'string' ? data.book.importNote.slice(0, 1500) : '', createdAt: Date.now() };
  const chunks = chunksForProfile(text, profile);
  const valid = new Map(await Promise.all(chunks.map(async chunk => [await cacheKey(chunk, profile), chunk])));
  const staged = [], seen = new Set();
  // Validate the complete archive before writing any imported content.
  for (const asset of data.assets) {
    const chunk = valid.get(asset.id);
    if (!chunk || seen.has(asset.id) || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > (isLocalProfile(profile) ? 16_000_000 : 4_000_000) || offset + asset.size > file.size) throw new Error('Invalid audio entry in listening book.');
    seen.add(asset.id);
    if (!['word', 'passage'].includes(asset.mode) || !Array.isArray(asset.words)) throw new Error('Invalid timing data.');
    const expected = words(chunk.text);
    if (asset.mode === 'word' && asset.words.length !== expected.length) throw new Error('The recording does not match the words.');
    if (asset.mode === 'passage' && asset.words.length) throw new Error('Unexpected passage timing data.');
    let previous = -1;
    for (let i = 0; i < asset.words.length; i++) {
      const w = asset.words[i];
      if (w.start !== expected[i].start || w.end !== expected[i].end || !Number.isFinite(w.from) || !Number.isFinite(w.to) || w.from < 0 || w.from < previous || w.to < w.from || w.to > 1800) throw new Error('Invalid word timestamps.');
      previous = w.from;
    }
    const mime = asset.mime ?? 'audio/mpeg';
    if (!['audio/mpeg', 'audio/wav', 'audio/x-wav'].includes(mime)) throw new Error('Unsupported recording type in listening book.');
    const blob = file.slice(offset, offset + asset.size, mime); offset += asset.size;
    if (await blobHash(blob) !== asset.hash) throw new Error('A recording failed its integrity check. Nothing was imported.');
    staged.push({ id: asset.id, blob, words: asset.words, mode: asset.mode, reason: String(asset.reason || '').slice(0, 500), requestId: typeof asset.requestId === 'string' ? asset.requestId.slice(0, 100) : null });
  }
  if (offset !== file.size) throw new Error('Unexpected trailing data in listening book.');
  for (const asset of staged) await storage.addIfAbsent('audio', asset);
  const saved = await storage.addBookIfAbsent(book);
  const raw = data.position;
  if (raw && Number.isInteger(raw.chunk) && chunks[raw.chunk] && Number.isFinite(raw.time) && raw.time >= 0 && raw.time <= 1800) {
    const placeId = `place:${id}:${profile.voiceId}:${profile.model}:${profile.delivery}`;
    if (!await storage.get('prefs', placeId)) {
      const marks = (Array.isArray(raw.marks) ? raw.marks : []).slice(0, 500)
        .filter(m => Number.isInteger(m.chunk) && chunks[m.chunk] && Number.isFinite(m.time) && m.time >= 0 && m.time <= 1800)
        .map(m => ({ chunk: m.chunk, time: m.time, label: String(m.label || '').slice(0, 200) }));
      await storage.addIfAbsent('prefs', { id: placeId, chapter: chunks[raw.chunk].chapter, chunk: raw.chunk, time: raw.time, marks });
    }
  }
  return { book: saved, profile, assetCount: staged.length };
}
