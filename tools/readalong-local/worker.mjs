/** CPU-only inference worker. No text or recordings are sent over the network. */
import { parentPort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { KokoroTTS } from 'kokoro-js';
import { env, StyleTextToSpeech2Model, AutoTokenizer } from '@huggingface/transformers';
import { splitSpeech, pcmWav } from './speech.mjs';
env.allowRemoteModels = false;
env.allowLocalModels = true;
// A network attempt during inference is a defect, including accidental model downloads.
globalThis.fetch = async () => { throw new Error('Network access is disabled during local narration.'); };
const modelPath = fileURLToPath(new URL('./models/kokoro-v1.0/', import.meta.url));
let model;
async function load() {
  if (!model) model = (async () => {
    const [network, tokenizer] = await Promise.all([
      StyleTextToSpeech2Model.from_pretrained(modelPath, { dtype: 'q8', device: 'cpu', local_files_only: true,
        session_options: { intraOpNumThreads: 2, interOpNumThreads: 1, executionMode: 'sequential' } }),
      AutoTokenizer.from_pretrained(modelPath, { local_files_only: true }),
    ]);
    // Kokoro's default generate() truncates overly long phoneme inputs. Refuse
    // instead of returning a plausible recording with missing source words.
    const checkedTokenizer = (text, options) => {
      const result = tokenizer(text, { ...options, truncation: false });
      if (result.input_ids.dims.at(-1) > 510) throw new Error('This passage exceeds the local phoneme limit. Split it into shorter sentences.');
      return result;
    };
    return new KokoroTTS(network, checkedTokenizer);
  })();
  return model;
}
parentPort.on('message', async ({ id, text, voiceId }) => {
  try {
    const started = performance.now(), tts = await load(), audio = [];
    for (const part of splitSpeech(text)) {
      if (!part.trim()) continue;
      const result = await tts.generate(part, { voice: voiceId.replace(/^kokoro_/, ''), speed: 1 });
      audio.push(result.audio);
    }
    const wav = pcmWav(audio);
    parentPort.postMessage({ id, result: { audio_base64: wav.toString('base64'), mime: 'audio/wav', alignment: null,
      alignmentReason: 'Local Kokoro narration uses passage highlighting; verified word timings are unavailable.',
      requestId: null, seconds: (wav.length - 44) / 48000, renderSeconds: (performance.now() - started) / 1000,
      peakRssMb: process.resourceUsage().maxRSS / 1024 } });
  } catch (error) { parentPort.postMessage({ id, error: error.message }); }
});
