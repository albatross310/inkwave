# Inkwave MOSS audition

Status: prepared for a rented Linux GPU. **No MOSS recordings have been generated yet.**
Local checks and mock browser/cloud tests do not establish voice quality or GPU compatibility.

The first audition creates three original Australian voice candidates, then renders
an original family conversation and a warmer continuation. It uses
[MOSS VoiceGenerator](https://huggingface.co/OpenMOSS-Team/MOSS-VoiceGenerator) for
the actors and [MOSS-TTSD](https://huggingface.co/OpenMOSS-Team/MOSS-TTSD-v1.0) for
continuous scenes. All model revisions and weight checksums are pinned.

## What this tests

- Narrator, Mara and Daniel sound like different people.
- Voice descriptions produce credible Australian accents and useful personalities.
- A complete exchange has believable timing and restrained emotional delivery.
- The continuation preserves the cast while the relationship becomes warmer.
- Spoken words remain faithful to the script, without omissions or additions.
- Measured render time and GPU memory support a decision about the next deployment.

Character personas and scene direction are visible review material. The adapter does
**not** claim that TTSD consumes arbitrary hidden motive instructions. The speech input
contains the exact source words and speaker IDs. Scene two additionally receives the
previous scene's text and audio as a continuation prefix. This mechanism is implemented
against the upstream API; its dramatic effectiveness still needs listening tests.

## Run locally without buying or downloading anything

From the Inkwave repository:

```sh
python3 tools/readalong-moss/model_runner.py --dry-run --bundle tools/readalong-moss/audition.json
python3 -m unittest discover -s tools/readalong-moss -p 'test_*.py'
node tests/readalong/moss-review.browser.mjs
```

`review.html` can be opened directly. Choose `audition.json` to inspect the cast and
script; audio stays marked **Not yet generated**. Generated outputs can later be
loaded as a folder, or as a manifest plus its WAV files. No third-party requests,
synthetic progress bar, inferred word timing, or automatic quality certification.

## Rented GPU execution

`launch.py` is **read-only by default**: validates the bundle and requests a live
quote for one Secure Cloud RTX A6000 with 48 GB VRAM. No account key is needed.

```sh
python3 tools/readalong-moss/launch.py
```

Observed 15 September 2026: GPU US$0.53/hour, plus an estimated US$0.0125/hour for
20 GB container and 70 GB volume storage. Two hours estimates US$1.085; the live
quote is checked again before creation. Inventory and prices can change.

Once the owner has approved the account and spend, the explicit paid command is:

```sh
python3 tools/readalong-moss/launch.py --create --hours 2 --max-usd 5 \
  --work-dir /private/tmp/inkwave-moss-audition-01 --prompt-key
```

Run this in an interactive terminal to enter the Runpod API key privately. It is held
only for the run, stripped from worker callbacks, and never uploaded to the GPU.
An existing `RUNPOD_API_KEY` environment variable also works without `--prompt-key`.
Account creation, account credit and funding are not automated. No account top-up
or automatic replacement GPU is attempted.

The launcher creates a dedicated SSH key in the private work directory, requests the
pinned official image, waits for SSH, uploads only the allowlisted synthetic audition
files, installs the isolated runtime and downloads the pinned model weights. The
voice designer is unloaded before the larger dialogue model is loaded. Completed
recordings are checkpointed with hashes. It downloads audio and logs, verifies their
checksums, stops the GPU, then deletes the rented Pod only after the backup is verified.
On macOS, `caffeinate` keeps the supervisor awake during this operation.

The two-hour deadline includes provisioning, installation and download time, with
five minutes reserved for backup. **This is a local watchdog, not a provider-enforced
spending cap.** Losing the local process or cloud API access can prevent shutdown;
inspect the Runpod console if a stop cannot be confirmed. A failed backup retains
the stopped volume so recordings are not lost, and retained storage may still bill.
An uncertain creation is recorded and never blindly retried.

Outputs are under `WORK_DIR/artifacts/output/`; supervisor state and the SSH key stay
outside that folder. `backup-manifest.json` proves the download, while the nested
`output/manifest.json` contains the listening review. Keep the work directory private
and do not share its SSH key. After confirmed Pod deletion the key is no longer useful.

The cloud creation, SSH transfer, CUDA execution and actual teardown remain untested
until an authorized cloud account is available. Source and mock tests cannot prove them.

## Direct Linux GPU execution

For an already-provisioned 48 GB GPU with an appropriate NVIDIA driver, Python 3.11
or 3.12, and at least 70 GB free before setup:

```sh
cd tools/readalong-moss
bash bootstrap.sh
.venv/bin/python model_runner.py --dry-run --bundle audition.json
.venv/bin/python model_runner.py --run --bundle audition.json --output /workspace/audition-output
```

Optional runner stages allow reference generation before scenes. Existing matching
outputs resume; changed scripts/model identities or corrupt recordings fail without
overwriting the old run. Reproducible inputs and seeds do not promise bit-identical
waveforms across different GPU kernels or library versions.

## After the audition

Listen before spending on a whole book. Mark transcript errors, accent drift, character
confusion, unnatural turn gaps and melodramatic readings in the review page. Measure
render time per finished minute, including failed takes. If the main candidate fails,
use the same script for VoxCPM2 rather than relaxing the user's quality requirements.

The public Inkwave integration comes after this decision: Vercel submits book/scene
jobs to durable storage, GPU workers claim them, and completed audio is stored for
ordinary browser playback. Stable character IDs carry voice references, personas and
dialogue colours across chapters. The reader's whole-book analysis, voice casting,
direction, forced alignment, GPU queue and automatic scale-up are **not implemented
by this audition folder**. See `docs/READALONG-DIRECTED-NARRATION-SPEC.md` for that scope.
