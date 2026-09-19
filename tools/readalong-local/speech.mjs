/** Pure local speech bounds and WAV encoding. */
export const LOCAL_MODEL = 'kokoro_v1_0';
export const LOCAL_VOICES = [
  { id: 'bf_emma', name: 'Emma', accent: 'British', gender: 'female' },
  { id: 'af_heart', name: 'Heart', accent: 'American', gender: 'female' },
  { id: 'af_bella', name: 'Bella', accent: 'American', gender: 'female' },
  { id: 'bf_isabella', name: 'Isabella', accent: 'British', gender: 'female' },
  { id: 'bm_george', name: 'George', accent: 'British', gender: 'male' },
];
export function validateLocal(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a reader request.');
  if (body.action === 'voices') return body;
  if (body.action !== 'render' || body.model !== LOCAL_MODEL || body.delivery !== 'steady') throw new Error('Unsupported local narration settings.');
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 600 || /[\x00-\x08\x0e-\x1f]/.test(body.text)) throw new Error('Local passages must contain 1–600 readable characters.');
  if (!LOCAL_VOICES.some(v => `kokoro_${v.id}` === body.voiceId)) throw new Error('Choose an available local voice.');
  return body;
}
export function splitSpeech(text, max = 180) {
  const parts = []; let start = 0;
  while (start < text.length) {
    let end = Math.min(start + max, text.length);
    if (end < text.length) {
      const part = text.slice(start, end);
      const breaks = [...part.matchAll(/[.!?;:]\s+/g)];
      const sentenceEnd = breaks.at(-1);
      const boundary = sentenceEnd && sentenceEnd.index > max / 3 ? sentenceEnd.index + sentenceEnd[0].length : part.lastIndexOf(' ') + 1;
      if (boundary > 0) end = start + boundary;
      else throw new Error('A word or unbroken symbol sequence is too long for the local model. Split it before rendering.');
    }
    parts.push(text.slice(start, end)); start = end;
  }
  return parts;
}
export function pcmWav(parts, rate = 24000) {
  const samples = parts.reduce((sum, part) => sum + part.length, 0);
  if (!samples || samples * 2 > 16_000_000 - 44) throw new Error('The local recording was empty or too long to save.');
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  let offset = 44;
  for (const part of parts) for (const value of part) {
    if (!Number.isFinite(value)) throw new Error('The local model returned invalid audio.');
    bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), offset); offset += 2;
  }
  return bytes;
}
