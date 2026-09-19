# Open-weight voice models for Read along

Research date: **15 September 2026**. This is a primary-source capability and licensing review, not an audio-quality benchmark or an implementation commitment. No models were downloaded or auditioned for this review. Model cards and upstream code were checked live; release names below deliberately correct older names still common in comparisons. Qwen, MOSS, VibeVoice and hosted baselines are being assessed separately.

The target is a book production system: one narrator, persistent character identities designed from descriptions, a character/relationship analysis of the whole book, and scene-level direction that preserves natural exchanges. Three different capabilities must be kept separate:

- **Voice design:** creating an identity from a description without supplying an existing voice recording.
- **Voice cloning:** reusing the identity in reference audio. A generated, approved reference can also become a character's stable voice.
- **Delivery control:** making that identity sound restrained, tired, hesitant or angry. An emotion prompt alone does not establish voice-design capability.

**Evidence** below means documented in an official model card, repository, license or API. **Inference** means the proposed engineering consequence. **Unverified** means no adequate primary evidence or direct test was obtained. Vendor benchmark scores are not used to rank models: datasets, normalization, prompts, evaluators and hardware differ, and transcription accuracy does not measure convincing dramatic timing.

## Comparison at a glance

| Candidate to audition | Identity from text alone | Scene / multiple voices | Open-weight license position | Role in this investigation |
| --- | --- | --- | --- | --- |
| **VoxCPM2** | Explicit design and controllable cloning | Joint cast scenes unverified; one-reference interface | Apache-2.0 | Top actor/design candidate: addresses the controllable-clone gap |
| Fish **S2 Pro** | Free-form delivery tags; dedicated repeatable identity design unverified | Native multiple speakers and turns | Research license; separate commercial permission | Leading scene-generation candidate if licensing fits |
| OpenAudio / Fish **S1-mini** | Not established; reference-led | No equivalent native scene API established | CC-BY-NC-SA-4.0 | Older small-model comparison |
| IndexTTS **2.5**, retain **2** as comparison | Reference cloning plus separate emotion instructions | Segmentation breaks prosody context | Custom Bilibili model license | Controlled single-character comparison |
| Fun-CosyVoice **3-0.5B-2512** | Instruction examples still require reference audio | Streaming is documented; native cast dialogue unverified | Apache-2.0 model card | Commercially practical single-character comparison |
| Higgs TTS **2-3b-base** | Documented scene descriptions / smart voices | Native multi-speaker generation | Boson community license with conditions | Especially relevant prompt-and-scene experiment |
| Higgs TTS **3-4b** | Default speech and cloning; dedicated identity designer unverified | Rich turn controls; full cast interface needs verification | Research/noncommercial; product hosting needs agreement | Latest expressive voice comparison |
| Chatterbox **Turbo**, **Multilingual V3**, original | Reference cloning / default voices | Native scene memory unverified | MIT | Practical unrestricted comparison |
| Chatterbox **Nano** | Reference cloning | Native scene memory unverified | MIT | CPU-capable baseline beyond Kokoro |
| **Dia2-1B / Dia2-2B** | Not established; audio-prefix conditioning | Two speaker tags; two-minute English generation | Apache-2.0; codec has separate terms | Short conversational-scene comparison |
| Sesame **CSM-1B** | Random identity or reference context | Next-turn synthesis conditioned on previous speakers' audio/text | Apache-2.0 model; upstream components have separate terms | Contextual-turn comparison, not a whole scene in one call |
| **F5TTS_v1_Base** | Reference cloning | Multi-voice script orchestration, not proven joint scene modeling | MIT code, CC-BY-NC-4.0 weights | Research baseline |
| **XTTS-v2** | Reference cloning | Per-voice synthesis; native scene modeling unverified | CPML noncommercial, including outputs | Legacy research baseline |
| Piper **1.8.0** plus named voice checkpoint | Fixed trained voices | External assembly | GPL-3.0 engine; voice-specific weights licenses | Lightweight delivery baseline |

These classifications are supported and qualified by the primary sources in the following sections. “Unverified” must not be turned into “impossible”; it prevents us selling an unsupported capability before the audition.

## Fish Audio S2 Pro and OpenAudio

