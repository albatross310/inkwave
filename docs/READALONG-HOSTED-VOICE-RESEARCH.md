# Hosted voice options for directed, multi-character audiobooks

Checked **15 September 2026** against the linked official documentation and the benchmark publisher. This is research, not an implementation or a listening audition. Prices are USD. Existing reader code and tests were not changed for this research.

## Decision

**ElevenLabs provides the closest documented match to “describe a cast, then direct their performances”: Voice Design creates identities from prose descriptions, and Eleven v3 Text to Dialogue accepts a sequence of named voice IDs.** This is a capability judgment, not a claim that its audio is universally best. SpeechifyAI deserves a separate audition because its current API price is low and Simba 3.2 has a strong result in an independent listening benchmark, but its public-app contract restrictions require attention. OpenAI's text-to-speech API is another useful audition candidate; it is not interchangeable with ChatGPT's live voice experience. Sources and qualifications follow.

None of these reviewed hosted APIs supplies downloadable model weights or establishes a right to self-host the proprietary engine. Buying generated audio or API access does not make the model itself ours. Open-weight alternatives need a separate hardware, license and quality assessment.

## What “GPT voice” means

There are several distinct products:

- **ChatGPT Voice:** the current desktop documentation describes a GPT-Live-powered conversational interface for Chat, Work and Codex. Its subscription usage is a product allowance, not a license or API quota for an Inkwave audiobook renderer. [ChatGPT Voice](https://learn.chatgpt.com/docs/features/voice)
- **GPT-Live API (`gpt-live-1`):** a full-duplex voice frontend that delegates work to a separately chosen backend. It is built for continuing a conversation while an agent works. This is not the `/audio/speech` file-rendering endpoint. [GPT-Live guide](https://developers.openai.com/api/docs/guides/live)
- **Realtime API:** current published models include `gpt-realtime-2.1` and `gpt-realtime-2.1-mini`. These combine speech with conversational reasoning. Their audio prices differ from their text-token prices. [Realtime 2.1](https://developers.openai.com/api/docs/models/gpt-realtime-2.1), [Realtime 2.1 Mini](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini)
- **Text-to-speech API:** `gpt-4o-mini-tts`, with a listed snapshot `gpt-4o-mini-tts-2025-12-15`, is the directly relevant API for rendering a supplied manuscript into audio. Older `tts-1` and `tts-1-hd` remain documented. [Mini TTS model](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts), [speech endpoint](https://developers.openai.com/api/reference/cli/resources/audio/subresources/speech/methods/create)

Do not infer that an audiobook made with Mini TTS will sound like the particular voice Peter hears in ChatGPT. That needs an actual matched audition.

## Control and character voices

### OpenAI

Mini TTS accepts a separate `instructions` field controlling delivery, including accent, emotional range, intonation, speed and tone. The built-in voice is still selected separately. The guide recommends `marin` and `cedar` for quality; that recommendation is OpenAI's, not an independent ranking. End users must be told the speech is AI-generated. [Text-to-speech guide](https://developers.openai.com/api/docs/guides/text-to-speech)

The speech request has **one voice**, text input and optional instructions; it does not expose a cast of voice IDs or a conversation-history field. Input is limited to 4,096 characters by the endpoint, and the Mini TTS model page separately lists 2,000 input tokens. `instructions` is unsupported by `tts-1` and `tts-1-hd`. **Inference:** a multi-character audiobook would use separate passages with stable voice assignments, reapplying relevant direction to every request. [Speech endpoint](https://developers.openai.com/api/reference/cli/resources/audio/subresources/speech/methods/create)

Custom voices require an audio reference **and** a matching recorded consent statement; access is limited to eligible customers through sales. The current guide lists at most 20 voices per organization and samples no longer than 30 seconds. This is an approved voice-replication workflow, not a documented text-only character-voice design service. It also points to a separate Text-to-Speech Supplemental Agreement. [Custom voices](https://developers.openai.com/api/docs/guides/custom-voices)

Realtime can retain conversation context, but its session reference says the voice cannot be changed after the first audio response. **Inference:** a single persistent Realtime session is therefore an awkward cast-switching mechanism. Conversational context is useful for an interactive character, but it does not itself guarantee exact manuscript reading or audiobook continuity. [Realtime session reference](https://developers.openai.com/api/reference/resources/realtime/subresources/sessions/methods/create)

### ElevenLabs

**Voice Design** creates three candidates from a prose description, then saves a chosen candidate as a reusable voice. Descriptions can specify age, regional accent, timbre, pacing and character. Preview generation has a cost; saved voices use voice slots. The provider explicitly describes design quality as variable and experimental. [Voice Design](https://elevenlabs.io/docs/eleven-creative/voices/voice-design)

**Eleven v3 Text to Dialogue** generates a sequence of text/voice-ID pairs together. Its documentation supports multiple speakers and expressive non-speech events, while warning that several generations can be necessary. It recommends keeping the combined dialogue text at or below 2,000 characters per request for reliable generation. **Inference:** this is shared scene context, not a whole-novel directing memory; the application must manage chapter and scene boundaries. [Dialogue guide](https://elevenlabs.io/docs/overview/capabilities/text-to-dialogue), [dialogue request schema](https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert)

V3 uses audio tags for emotional delivery. Its stability settings trade expressiveness against consistency; the most creative setting is explicitly more prone to hallucinations. Voice selection still matters, and a tag cannot reliably transform an unsuitable voice into the desired performance. Multilingual v2 is positioned for stable long-form speech; general TTS documentation offers previous/next text or request IDs for continuity. [V3 direction guidance](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices), [TTS continuity guidance](https://elevenlabs.io/docs/overview/capabilities/text-to-speech)

**Documentation discrepancy:** the Voice Design FAQ says v3 does not support Professional Voice Clones, while the prompting guide says they are not fully optimized and can have lower clone quality. Both argue against assuming that “premium clone” automatically improves v3. Verify the actual voice/model combination before buying or choosing a production cast. [Voice Design FAQ](https://elevenlabs.io/docs/help-center/product/voices/voice-design/what-is-voice-design), [prompting guide](https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices)

### Speechify: consumer reader and developer API are different

The consumer **Free** plan advertises ten robotic voices and playback up to 1.5×. Consumer **Premium** advertises 1,000+ natural voices, 60+ languages and a displayed monthly price of **$29**. That does not identify the exact model behind every voice or provide API access to build our own reader. Studio is another separate product. [Consumer pricing](https://speechify.com/pricing/), [Studio pricing](https://speechify.com/pricing-studio/)

The current API recommends **`simba-3.2` for English**; `simba-3.0` is the default and supports English plus six European-language locales. A **September 8, 2026** changelog supersedes older July restrictions: Simba 3.2 now accepts every English catalog voice and the workspace's own English clones without the earlier individual enablement. Some pages already announce legacy-model retirement dated September 21, which is **future-dated relative to this report**. [Models](https://docs.speechify.ai/build/guides/concepts/models), [September 8 change](https://docs.speechify.ai/build/changelog/2026/9/8)

Speechify exposes SSML controls for pitch, rate, breaks, emphasis and thirteen named emotions. These are explicit performance controls rather than a documented global natural-language director prompt. The speech endpoint takes one `voice_id`; no text-only new-voice-design or multi-speaker cast endpoint was found in the reviewed API documentation. **Inference:** use separate speaker turns and application-managed direction. A single completed speech request accepts up to 2,000 characters; the documentation directs longer content to streaming. [SSML](https://docs.speechify.ai/docs/ssml), [speech endpoint](https://docs.speechify.ai/tts/api-reference/text-to-speech/audio/speech)

## Comparable pricing: one 100,000-word book

Assumptions for arithmetic: **600,000 text characters**, or **625 spoken minutes at 160 words/minute**. Actual character counts, speaking speed, tokenization, pauses and retakes vary. These figures exclude tax, cast auditions, regeneration, direction/planning models, transcription/alignment, storage and delivery. They are not quality-adjusted quotes.

| Product/model | Verified billing unit | Cost for the assumed book |
|---|---|---|
| ElevenAPI `eleven_v3` or Multilingual v2 | $0.10 per 1,000 characters | **$60** generation usage |
| ElevenAPI Flash/Turbo or v3 Conversational | $0.05 per 1,000 characters | **$30** generation usage; different models, not a quality-equivalent discount |
| SpeechifyAI API Free | 500,000 characters/month; pauses at limit | Does **not** fit a 600,000-character book in one month |
| SpeechifyAI API Starter | $10/month includes 1.9M characters; then $10/M | **$10 monthly purchase covers this book** within allowance; $6 is the marginal usage at its overage rate, not the required subscription payment |
| OpenAI `tts-1` | $15/M characters | **$9** |
| OpenAI `tts-1-hd` | $30/M characters | **$18** |
| OpenAI `gpt-4o-mini-tts` | $0.60/M input text tokens **plus $12/M output audio tokens** | Exact book cost requires measured audio-token usage; formula below |
| OpenAI `gpt-realtime-2.1` | Audio input $32/M, audio output $64/M; text input $4/M, text output $24/M | About **$48 audio-output component only** for 625 minutes, plus text/context/input charges |
| OpenAI `gpt-realtime-2.1-mini` | Audio input $10/M, audio output $20/M; text input $0.60/M, text output $2.40/M | About **$15 audio-output component only**, plus text/context/input charges |
| OpenAI `gpt-live-1` | $0.05 per active session minute, backend billed separately | **$31.25 for 625 active minutes**, plus backend; this is session arithmetic, not an audiobook-rendering quote |

Rate sources: [ElevenAPI](https://elevenlabs.io/pricing/api), [SpeechifyAI API](https://speechify.ai/pricing), [OpenAI TTS-1](https://developers.openai.com/api/docs/models/tts-1), [TTS-1 HD](https://developers.openai.com/api/docs/models/tts-1-hd), [Mini TTS](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts), [Realtime 2.1](https://developers.openai.com/api/docs/models/gpt-realtime-2.1), [Realtime Mini](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini), [OpenAI pricing](https://developers.openai.com/api/docs/pricing).

Mini TTS formula: `0.60 × input_text_tokens / 1,000,000 + 12 × output_audio_tokens / 1,000,000`. At an explicitly approximate four characters per input token, the manuscript input alone is about **$0.09**; that is **not the speech-generation price**. The often repeated `$0.015/minute` estimate was not present in the currently fetched pricing page, including its full Markdown table, so it is not treated as a freshly verified rate here.

For the Realtime calculations, official cost documentation gives assistant audio as one token per 50 milliseconds: `625 × 60 × 20 = 750,000 output audio tokens`. It also explains that conversation history becomes input on subsequent turns. Do not transfer this tokenizer assumption to Mini TTS without measurement. GPT-Live charges active session time even during silence/backend work. [Voice cost accounting](https://developers.openai.com/api/docs/guides/voice-latency-cost)

Eleven's **API dollar pricing** must not be confused with **ElevenCreative credit subscriptions**. The current API page explicitly says API usage is billed in dollars, whereas the consumer creative page still lists credit allowances. Older help pages describe the earlier common-credit arrangement. Check the account's actual billing page when migrating an existing integration. [API pricing](https://elevenlabs.io/pricing/api), [Creative pricing](https://elevenlabs.io/pricing)

## What comparative quality evidence establishes

Artificial Analysis's **Provider Voice Arena**, fetched September 15, compares each provider's native voices. Selected entries from the same published table:

| Model | Elo | Published 95% interval | Samples |
|---|---:|---:|---:|
| Speechify Simba 3.2 | 1237 | ±14 | 2464 |
| Eleven v3 | 1168 | ±11 | 4487 |
| Speechify Simba 3.0 | 1118 | ±12 | 2611 |
| OpenAI TTS-1 HD | 1107 | ±12 | 3580 |
| Eleven Multilingual v2 | 1094 | ±10 | 7323 |
| Kokoro 82M v1.0 | 1061 | ±11 | 5296 |

These results support auditioning Simba 3.2 rather than dismissing Speechify based on its consumer free voices. They **do not** measure a directed 100,000-word Australian audiobook, stable designed characters across chapters, or audiobook editing effort. Available accent filters are US/UK. Provider voices also vary, so the comparison includes voice selection. No matching Mini TTS, GPT-Live 1 or Realtime 2.1 entry was identified; an older Realtime score cannot stand in for them. [Primary benchmark table](https://artificialanalysis.ai/text-to-speech/leaderboard/provider-voice)

## Public-app and redistribution implications

- **OpenAI:** the TTS documentation requires an AI-voice disclosure. Custom voices have eligibility/consent requirements and additional agreement terms. The reviewed developer pages do not establish blanket rights to resell custom voice identities or export models; those rights remain an account-contract question. [TTS disclosure](https://developers.openai.com/api/docs/guides/text-to-speech), [custom-voice requirements](https://developers.openai.com/api/docs/guides/custom-voices)
- **ElevenLabs:** paid-plan generation has commercial-output rights; free-plan output is noncommercial and requires attribution. The use policy separately restricts unauthorized resale/sublicensing of the service. Output rights and operating a public API-backed application are distinct from reselling provider access. Manuscript rights must also be held. [Billing/license guidance](https://elevenlabs.io/docs/overview/administration/billing), [use policy](https://elevenlabs.io/use-policy)
- **SpeechifyAI:** current API pricing explicitly includes commercial use on Free. However, published API supplemental terms §1.4 allow external users to generate/download output from **customer-provided voice samples**, while prohibiting an app from letting those users upload their own samples. They require AI disclosure and explicit speaker consent. Section 1.5 additionally restricts competing products, voice-model training from outputs, and cloning its generated voices through other services. Those clauses are materially relevant to an Inkwave reader with user-created voices; the low price does not resolve them. Confirm the applicable commercial agreement before public deployment. Consumer Premium is not a substitute for API terms. [API pricing](https://speechify.ai/pricing), [API supplemental terms](https://speechify.com/terms-ai-voice-api/)

## Suggested comparison before further implementation

**Inference/design recommendation:** audition a fixed, roughly ten-minute scene with a narrator and two characters, using only original or licensed text. Test quiet narration, restrained irony, emotional transitions, interruptions, proper nouns and the same character returning after a scene break. Compare Eleven v3 with designed voices, Speechify Simba 3.2 with selected/consented voices, Mini TTS with explicit instructions, and the proposed self-hosted candidate. Blind the labels and keep the first take as well as any selected retake; record total generation cost and corrections needed.

For global direction, keep a separate cast-and-direction document: stable voice IDs, narrator style, character motives, scene state, pronunciation rules and permitted emotional changes. Compile that into each provider's supported controls. Keep the source manuscript unchanged; rendering tags and directions belong in a derived request representation with source-offset mapping. A strong voice engine does not replace this coordination layer, and none of the reviewed endpoints establishes reliable whole-book directing from one prompt.
