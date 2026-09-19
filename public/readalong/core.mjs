/** Pure reader logic. Offsets always refer to the imported text's UTF-16 code units. */
export const VERSION = 'iw-readalong-1';
export const MAX_TEXT = 2_000_000;
export const CHUNK_SIZE = 1400;
export const LOCAL_MODEL = 'kokoro_v1_0';
export const LOCAL_CHUNK_SIZE = 600;
export const isLocalProfile = profile => profile?.model === LOCAL_MODEL;
export function defaultProfile(hostname = '') {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
    ? { voiceId: 'kokoro_bf_emma', voiceName: 'Emma · British female', model: LOCAL_MODEL, delivery: 'steady' }
    : { voiceId: '', voiceName: '', model: 'eleven_v3', delivery: 'steady' };
}
export const DIRECTOR_BRIEF = 'An adult Australian female literary narrator. Intelligent, grounded and intimately conversational. A natural Australian accent, not a caricature. Dry, understated awareness of absurdity without signalling every joke. Take the serious passages seriously. Restrained pitch movement, unhurried but not sleepy. Avoid promotional enthusiasm, sing-song cadences, breathy affectation and exaggerated character voices. Let the writing carry the humour.';

export function cleanText(input) {
  if (typeof input !== 'string') throw new Error('The file must contain text.');
  if (input.length > MAX_TEXT) throw new Error('This edition supports up to two million characters per book.');
  if (/\0|[\x01-\x08\x0e-\x1f]/.test(input)) throw new Error('This looks like a binary file. Open a UTF-8 text or Markdown file.');
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!text) throw new Error('The file has no readable text.');
  return text;
}
export function words(text, offset = 0) {
  return [...text.matchAll(/\S+/gu)].map(m => ({ text: m[0], start: offset + m.index, end: offset + m.index + m[0].length }));
}
export function makeChapters(text) {
  const headings = [];
  for (const m of text.matchAll(/^(?:#{1,3}\s+[^\n]+|(?:chapter|part|book)\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b[^\n]*|\d{1,3}\.\s+[^\n]{1,100})$/gim)) {
    if (m[0].length <= 140) headings.push({ start: m.index, title: m[0].replace(/^#+\s*/, '') });
  }
  const sections = headings.length ? headings : [{ start: 0, title: 'The text' }];
  if (sections[0].start > 0) sections.unshift({ start: 0, title: 'Opening' });
  const expanded = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i], finish = sections[i + 1]?.start ?? text.length;
    let start = s.start, part = 1;
    while (start < finish) {
      let end = finish;
      if (finish - start > 24000) {
        const window = text.slice(start, start + 16000);
        const paragraph = window.lastIndexOf('\n\n'), space = window.lastIndexOf(' ');
        end = start + (paragraph > 8000 ? paragraph : space > 8000 ? space : 16000);
        if (/[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
      }
      expanded.push({ start, end, title: part === 1 ? s.title : `${s.title} · continued ${part}`, index: expanded.length });
      start = end; part++;
    }
  }
  return expanded;
}
export function splitChunks(text, chapters = makeChapters(text), max = CHUNK_SIZE) {
  if (!Number.isInteger(max) || max < 32) throw new Error('Invalid chunk size.');
  const chunks = [];
  for (const chapter of chapters) {
    let start = chapter.start;
    while (start < chapter.end) {
      while (start < chapter.end && /\s/u.test(text[start])) start++;
      if (start >= chapter.end) break;
      let end = Math.min(start + max, chapter.end);
      if (end < chapter.end) {
        const part = text.slice(start, end);
        const lower = Math.floor(max * 0.35);
        const paragraph = part.lastIndexOf('\n\n');
        const sentence = [...part.matchAll(/[.!?][’”'"\)]?\s+/gu)].filter(m => m.index > lower).at(-1);
        const space = [...part.matchAll(/\s+/gu)].at(-1);
        if (paragraph > lower) end = start + paragraph;
        else if (sentence) end = start + sentence.index + sentence[0].length;
        else if (space && space.index > 0) end = start + space.index;
        // Do not split a surrogate pair even for an unbroken pathological word.
        if (/[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
      }
      let trimmedEnd = end;
      while (trimmedEnd > start && /\s/u.test(text[trimmedEnd - 1])) trimmedEnd--;
      if (trimmedEnd > start) chunks.push({ index: chunks.length, chapter: chapter.index, start, end: trimmedEnd, text: text.slice(start, trimmedEnd) });
      start = end;
    }
  }
  return chunks;
}
export async function digest(text) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export function chunksForProfile(text, profile, chapters = makeChapters(text)) {
  return splitChunks(text, chapters, isLocalProfile(profile) ? LOCAL_CHUNK_SIZE : CHUNK_SIZE);
}
export function settingsFor(model, delivery = 'steady') {
  if (model === LOCAL_MODEL && delivery === 'steady') return { speed: 1 };
  if (model === 'eleven_v3') return { stability: delivery === 'natural' ? 0.5 : 1, similarity_boost: 0.75, speed: 1 };
  if (model === 'eleven_multilingual_v2') return { stability: delivery === 'natural' ? 0.55 : 0.75, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: 1 };
  throw new Error('Unsupported speech model.');
}
export async function cacheKey(chunk, profile) {
  return digest(JSON.stringify([VERSION, chunk.text, profile.voiceId, profile.model, settingsFor(profile.model, profile.delivery), isLocalProfile(profile) ? 'audio/wav' : 'mp3_44100_128']));
}
export function voiceScore(voice) {
  const labels = voice.labels || {};
  return (/australi|en-au/i.test(String(labels.accent)) ? 10 : 0) + (/^female$/i.test(String(labels.gender)) ? 5 : 0) + (/narrat|audiobook/i.test(String(labels.use_case)) ? 1 : 0);
}

/** Never invent timestamps. Collapse whitespace only; substantive divergence disables word sync. */
export function alignWords(text, alignment) {
  if (!alignment || !Array.isArray(alignment.characters)) return { words: [], mode: 'passage', reason: 'This recording has no word alignment.' };
  const { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  if (!Array.isArray(starts) || !Array.isArray(ends) || chars.length !== starts.length || chars.length !== ends.length || chars.length > 20000) return { words: [], mode: 'passage', reason: 'The provider returned invalid alignment arrays.' };
  const audible = [];
  let prev = -1;
  for (let i = 0; i < chars.length; i++) {
    if (typeof chars[i] !== 'string' || !Number.isFinite(starts[i]) || !Number.isFinite(ends[i]) || starts[i] < 0 || starts[i] < prev || ends[i] < starts[i] || ends[i] > 1800) return { words: [], mode: 'passage', reason: 'The provider returned invalid timing values.' };
    prev = starts[i];
    // Code units also handle APIs returning emoji as two separate character entries.
    for (let j = 0; j < chars[i].length; j++) if (!/\s/u.test(chars[i][j])) audible.push({ char: chars[i][j], start: starts[i], end: ends[i] });
  }
  const source = [];
  for (let i = 0; i < text.length; i++) if (!/\s/u.test(text[i])) source.push({ char: text[i], offset: i });
  if (source.length !== audible.length || source.some((s, i) => s.char !== audible[i].char)) return { words: [], mode: 'passage', reason: 'Audio alignment differs from the original text. Passage highlighting is used; the manuscript is unchanged.' };
  const byOffset = new Map(source.map((s, i) => [s.offset, audible[i]]));
  const timed = words(text).map(w => ({ start: w.start, end: w.end, from: byOffset.get(w.start).start, to: byOffset.get(w.end - 1).end }));
  return { words: timed, mode: 'word', reason: '' };
}
export function wordAtTime(timings, time) {
  let lo = 0, hi = timings.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timings[mid].from <= time) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best >= 0 && time <= timings[best].to ? timings[best] : null;
}
export function validateProfile(p) {
  if (isLocalProfile(p)) {
    if (!/^kokoro_(?:af|am|bf|bm)_[a-z][a-z0-9_]{1,50}$/.test(p.voiceId) || p.delivery !== 'steady') throw new Error('Choose a supported local Kokoro voice with steady delivery.');
    return { voiceId: p.voiceId, voiceName: String(p.voiceName || p.voiceId).slice(0, 160), model: p.model, delivery: 'steady' };
  }
  if (!p || typeof p.voiceId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(p.voiceId)) throw new Error('Choose a voice or enter a valid ElevenLabs voice ID.');
  if (!['eleven_v3', 'eleven_multilingual_v2'].includes(p.model) || !['steady', 'natural'].includes(p.delivery)) throw new Error('Invalid narration settings.');
  if (p.voiceId.startsWith('kokoro_')) throw new Error('Kokoro voices require the local narration engine.');
  return { voiceId: p.voiceId, voiceName: String(p.voiceName || p.voiceId).slice(0, 160), model: p.model, delivery: p.delivery };
}
export function formatTime(seconds) {
  const n = Number(seconds);
  const s = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
