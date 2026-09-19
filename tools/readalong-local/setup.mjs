/** One-time public model download. Never sends manuscript text. */
import { mkdir, stat, readFile, rename, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('./models/kokoro-v1.0/', import.meta.url));
const revision = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const modelHash = 'fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478';
const files = { 'config.json': 44, 'tokenizer.json': 3497, 'tokenizer_config.json': 113, 'onnx/model_quantized.onnx': 92361116 };
async function hash(file) { const h = createHash('sha256'); for await (const part of createReadStream(file)) h.update(part); return h.digest('hex'); }
for (const [name, size] of Object.entries(files)) {
  const dest = path.join(root, name);
  await mkdir(path.dirname(dest), { recursive: true });
  let good = false;
  try { good = (await stat(dest)).size === size && (!name.endsWith('.onnx') || await hash(dest) === modelHash); } catch { /* Download absent files. */ }
  if (good) continue;
  console.log(`Downloading local speech asset: ${name} (${Math.ceil(size / 1_000_000)} MB)`);
  const response = await fetch(`https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/${revision}/${name}`, { signal: AbortSignal.timeout(600_000) });
  if (!response.ok || !response.body) throw new Error(`Model download failed: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest + '.part'));
  if ((await stat(dest + '.part')).size !== size || name.endsWith('.onnx') && await hash(dest + '.part') !== modelHash) throw new Error('Downloaded model failed its integrity check.');
  await rename(dest + '.part', dest);
}
await writeFile(path.join(root, 'source.json'), JSON.stringify({ model: 'onnx-community/Kokoro-82M-v1.0-ONNX', revision, modelHash, licence: 'Apache-2.0' }, null, 2) + '\n');
console.log('Local speech model ready. Rendering uses these files offline.');
