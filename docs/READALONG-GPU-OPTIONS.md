# Read along: short GPU rentals versus buying an RTX 3090

Prepared **15 September 2026, Australia/Brisbane**. Prices were checked around 00:10 AEST,
with the larger-GPU update around 00:20 AEST (14 September UTC). Research only: no GPU was
purchased, reserved, rented or deployed.

**Recommendation: choose and audition the model before choosing a GPU to buy.** For occasional
book-production sessions and a public demo with a few users, rent for a bounded session, export
completed audio, then terminate the worker. The scene-generation front-runner is now
**MOSS-VoiceGenerator followed by MOSS-TTSD**, with Chatterbox Turbo and Qwen3-TTS as comparisons.
Start the MOSS audition conservatively on **48 GB**, running its stages sequentially. A GPU runs
the generation; ordinary client machines play and
cache the resulting audio. Narration quality, character consistency and acceptable cost per book
have not yet been established by a benchmark.

## Currency and comparison basis

The RBA's latest published observation available during this check was **14 September 2026:
A$1 = US$0.7149**, so **US$1 = approximately A$1.3988**. AUD conversions below use that observation;
card conversion margins and any applicable tax are additional. These are planning conversions,
not a checkout quote. [RBA exchange rates](https://www.rba.gov.au/statistics/frequency/exchange-rates.html)

Every hourly figure means **billable GPU/worker runtime, not an hour of finished narration**.
Different GPUs can take different times to produce the same audio. A cheaper GPU-hour is not
automatically cheaper per accepted chapter.

## The scene model changes the hardware decision

MOSS-VoiceGenerator designs voices from descriptions; MOSS-TTSD generates multi-speaker dialogue.
Use the former to establish reusable cast voices, unload it, then load TTSD to render the scene.
**VoiceGenerator uses a Qwen3-1.7B backbone; TTSD uses Qwen3-8B.** Live Hugging Face configuration
and checkpoint metadata checked during this update showed approximately **2.114B total parameters /
4.228 GB weight files** for VoiceGenerator and **8.355B / 16.711 GB** for TTSD, with BF16 weights.
Those are parameter/file measurements, not peak GPU memory; the two models should not both be
described as 8B. [VoiceGenerator configuration](https://huggingface.co/OpenMOSS-Team/MOSS-VoiceGenerator/resolve/main/config.json),
[VoiceGenerator checkpoint metadata](https://huggingface.co/api/models/OpenMOSS-Team/MOSS-VoiceGenerator?blobs=true),
[TTSD configuration](https://huggingface.co/OpenMOSS-Team/MOSS-TTSD-v1.0/resolve/main/config.json),
[TTSD checkpoint metadata](https://huggingface.co/api/models/OpenMOSS-Team/MOSS-TTSD-v1.0?blobs=true)

The proposed **48 GB first audition is a conservative engineering choice, not a measured minimum
or a promise that arbitrary-length scenes fit**. Its purpose is to evaluate voice/scene quality
before spending effort on memory reduction. Running the two stages sequentially avoids holding both
models simultaneously. A 24 GB short-scene trial remains unverified. The upstream statement that an
8B model can fit an 8 GB GPU describes its **MOSS-TTS GGUF/llama.cpp pipeline**; it does not establish
that TTSD or VoiceGenerator run in 8 GB, or that the same quantized path preserves scene quality.
[MOSS llama.cpp release notes and backend](https://github.com/OpenMOSS/MOSS-TTS)

**A cheap RTX 3090 is not a bargain for this project if the accepted scene pipeline does not fit
its 24 GB.** The ownership arithmetic below is conditional on proving that it can run the selected
model at acceptable quality and throughput.

### Larger GPU rentals for the first MOSS audition

| Option | GPU / VRAM | USD per running hour | Approx. AUD per running hour | Evidence |
|---|---|---:|---:|---|
| Vast on-demand offer 50121681 | RTX A6000 / 48 GB | $0.4806 including 30 GB runtime disk | $0.672 | Live single-GPU offer, Virginia US, sampled 2026-09-14 14:20:01 UTC |
| Vast on-demand offer 24964752 | L40S / 48 GB class | $0.6056 including 30 GB runtime disk | $0.847 | Live single-GPU offer, Japan, sampled 14:20:02 UTC; API reports 46,068 MB usable GPU RAM |
| Runpod on-demand Pod | RTX A6000 / 48 GB | $0.53 | $0.741 | Advertised compute rate; disk extra |
| Runpod on-demand Pod | L40S / 48 GB | $1.09 | $1.525 | Advertised compute rate; disk extra |
| Runpod on-demand Pod | A100 PCIe or SXM / 80 GB | $1.59 | $2.224 | Optional additional memory margin; not required by a verified benchmark |

Vast used the same verified/rentable/not-rented/single-GPU/reliability>=0.99 on-demand filters
described below, with 30 GB allocated storage and the stated GPU names. A6000 returned $0.466667
compute + $0.013889 disk/hour; L40S returned $0.600000 + $0.005556. Transfer and retained disk remain
additional considerations. These offers were not reserved. [Vast search API](https://docs.vast.ai/api-reference/search/search-offers)
Runpod figures were rechecked on its [pricing page](https://www.runpod.io/pricing).

For illustration, two *billable* hours would cost about A$1.48 of Runpod A6000 compute or A$1.69
at the observed Vast L40S running quote. Neither figure predicts how much finished dialogue two
hours can produce. Start with A6000 for low-cost memory headroom, or compare L40S throughput once
the pipeline is functional; don't rent 80 GB merely because it is listed here.

## Rental options for short sessions

| Option | GPU / VRAM | Observed USD per running hour | Approx. AUD per running hour | Best use / qualification |
|---|---|---:|---:|---|
| Vast on-demand, US offer 41028911 | RTX 3090 / 24 GB | $0.1574 including 20 GB disk during runtime | $0.220 | Lowest directly observed comparable-card quote; individual host offer, bandwidth extra |
| Runpod on-demand Pod | RTX A5000 / 24 GB | $0.27 | $0.378 | Low-cost modern CUDA experiment; benchmark its throughput |
| Runpod on-demand Pod | RTX 3090 / 24 GB | $0.50 | $0.699 | Direct hardware comparison with buying a 3090 |
| Runpod on-demand Pod | RTX 4090 / 24 GB | $0.74 | $1.035 | Faster-generation candidate; only a benchmark establishes value |
| Runpod Flex serverless | L4 / A5000 / 3090 class, 24 GB | $0.69 advertised rounded hourly rate | $0.965 | Sporadic queued demo jobs; scale to zero, pay higher running rate |
| Modal serverless | L4 / 24 GB | $0.7992 GPU alone | $1.118 GPU alone | Convenient Python deployment and automatic scaling; CPU/RAM billed separately |
| Modal serverless | A10 / 24 GB | $1.1016 GPU alone | $1.541 GPU alone | Another modern 24 GB option; CPU/RAM additional |

Runpod's [current pricing page](https://www.runpod.io/pricing) supplies its rows. The on-demand
figures are also identified as Secure Cloud rates in its dated [buy-versus-rent guide](https://www.runpod.io/articles/guides/ai-server-cost).
Treat them as advertised rates, not a reservation of an available machine in a chosen region.

Modal lists L4 at $0.000222/second and A10 at $0.000306/second. Its CPU rate is
$0.0000131 per physical core/second and RAM $0.00000222 per GiB/second. Thus an illustrative
L4 allocation with **two physical CPU cores and 8 GiB RAM** totals about **US$0.9575 / A$1.3393
per running hour**, before storage/egress. Starter has no fixed subscription and advertises
$30/month compute credit; the comparison above deliberately does not subtract promotional credit.
[Modal pricing](https://modal.com/pricing)

### Direct Vast quote and reproducibility

At **2026-09-14T14:10:22.527Z**, an unauthenticated, read-only POST to Vast's documented
`https://console.vast.ai/api/v0/bundles/` search returned HTTP 200. Filters: `gpu_name=RTX 3090`,
`num_gpus=1`, `verified=true`, `rentable=true`, `rented=false`, `reliability2>=0.99`,
`type=on-demand`, `allocated_storage=20`, sorted by `dph_total` ascending. No rental endpoint was called.

US offer **41028911** reported 24,576 MB GPU RAM, $0.133333/hour GPU plus $0.024074/hour disk,
total **$0.157407/hour**, and reliability score 0.9940002. A Yunnan, China offer **35580413**
was slightly cheaper at $0.152222/hour including the same requested disk. These are specific
marketplace snapshots, not universal prices or independently verified host guarantees.
The US quote's storage rate was $0.866667/GB/month: keeping 20 GB for a whole month would be
about **US$17.33 / A$24.25**, before any stopped-instance adjustment. Cheap compute can have
expensive retained storage. [Vast search API](https://docs.vast.ai/api-reference/search/search-offers)

Vast bills compute by the second, storage while the instance exists, and host-specific data
transfer charges. Stopping compute does not stop disk charges; deleting an instance stops its
storage bill but also removes that instance's data. Export completed audio first. On-demand and
interruptible are different products; the observed quote above is **on-demand**.
[Vast instance pricing](https://docs.vast.ai/guides/instances/pricing)

### Interruptible pricing and idle costs

Runpod advertises spot capacity subject to eviction and says its UI/API provides the current
quote. No specific currently purchasable spot quote was verified here. Its RTX 3090 marketing
page also displays **$0.22/hour Community Cloud**, but does not establish that as a current
interruptible offer. Do not label $0.22 a verified spot rate. For the first model comparison,
use on-demand; consider interruptible only after completed passages survive worker interruption.
[Runpod spot description](https://www.runpod.io/product/cloud-gpus),
[3090 marketing page](https://www.runpod.io/gpu-models/rtx-3090)

Runpod Pods bill by the second. Its documented volume disk costs $0.10/GB/month while running
and $0.20 while stopped; a network volume below 1 TB costs $0.07/GB/month and survives Pod deletion.
For example, keeping 100 GB of network storage costs **US$7 / A$9.79 per month** even between sessions.
Container disk is temporary and lost on stop. On-demand startup requires at least an hour's
credit balance, which is a balance requirement rather than a one-hour billing increment.
[Runpod billing/storage](https://docs.runpod.io/pods/pricing)

Flex removes the need to keep a GPU running continuously. However, Runpod's pricing documentation
includes model loading, execution and the configured active idle timeout in billable time.
Its worker-state documentation distinguishes non-billed image/cached-model preparation from
runtime loading. Measure the actual billed startup of the chosen image; do not assume every
cold-start second is free. [Serverless billing](https://docs.runpod.io/serverless/pricing),
[worker lifecycle](https://docs.runpod.io/serverless/workers/overview)

Modal similarly has cold-start queueing and model initialization. Keeping containers warm trades
cost for latency; storing model weights ahead of time or using snapshots can reduce repeated
loading. There is no measured cold-start duration for this project yet. For book pre-rendering,
batching several passages in one warm session makes more sense than repeatedly starting a worker
for each sentence. [Modal cold starts](https://modal.com/docs/guide/cold-start),
[Modal billing](https://modal.com/docs/guide/billing)

## Buying a 3090 in Australia

Direct seller pages observed during this check:

| Listing | Displayed asking price | What was actually established |
|---|---:|---|
| [ASUS ROG Strix RTX 3090, eBay item 327355921839](https://www.ebay.com.au/itm/327355921839) | A$2,246.70 | Used; seller in Padstow Heights, Australia; Buy It Now; page updated 14 September 2026 |
| [MSI Ventus RTX 3090, eBay item 327347917083](https://www.ebay.com.au/itm/327347917083) | A$2,291.99 | Used; same Australian seller; Buy It Now; page updated 14 September 2026 |
| [Gigabyte RTX 3090 refurbished, Newegg/Corn Electronics](https://www.newegg.com/global/au-en/gigabyte-geforce-rtx-3090-24gb-graphics-card/p/1FT-000A-005E4) | A$2,363.90 plus A$31.99 displayed shipping | GST-inclusive price; ships from Hong Kong; marketplace refurbisher, not local manufacturer warranty |

These are asking prices, **not completed-sale values, a market median, inspected hardware or buying
recommendations**. The eBay shipping estimate was for postcode 2000, not Brisbane; obtain a Brisbane
total before comparing landed cost. Search-page and item-page prices differed slightly; the table
uses the direct item pages. A PCCG refurbished listing was discontinued and a UN Tech full-PC listing
was sold out, so neither supplies an available-card bargain. No new 24 GB card is recommended from
this narrow search.

These few listings are not representative evidence for a typical used/private-market price.
A further narrow search did not establish a current, inspectable Australian A$900/A$1,200 card;
old forum anecdotes, unrelated listing text and overseas prices were excluded. The sensitivity
calculation therefore uses **A$900, A$1,200 and A$2,250 as hypothetical card-only inputs**, not market
claims. The highest input happens to be close to one observed ask; it is not the sole basis for
the rental recommendation.
The existing Windows 11 Pro desktop has not been inspected for PSU capacity, connectors, case
clearance or cooling. Necessary upgrades belong in the purchase cost. Ownership can also buy
convenience, local processing and resale value; it adds maintenance, heat and hardware-failure risk.

## Break-even arithmetic

Assumptions, not measured electricity figures: total working system draw **350–500 W**, energy
price **A$0.30/kWh**, giving **A$0.105–0.150 per local running hour**. This excludes the desktop's
idle electricity between jobs, cooling, repairs, finance, resale and any upgrades.

```text
local_running_cost_AUD_per_hour = system_kW × electricity_AUD_per_kWh
break_even_hours = purchase_AUD / (cloud_AUD_per_hour − local_running_cost_AUD_per_hour)
```

Use this simple formula only for equal useful throughput. With different GPUs, normalize cloud
cost to the same amount of work first: `cloud_rate × cloud_hours / local_hours`. A non-positive
denominator means ownership never repays its purchase through electricity savings under those
assumptions. Fixed storage, transfer and setup time require a fuller monthly comparison.

| Hypothetical card purchase | Break-even versus Runpod 3090 at A$0.6994/hour | Break-even versus observed Vast 3090 at A$0.2202/hour |
|---|---:|---:|
| A$900 | **1,514–1,638 GPU hours** | **7,814–12,824 GPU hours** |
| A$1,200 | **2,019–2,184 GPU hours** | **10,418–17,099 GPU hours** |
| A$2,250 | **3,785–4,095 GPU hours** | **19,534–32,060 GPU hours** |

At 100 useful GPU hours/month, the Runpod comparison becomes roughly **15–16, 20–22 or 38–41 months**,
respectively. At 20 hours/month those payback periods are five times longer. These assume the local
3090 and rented 3090 deliver equivalent useful throughput and that the chosen model fits.

At just **20 running hours/month**, Runpod 3090 compute is about **A$13.99/month**, and the observed
Vast running quote about **A$4.40/month**, before retained-storage and transfer costs. Those numbers
favour renting for intermittent experiments across the illustrated purchase prices. They are not
predictions of future GPU prices or availability. If Peter finds a tested card much cheaper, replace
the purchase input; the required hours scale directly with that price.

Cost per book needs measurement:

```text
book_cost = director_LLM_cost
          + worker_rate × (startup_hours + generation_hours + rerender_hours + active_idle_hours)
          + storage + transfer + tax/payment_conversion
```

No hours-per-book or cost-per-finished-audio-hour estimate is defensible yet. Record render speed,
peak VRAM, cold/warm startup, pronunciation errors and rejected takes on the intended models.

## A production plan for the book and its cast

This is a proposed design, not implemented functionality. A book-level director should first build
a stable cast and pronunciation guide, then map the original prose to narrator/character segments.
Each character gets a saved voice reference and persona/delivery profile. Keep exact source text
separate from delivery metadata and flag uncertain speaker attribution for review. Different cast
members need different saved profiles; they do not inherently require a separate always-running
GPU or a full model copy per character.

A shared TTS worker can render the segments sequentially with the same model and different voice
prompts, checkpoint each accepted passage, and feed the existing cached-audio UI. Persist the job
and output outside the worker, key caches by exact text/model/voice/delivery version, and resume
from the last completed passage after shutdown. Public demo requests should join a bounded queue;
the expensive GPU can be off while users replay completed books. Budget the director's LLM analysis
separately from TTS generation.

Alongside the scene-first MOSS audition, compare **Chatterbox Turbo** (MIT, reference-voice cloning) and
**Qwen3-TTS 0.6B/1.7B Base** (Apache-2.0, reference audio plus transcript) on the same short scene.
Include narration, two speakers, Australian names/place names, numbers and a later-chapter reprise
to test consistency. Qwen's 1.7B VoiceDesign is another route to an original described voice;
neither model's documentation guarantees a convincing Australian result or ElevenLabs-equivalent
long-form quality. [Chatterbox](https://github.com/resemble-ai/chatterbox),
[Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS)

Start MOSS on a modern 48 GB rental; 24 GB is a separate option for the smaller comparison models.
The current 1070 remains available for a separate compatibility experiment. Buy a 3090 only after
the audition is accepted, the selected pipeline has actually been shown to fit 24 GB, monthly
measured usage justifies the investment at the real purchase price, and desktop upgrade cost is
known. Renting a larger/faster card for occasional jobs can remain useful even if a local card is
eventually purchased.