**Evidence.** `fishaudio/s2-pro` has a 4B slow autoregressive component and a 400M fast component. It supports free-form inline directions and the repository documents generation spanning speakers and turns, using preceding context. Its character identity path is short reference audio, including a reference with multiple speakers. The inference setup specifies **24 GB GPU memory**, Linux/WSL, with a CPU installation path also offered. The advertised fast streaming measurements are on **H200**, not a GTX 1070 or RTX 3090. [Model card](https://huggingface.co/fishaudio/s2-pro), [repository](https://github.com/fishaudio/fish-speech), [installation requirements](https://speech.fish.audio/install/).

The official API accepts a list of voice IDs or grouped reference recordings with speaker tags in one script. This is relevant to avoiding independently acted lines. It does not demonstrate automatic analysis of a novel or persistent personas across separate requests. **Inference:** audition whole short scenes, then carry selected reference identities between scenes. Do not equate expressive bracket tags with a proven text-to-new-identity designer. [Multi-speaker API](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech).

**License/version distinction.** S2 Pro permits research/noncommercial use; commercial use needs separate permission. The hosted **S2.1 Pro** product must not be presented as the same downloadable checkpoint. The older `fishaudio/openaudio-s1-mini` URL now redirects to `fishaudio/s1-mini`: **0.5B**, 13 languages and emotion/tone markers, under **CC-BY-NC-SA-4.0**. Its full S1 4B sibling is described as proprietary. [S2 license section](https://huggingface.co/fishaudio/s2-pro#license), [current Fish developer offering](https://fish.audio/developers/), [S1-mini model card](https://huggingface.co/fishaudio/s1-mini).

**Unverified:** convincing restrained Australian English and a reusable, prompt-created Australian identity. A language count is not accent evidence.

## IndexTTS 2 and 2.5

**Evidence.** The current release is `IndexTeam/IndexTTS-2.5`, released **10 August 2026**, rather than IndexTTS-2. Its approximately **0.8B GPT backbone** is only one component of the full stack. The card specifies Python 3.10–3.11, NVIDIA GPU, roughly **6 GB inference VRAM**, and auxiliary models downloaded separately. A reference recording supplies identity; emotion can be controlled independently, including through a text-to-emotion component. The current repository provides speed and English phoneme controls; Windows acceleration has installation caveats. [2.5 card](https://huggingface.co/IndexTeam/IndexTTS-2.5), [upstream release and API](https://github.com/index-tts/index-tts).

The important disclosed limitation is that long text is segmented and concatenated with silence, **without prosody modeled across segment boundaries**. **Inference:** this makes Index a useful character-voice/directability contestant, but not the strongest native scene renderer for Peter's complaint about detached lines. Emotion descriptions are not new voice identities. [Limitations](https://huggingface.co/IndexTeam/IndexTTS-2.5#limitations).

**License.** The Bilibili Model Use License is not MIT/Apache. It grants limited royalty-free use with conditions; separate licensing is required above 100 million monthly active users or RMB 1 billion annual revenue. It restricts using the model/derivatives to improve other commercial AI models, and defines derivatives broadly. The current 2.5 license file still names `indextts2`. [Exact 2.5 license](https://huggingface.co/IndexTeam/IndexTTS-2.5/blob/main/LICENSE).

**Unverified:** GTX 1070 operation with the current stack, Australian pronunciation/identity fidelity, and natural multi-character scenes. The 6 GB statement is a memory claim, not proof of Pascal compatibility or speed.

## CosyVoice 3

**Evidence.** The released checkpoint is `FunAudioLLM/Fun-CosyVoice3-0.5B-2512`, with an **Apache-2.0** model-card declaration. It offers multilingual/cross-lingual cloning, pronunciation controls, bidirectional streaming and instructions for dialect, emotion, speed and volume. Crucially, the supplied `inference_instruct2` examples still take a **reference WAV**. **Inference:** treat this as reference-conditioned synthesis with controllable delivery, not demonstrated standalone voice design. [Model card and usage](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512), [official repository](https://github.com/QwenAudio/CosyVoice).

The repository includes training and serving paths. “0.5B” is the language-model label, not a complete deployment-memory budget; tokenizer, speaker conditioning, flow/vocoder and runtime also count. No dependable minimum VRAM or GTX 1070 result was established in the sources reviewed. Native streaming should not be confused with one jointly generated scene containing a narrator and cast.

**Unverified:** prompt-only Australian voice creation, stable Australian accent transfer, and cross-speaker timing. **Audition role:** a comparatively permissive, compact cloning renderer; pair with a separate voice designer if it wins the listening test.

## Higgs TTS 2 and Higgs TTS 3

These releases have materially different interfaces and licenses. Testing only “Higgs Audio” without pinning the checkpoint would be misleading.

**Higgs TTS 2 evidence.** The former `bosonai/higgs-audio-v2-generation-3B-base` redirects to **`bosonai/higgs-tts-2-3b-base`**. The card documents *smart voice* generation with speaker characteristics in a `scene` message, speaker tags in the script, and no reference recording required. It also documents multi-speaker cloning when reference clips are supplied. Its labeled 3B backbone plus audio adapter totals approximately **5.8B parameters**, not 3B total. The archived upstream guide recommends **24 GB GPU memory**. [Model card and multi-speaker examples](https://huggingface.co/bosonai/higgs-tts-2-3b-base), [archived upstream usage](https://github.com/boson-ai/higgs-audio/blob/main/README_V2.md).

**Inference:** this is one of the most directly relevant candidates in this batch for combining described characters and scene generation. An initial scene can audition identities, but a selected voice should be retained as a reference rather than assuming fresh text descriptions reproduce identical timbre forever. Detailed Australian identity control remains an audition question.

**Higgs 2 license.** The Boson community terms incorporate Meta Llama terms, require notices/attribution, restrict training other LLMs with outputs, and require an expanded license above **100,000 annual active users**. They include naming conditions for derived model/software distribution; do not treat this as frictionless MIT product embedding. [Weights license](https://huggingface.co/bosonai/higgs-tts-2-3b-base/raw/main/LICENSE).

**Higgs TTS 3 evidence.** The current name is **`bosonai/higgs-tts-3-4b`**. Its card describes a roughly 4B backbone, 8,192-token training context, 24 kHz output, reference cloning and inline emotion/style/pause controls. It lists English with US/UK/Australian flags, but does not provide a separate Australian-English evaluation. SGLang-Omni and vLLM-Omni are documented serving options; published throughput is measured on H100. The examples reviewed do not establish the same text-described multi-character `scene` interface as TTS 2. [TTS 3 model card](https://huggingface.co/bosonai/higgs-tts-3-4b).

**License distinction:** TTS 3's research/noncommercial license has a creator grant for monetized content with credit. That grant explicitly does **not** cover hosting behind an API or embedding the model in a product/application. Inkwave's proposed public service therefore cannot rely on the creator grant alone. [Current creator grant and license](https://huggingface.co/bosonai/higgs-tts-3-4b/blob/main/LICENSE).

## Chatterbox family

**Evidence.** Current upstream distinguishes original English **500M**, **Turbo 350M**, **Multilingual V3 500M**, and **Nano 110M**. The original offers exaggeration/CFG controls; Turbo/Nano support paralinguistic tags. Identity comes from a reference recording or a supplied default, not a demonstrated descriptive voice-design prompt. Upstream reports development/testing on Python 3.11 and Debian 11; example APIs expose CUDA and, for applicable models, CPU/MPS. These are **MIT-licensed** releases. [Official repository](https://github.com/resemble-ai/chatterbox), [Turbo card](https://huggingface.co/ResembleAI/chatterbox-turbo), [publisher licensing overview](https://www.resemble.ai/learn/models/chatterbox).

**Exact multilingual selection matters.** Current code uses repository `ResembleAI/chatterbox`; V3 is `t3_mtl23ls_v3.safetensors`, selected with `t3_model="v3"`. Omitting that selection still defaults to the older V2 checkpoint in the code inspected. [Official loader](https://github.com/resemble-ai/chatterbox/blob/master/src/chatterbox/mtl_tts.py).

**Nano evidence.** `ResembleAI/chatterbox-nano` is a recent **110M** model, shares Turbo's API via `nano=True`, and explicitly supports CPU inference. The publisher claims faster-than-real-time CPU generation on eight cores; that is not measured on Peter's Mac or Windows host here. [Nano card](https://huggingface.co/ResembleAI/chatterbox-nano).

**Inference:** audition Turbo and V3 for practical single-voice quality, and Nano as the lightweight reference-cloning baseline. They are more relevant than Kokoro when a character must preserve a custom identity, but none of the reviewed interfaces establishes full-cast scene context or a whole-book director. Natural Australian voice transfer remains unverified. Built-in watermarking is documented; it is not a quality measure.

## F5-TTS, XTTS and Piper baselines

**F5-TTS.** Pin **`F5TTS_v1_Base`**, specifically `SWivid/F5-TTS/F5TTS_v1_Base/model_1250000.safetensors`. Official code is MIT, while these weights are **CC-BY-NC-4.0**. Its interface uses reference audio plus its transcript; omitting the transcript invokes ASR with extra resource cost. The multi-voice example maps named voices to separate reference files. That demonstrates useful script assembly, not evidence that the acoustic model jointly directs inter-character timing. **Inference:** retain as a research cloning-quality baseline, not the default freely commercial Inkwave worker. [Official checkpoint inventory](https://github.com/SWivid/F5-TTS/blob/main/src/f5_tts/infer/SHARED.md), [repository](https://github.com/SWivid/F5-TTS), [multi-voice example](https://github.com/SWivid/F5-TTS/blob/main/src/f5_tts/infer/examples/multi/story.toml).

**XTTS-v2.** `coqui/XTTS-v2` provides short-reference cloning, cross-language generation and style/emotion transfer through the reference. Its published card describes 17 languages and approximately six-second reference recordings. It is not a prompt-described persona generator. The **Coqui Public Model License 1.0.0 restricts both model and outputs to noncommercial use**; code licensing does not remove this restriction. **Inference:** useful legacy comparison, weak public-product default. No exact current GTX 1070 compatibility or natural full-cast scene interface was established. [Model card](https://huggingface.co/coqui/XTTS-v2), [actual weights/output license](https://huggingface.co/coqui/XTTS-v2/raw/main/LICENSE.txt).

**Piper.** Current maintained engine: `OHF-Voice/piper1-gpl`, **v1.8.0 released 4 September 2026**. It uses trained voice checkpoints exported to ONNX and an associated configuration. Engine code is GPL-3.0; every voice's own model card governs its weights, so the voice collection's headline label is insufficient. The English directory inspected contains `en_GB` and `en_US`, not a documented `en_AU` release. **Inference:** suitable as a fast fixed-voice baseline, not text-designed identities, clone-on-demand or joint dramatic scenes. [Release](https://github.com/OHF-Voice/piper1-gpl/releases/tag/v1.8.0), [voice documentation](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md), [English inventory](https://huggingface.co/rhasspy/piper-voices/tree/main/en).

## Additional major candidates: VoxCPM2, Dia2 and Sesame CSM

These additions change the breadth of the audition. In particular, VoxCPM2 directly addresses a control limitation found in the Qwen design-then-clone route; it should not be buried among legacy baselines.

### VoxCPM2: designed identity and controlled cloning in one model

**Evidence.** Current checkpoint **`openbmb/VoxCPM2`** has a 2B backbone, 30-language support, 48 kHz output and an 8,192-token maximum sequence. Its model card declares **Apache-2.0** and approximately **8 GB VRAM** with BF16. Its performance examples use an RTX 4090, not Peter's GTX 1070. Voice-design/style results can vary across attempts. [Model card](https://huggingface.co/openbmb/VoxCPM2).

The official API examples demonstrate both creating a voice without reference audio and retaining a reference timbre while changing emotion, pace or style. Instructions are placed in parentheses at the beginning of the requested text; `reference_wav_path` supplies identity for controllable cloning. A further continuation mode accepts `prompt_wav_path` plus its transcript. **Inference:** this is a top actor/designer audition because it supplies a documented controllable-cloning capability missing from Qwen Base's ordinary clone interface. [Official design and cloning examples](https://github.com/OpenBMB/VoxCPM#-voice-design).

**Boundary:** the inspected public `_generate` interface accepts one text, one identity reference, and an optional audio/text prompt. It does not expose a speaker-to-reference list or arbitrary conversation history. “Context-aware synthesis” and audio continuation do not establish native jointly generated cast scenes. Parenthesized delivery guidance is also not proof of reliable interpretation of arbitrary nonspoken motives. Test that guidance stays unspoken, that the original words remain intact, and that the same identity survives changes in delivery. [Actual core API](https://github.com/OpenBMB/VoxCPM/blob/main/src/voxcpm/core.py).

**Serving evidence:** upstream offers Python/PyTorch, Nano-vLLM, vLLM-Omni and a linked C++/GGUF path. The latter needs both a BaseLM and acoustic file. **Inference:** try the ordinary implementation on a rented 24 GB GPU before selecting a constrained runtime; benchmark the exact GTX 1070 build separately. No Australian-identity quality or cross-scene fidelity was verified here. [Upstream serving options](https://github.com/OpenBMB/VoxCPM#-production-deployment-nano-vllm).

### Dia2: short streaming conversational generation

**Evidence.** **`nari-labs/Dia2-1B`** and **`nari-labs/Dia2-2B`** generate English dialogue with `[S1]` and `[S2]` tags. Their published limit is **two minutes**, rather than a book-length request. Per-speaker prefix audio can condition a continuation; upstream warns that voices vary without prefixes or fine-tuning. This is evidence for short conversational context, not descriptive character-voice design or a documented private motive channel. [Official repository](https://github.com/nari-labs/dia2).

The 2B card specifies CUDA 12.8+ drivers, BF16 defaults and a CPU fallback. No measured minimum VRAM or GTX 1070 result was established. Its runtime reports timestamps relative to Mimi's frame rate; these need a fidelity check before the reader presents precise word highlighting. Code/model licensing is Apache-2.0, while third-party assets retain their own terms; **Mimi weights are CC-BY-4.0**. [2B card](https://huggingface.co/nari-labs/Dia2-2B), [Mimi license](https://huggingface.co/kyutai/mimi).

**Inference:** include Dia2 for compact two-person dialogue and continuation tests. Narrator plus two characters exceeds the documented two-speaker interface, and splitting a larger cast requires explicitly evaluating the transition cost. Treat the checkpoint's streaming capability separately from maturity of the server: the reviewed card still lists a TTS server as upcoming.

### Sesame CSM-1B: acoustically contextual turns

**Evidence.** **`sesame/csm-1b`** produces a new speaker turn conditioned on previous segments containing **speaker ID, transcript and actual audio**. Without context it can use a random identity. The released checkpoint is not automatically the fine-tuned model behind Sesame's interactive voice demonstration. It declares **Apache-2.0**; its original setup requires access to the Llama-3.2-1B and CSM checkpoints. [Model card](https://huggingface.co/sesame/csm-1b), [upstream setup and contextual examples](https://github.com/SesameAILabs/csm).

The original `generate(text, speaker, context, ...)` implementation resets its cache, explicitly re-encodes preceding segments, and limits combined context/output to **2,048 sequence positions**. Thus it is neither stateless line-by-line TTS nor an API that renders a whole multi-speaker script in one call. Its explicit audio history is particularly relevant to testing whether context repairs detached performances. There is no separate voice-design or free-form motive parameter in that interface. [Generator implementation](https://github.com/SesameAILabs/csm/blob/main/generator.py).

**Hardware/licensing boundary:** the original repository requests CUDA and reports testing CUDA 12.4/12.6, without a dependable minimum VRAM figure. A Transformers implementation also exists. Runtime and codec licenses still need separate accounting, including Mimi's CC-BY weights; an Apache model label is not a license inventory. **Inference:** include CSM as the contextual-turn control against jointly generated TTSD/Higgs/Fish scenes. Australian output and larger-cast stability remain unverified.

## What the evidence changes for Inkwave

**Inference — audition shortlist, not a winner:** VoxCPM2 deserves a leading actor/design slot because it documents both design and controllable cloning. Dia2 and CSM add short-scene and contextual-turn comparisons. Fish S2 Pro and Higgs TTS 2 deserve explicit scene tests; Higgs TTS 3 deserves a current expressive-voice test with its product license kept visible. CosyVoice 3, IndexTTS 2.5 and Chatterbox Turbo/V3 are strong comparison categories for a renderer fed stable character references. Nano provides a meaningful CPU comparison. F5, XTTS and Piper establish older/lighter baselines rather than defining the ceiling. Combine this batch with the separately researched Qwen/MOSS/VibeVoice options before choosing.

**Inference — the GTX 1070 should not set the quality ceiling.** Fish's documented 24 GB target and Higgs 2's recommendation make a 24 GB RTX 3090 or cloud GPU a more sensible audition host for those models. That does not establish that every optimized serving engine supports a 3090, or that a 1070 cannot run a quantized/community variant. Verify runtime/kernel compatibility, complete memory footprint and real speed for the exact build. Index's 6 GB statement and Nano's CPU support identify smaller experiments; neither proves the full novel-production experience. No speed estimate for Peter's hardware is asserted here.

**Inference — the missing director is an application layer.** None of the reviewed standard APIs demonstrates reading an entire novel, discovering the cast and relationships, maintaining a canonical character bible and automatically judging restrained subtext. Implementing that requires a separate analysis/directing pass regardless of the selected voice model. Persist the approved character description, voice reference/seed, pronunciation lexicon and scene constraints. Render a coherent scene or conversational block when the model supports it; avoid reducing every exchange to a separately reset line. Retain precise source offsets independently of actor instructions so narration controls do not rewrite the book.

**Suggested listening gate:** use the same original, short three-person scene for every candidate, with narration, a concealed disagreement, an interruption, a delayed answer, a quiet emotional change and Australian place names. Judge accent authenticity, identity separation and return consistency, timing, restrained intent, pronunciation, omissions/repetitions, and transitions between scenes. Compare the best achievable configuration of each system, recording references/prompts/seeds and failed attempts. Listen blind and level-matched; keep speech error rate and rendering cost alongside listening judgments rather than replacing them.

**Open questions before committing:** which designer best creates convincing Australian identities from text; whether those identities remain stable through a full chapter; how much neighboring audio/history can be carried economically; which candidate generates convincing nonliteral subtext without overacting; actual 3090/1070/CPU throughput and failure rates; and the written licensing route for the public Inkwave demo if a restricted model wins.
