import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanText, words, makeChapters, splitChunks, digest, cacheKey, alignWords, wordAtTime, settingsFor, voiceScore, validateProfile, formatTime } from '../../public/readalong/core.mjs';
const profile = { voiceId: 'voice00000001', voiceName: 'Test voice', model: 'eleven_v3', delivery: 'steady' };
function alignment(text) { const chars = [...text]; return { characters: chars, character_start_times_seconds: chars.map((_, i) => i / 10), character_end_times_seconds: chars.map((_, i) => (i + .8) / 10) }; }
test('BOM and newline normalisation; invalid binary is not an empty book', () => {
  assert.equal(cleanText('\uFEFFhello\r\nworld\r'), 'hello\nworld');
  for (const input of ['', '  ', '\0abc', 4]) assert.throws(() => cleanText(input));
});
test('chapters include opening matter; all text ranges are covered', () => {
  const text = 'Preface\n\n1. Opening\n\nTest.\n\nChapter II\n\nDone.';
  const chapters = makeChapters(text);
  assert.deepEqual(chapters.map(c => c.title), ['Opening', '1. Opening', 'Chapter II']);
  assert.equal(chapters.map(c => text.slice(c.start, c.end)).join(''), text);
});
test('a chapter is not invented for a long numbered prose line', () => {
  assert.equal(makeChapters('123. ' + 'test '.repeat(100)).length, 1);
});
test('bounded chunks preserve every non-space character exactly once', () => {
  for (const text of ['One.\n\nTwo.\n\n'.repeat(1000), 'a'.repeat(8000), '漢語🙂 — test. '.repeat(1000)]) {
    const chunks = splitChunks(text, makeChapters(text), 151);
    assert.equal(chunks.map(c => c.text).join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
    for (const c of chunks) { assert.ok(c.text.length <= 151); assert.equal(text.slice(c.start, c.end), c.text); assert.ok(!/[\uD800-\uDBFF]$/.test(c.text)); }
  }
});
test('seeded random Unicode chunking coverage', () => {
  let seed = 11;
  const alphabet = ['A', ' ', '\n', '。', '🙂', 'é', '‘', '3', '?'];
  for (let trial = 0; trial < 100; trial++) {
    let text = ''; for (let n = 0; n < 300; n++) { seed = (seed * 1664525 + 1013904223) >>> 0; text += alphabet[seed % alphabet.length]; }
    const chunks = splitChunks(text, makeChapters(text), 53);
    assert.equal(chunks.map(c => c.text).join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  }
});
test('alignment is positional, not first-occurrence lookup', () => {
  const text = 'one one one'; const result = alignWords(text, alignment(text));
  assert.equal(result.mode, 'word'); assert.deepEqual(result.words.map(w => w.start), [0, 4, 8]);
  assert.equal(result.words[2].from, .8);
});
test('UTF-16 offsets survive emoji and non-English text', () => {
  const text = '🙂 你好 café';
  const result = alignWords(text, alignment(text));
  assert.equal(result.mode, 'word'); assert.deepEqual(result.words.map(w => w.start), [0, 3, 6]);
  assert.equal(words(text)[1].text, '你好');
  assert.equal(alignWords(text, { ...alignment(text), characters: text.split('') }).mode, 'passage');
});
test('alignment tolerates whitespace, not reordered or normalised words', () => {
  assert.equal(alignWords('a\n\nb', alignment('a b')).mode, 'word');
  assert.equal(alignWords('12 ships', alignment('twelve ships')).mode, 'passage');
  assert.equal(alignWords('A B', alignment('B A')).mode, 'passage');
  assert.equal(alignWords('x', null).mode, 'passage');
});
test('invalid timings never masquerade as synchronised words', () => {
  for (const value of [NaN, Infinity, -1, 1900]) {
    const a = alignment('Hi'); a.character_end_times_seconds[0] = value;
    assert.equal(alignWords('Hi', a).mode, 'passage');
  }
  const a = alignment('Hi'); a.character_start_times_seconds.reverse();
  assert.equal(alignWords('Hi', a).mode, 'passage');
});
test('binary search clears the highlight in a spoken pause', () => {
  const ws = [{ from: 1, to: 2 }, { from: 4, to: 5 }];
  assert.equal(wordAtTime(ws, 0), null); assert.equal(wordAtTime(ws, 1.5), ws[0]);
  assert.equal(wordAtTime(ws, 3), null); assert.equal(wordAtTime(ws, 4), ws[1]); assert.equal(wordAtTime([], 1), null);
});
test('cache keys bind exact text, model, voice, settings; not cosmetics', async () => {
  const chunk = { text: 'A passage.' }, base = await cacheKey(chunk, profile);
  assert.equal(base.length, 64);
  assert.equal(base, await cacheKey(chunk, { ...profile, font: 22, speed: 1.5, voiceName: 'Renamed' }));
  for (const p of [{ ...profile, voiceId: 'anotherVoice' }, { ...profile, delivery: 'natural' }, { ...profile, model: 'eleven_multilingual_v2' }]) assert.notEqual(base, await cacheKey(chunk, p));
  assert.notEqual(base, await cacheKey({ text: 'A passage!' }, profile));
  assert.equal(await digest('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('settings are model-specific and voice selection does not infer accent from a name', () => {
  assert.equal(settingsFor('eleven_v3', 'steady').stability, 1);
  assert.equal(settingsFor('eleven_v3', 'natural').stability, .5);
  assert.equal(settingsFor('eleven_multilingual_v2').style, 0);
  assert.equal(voiceScore({ name: 'Australian Female', labels: {} }), 0);
  assert.equal(voiceScore({ labels: { accent: 'australian', gender: 'female' } }), 15);
  assert.throws(() => validateProfile({ ...profile, voiceId: '../secret' }));
});
test('time display is bounded and human readable', () => {
  assert.equal(formatTime(3701), '1:01:41'); assert.equal(formatTime(Infinity), '0:00');
  assert.equal(formatTime(0), '0:00'); assert.equal(formatTime(61), '1:01');
});
test('local profiles are explicit, bounded, and default only on loopback hosts', async () => {
  const { defaultProfile, isLocalProfile, validateProfile, chunksForProfile } = await import('../../public/readalong/core.mjs');
  const local = defaultProfile('localhost');
  assert.equal(local.model, 'kokoro_v1_0'); assert.equal(local.voiceId, 'kokoro_bf_emma');
  for (const host of ['localhost', '127.0.0.1', '[::1]']) assert.ok(isLocalProfile(defaultProfile(host)));
  for (const host of ['iwzero.me', 'localhost.attacker.test', '192.168.1.2']) assert.equal(isLocalProfile(defaultProfile(host)), false);
  assert.deepEqual(validateProfile(local), local);
  for (const bad of [{ ...local, delivery: 'natural' }, { ...local, voiceId: 'testvoice1234' }, { ...local, voiceId: 'kokoro_../escape' }, { ...local, model: 'eleven_v3' }]) assert.throws(() => validateProfile(bad));
  const text = 'A'.repeat(1400) + '\n\n' + 'B'.repeat(1400);
  const chunks = chunksForProfile(text, local);
  assert.ok(chunks.every(c => c.text.length <= 600));
  assert.equal(chunks.map(c => c.text).join(''), text.replace(/\s/g, ''));
  assert.deepEqual(chunksForProfile(text, profile), splitChunks(text));
});
test('local WAV keys are isolated while legacy Eleven key bytes remain unchanged', async () => {
  const { defaultProfile } = await import('../../public/readalong/core.mjs');
  const chunk = { text: 'A passage.' };
  const legacy = await digest(JSON.stringify(['iw-readalong-1', chunk.text, profile.voiceId, profile.model, settingsFor(profile.model, profile.delivery), 'mp3_44100_128']));
  assert.equal(await cacheKey(chunk, profile), legacy);
  const local = defaultProfile('localhost');
  const key = await cacheKey(chunk, local);
  assert.notEqual(key, await cacheKey(chunk, { ...local, model: 'eleven_v3' }));
  assert.notEqual(key, await cacheKey(chunk, { ...local, voiceId: 'kokoro_af_heart' }));
  assert.equal(key, await cacheKey(chunk, { ...local, voiceName: 'Renamed', speed: 1.5 }));
});
