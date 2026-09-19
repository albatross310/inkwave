#!/usr/bin/env python3
"""Pinned, resumable MOSS audition. --check/--dry-run never import ML or download.

API reference audited at OpenMOSS/MOSS-TTS commit below. Downloaded checkpoint
code is pinned independently; codec_path prevents an implicit download of main.
This runner generates candidates. It does not certify accent, transcript or acting.
"""
from __future__ import annotations

import argparse
import contextlib
import gc
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import random
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone

UPSTREAM_REVISION = "934d6826b084c46a0d033402174d5f8ac4ed2519"
PINNED_MODELS = {
    "voice_generator": {"id": "OpenMOSS-Team/MOSS-VoiceGenerator", "revision": "97521ec2b6f3ec5026ac1f5751f8fc302d82c2d4"},
    "dialogue": {"id": "OpenMOSS-Team/MOSS-TTSD-v1.0", "revision": "c7cd852d87aff71cab5bd2b9b05509cedc0ef1ba"},
    "audio_tokenizer": {"id": "OpenMOSS-Team/MOSS-Audio-Tokenizer", "revision": "3cd226ba2947efa357ef453bcad111b6eafba782"},
}
WEIGHT_FILES = {
    "voice_generator": {
        "model.safetensors": (4228278872, "dbe345257ff9f6cc84195bed830a268b39d5e0b728ff3ba90e715150a49b16d4"),
    },
    "dialogue": {
        "model-00001-of-00004.safetensors": (4932667368, "ad8bb115b6c87c902c76e7a4ef90a6eee98041a87f741fcd163fbe81d855d87a"),
        "model-00002-of-00004.safetensors": (4915961640, "7cb9641e2f25651a43bc7f681337d79ab57ca50d63355660787712fcee393c40"),
        "model-00003-of-00004.safetensors": (4983069760, "646b345809967a41308d95afcf5af233ae94de7997befac287017af602c59687"),
        "model-00004-of-00004.safetensors": (1879339648, "ab0a0ed173b7a86a8cb16b82ca981ad0f1866c2c2d0ecb47c97e72b68ccbaba6"),
    },
    "audio_tokenizer": {
        "model-00001-of-00002.safetensors": (4998259168, "037f441ed30a0ab59f6049de83b824a1b3bd6feb7dbd46c3fbca41fc2f649f28"),
        "model-00002-of-00002.safetensors": (2100202560, "a187d73d2cda1c2d0676586d9d03c09c0a5813450266af32029c871493fc9582"),
    },
}
RECOMMENDED_FREE_DISK_BYTES = 70_000_000_000
PACKAGES = ("torch", "torchaudio", "transformers", "huggingface-hub", "accelerate", "safetensors", "numpy", "soundfile", "psutil")


def canonical_bytes(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def value_hash(value):
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def text_hash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def implementation_identity():
    directory = Path(__file__).parent
    return {"runner_sha256": file_hash(__file__), "contract_sha256": file_hash(directory / "contract.py"),
            "requirements_sha256": file_hash(directory / "requirements.txt"), "model_lock_sha256": file_hash(directory / "models.lock.json")}


def verify_model_lock():
    with Path(__file__).with_name("models.lock.json").open(encoding="utf-8") as stream:
        lock = json.load(stream)
    if lock.get("upstream_commit") != UPSTREAM_REVISION:
        raise ValueError("The upstream revision differs between model lock and runner.")
    for role, model in PINNED_MODELS.items():
        locked = lock.get("models", {}).get(role, {})
        if any(locked.get(key) != value for key, value in model.items()):
            raise ValueError("Model lock revision differs from the audited runner.")
        files = {entry["path"]: (entry["bytes"], entry["sha256"]) for entry in locked.get("files", [])}
        if files != WEIGHT_FILES[role]:
            raise ValueError("Model weight hashes differ between lock and runner.")


def seed_for(seed, identity):
    return int.from_bytes(hashlib.sha256(f"{seed}:{identity}".encode()).digest()[:4], "big")


def package_versions():
    versions = {}
    for package in PACKAGES:
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = None
    return versions


def inspect_machine():
    """Read-only CPU-safe check: never imports torch or contacts a model server."""
    result = {"platform": platform.platform(), "python": platform.python_version(), "packages": package_versions(),
              "recommended_gpu_vram_gb": 48, "model_weight_bytes": sum(size for group in WEIGHT_FILES.values() for size, _ in group.values()),
              "recommended_free_disk_bytes": RECOMMENDED_FREE_DISK_BYTES, "models": PINNED_MODELS, "gpus": []}
    executable = shutil.which("nvidia-smi")
    if executable:
        checked = subprocess.run([executable, "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10, check=False)
        if checked.returncode == 0:
            for line in checked.stdout.splitlines():
                fields = [field.strip() for field in line.split(",")]
                if len(fields) == 3:
                    result["gpus"].append({"name": fields[0], "vram_mib": fields[1], "driver": fields[2]})
    result["ready_for_gpu_check"] = bool(result["gpus"] and result["packages"]["torch"])
    return result


def load_bundle(path):
    verify_model_lock()
    if Path(path).stat().st_size > 2_000_000:
        raise ValueError("The audition bundle is too large.")
    with Path(path).open(encoding="utf-8") as stream:
        bundle = json.load(stream)
    # Root-owned contract enforces safe IDs, references and exact source text.
    from contract import validate_bundle
    bundle = validate_bundle(bundle)
    if bundle.get("models") != PINNED_MODELS:
        raise ValueError("Bundle models must match this runner's audited checkpoint IDs and revisions.")
    return bundle


def scene_script(scene):
    # Only exact spoken spans enter the speech input; context/persona never do.
    from contract import scene_script as compile_script
    return compile_script(scene)


def build_plan(bundle):
    return {"version": 1, "action": "dry_run", "downloads": False, "model_execution": False,
            "bundle_sha256": value_hash(bundle), "models": PINNED_MODELS, "upstream_revision": UPSTREAM_REVISION,
            "references": [{"id": actor["id"], "seed": seed_for(bundle["seed"], "reference:" + actor["id"]),
                            "source_sha256": text_hash(actor["reference_text"]), "instruction_sha256": text_hash(actor["voice_prompt"])} for actor in bundle["cast"]],
            "scenes": [{"id": scene["id"], "seed": seed_for(bundle["seed"], "scene:" + scene["id"]),
                        "source_sha256": text_hash(scene_script(scene)), "spoken_characters": sum(len(t["text"]) for t in scene["turns"]),
                        "continuation_of": scene.get("continuation_of"),
                        "conditioning": "cast_references_and_previous_scene_audio" if scene.get("continuation_of") else "cast_references",
                        "nonspoken_context_sent_to_ttsd": False} for scene in bundle["scenes"]],
            "quality_status": "not_generated", "recommended_gpu_vram_gb": 48}


def atomic_json(path, value):
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def verify_saved_record(output, record):
    root = Path(output).resolve()
    path = (root / record["path"]).resolve()
    if not path.is_relative_to(root) or not path.is_file() or file_hash(path) != record["sha256"]:
        raise ValueError("A saved audition recording is missing or corrupt. Nothing was replaced; use a new output directory.")
    if record.get("hit_token_limit"):
        raise ValueError("A saved candidate reached its generation limit. Review it and use a new output directory for another take.")
    return path


def open_manifest(output, bundle):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    path = output / "manifest.json"
    identity = {"bundle_sha256": value_hash(bundle), **implementation_identity(), "models": PINNED_MODELS}
    if path.exists():
        with path.open(encoding="utf-8") as stream:
            manifest = json.load(stream)  # A corrupt manifest is not an empty run.
        if any(manifest.get(key) != value for key, value in identity.items()):
            raise ValueError("Existing audition identity differs. Keep its outputs and choose a new output directory.")
        for record in list(manifest["references"].values()) + manifest["scenes"]:
            if record.get("path"):
                verify_saved_record(output, record)
        return manifest
    if any(item.name != ".runner.lock" for item in output.iterdir()):
        raise ValueError("Output directory contains files without a manifest. Nothing was replaced; choose an empty directory.")
    manifest = {"version": 1, **identity, "created_at": utc_now(), "upstream_revision": UPSTREAM_REVISION,
                "status": "prepared", "quality_status": "not_reviewed", "hardware": inspect_machine(),
                "references": {}, "cast": [dict(actor) for actor in bundle["cast"]],
                "scenes": [dict(scene, status="pending") for scene in bundle["scenes"]], "stage_metrics": {}, "events": [],
                "limitations": ["No transcript, accent, speaker identity or acting-quality certification.",
                                "TTSD receives speaker tags and acoustic references, not private motive/context instructions.",
                                "Generated candidates have no verified word timings."]}
    atomic_json(path, manifest)
    return manifest


class Measurement:
    """Process RSS sampled while torch tracks allocator peaks; includes model load."""
    def __init__(self, torch):
        import psutil
        self.torch = torch
        self.process = psutil.Process()
        self.peak_rss = 0
        self.stop = threading.Event()

    def _sample(self):
        while not self.stop.is_set():
            self.peak_rss = max(self.peak_rss, self.process.memory_info().rss)
            self.stop.wait(0.05)

    def __enter__(self):
        self.torch.cuda.synchronize()
        self.torch.cuda.reset_peak_memory_stats()
        self.started = time.monotonic()
        self.thread = threading.Thread(target=self._sample, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *_):
        with contextlib.suppress(Exception):
            self.torch.cuda.synchronize()
        self.stop.set()
        self.thread.join(timeout=2)
        self.metrics = {"wall_seconds": time.monotonic() - self.started, "process_peak_rss_bytes": self.peak_rss,
                        "gpu_peak_allocated_bytes": self.torch.cuda.max_memory_allocated(),
                        "gpu_peak_reserved_bytes": self.torch.cuda.max_memory_reserved()}


def download_snapshots(cache_dir=None, offline=False):
    from huggingface_hub import snapshot_download
    snapshots = {}
    for role, model in PINNED_MODELS.items():
        snapshots[role] = Path(snapshot_download(repo_id=model["id"], revision=model["revision"], cache_dir=cache_dir,
                                               local_files_only=offline,
                                               allow_patterns=["*.json", "*.py", "*.safetensors", "*.txt", "*.jinja", "README.md", "LICENSE*"]))
        for filename, (size, checksum) in WEIGHT_FILES[role].items():
            path = snapshots[role] / filename
            if not path.is_file() or path.stat().st_size != size or file_hash(path) != checksum:
                raise ValueError(f"Pinned weight integrity check failed: {role}/{filename}")
    return snapshots


class MossRuntime:
    def __init__(self, snapshots, generation):
        import torch
        import soundfile
        import numpy
        from transformers import AutoModel, AutoProcessor
        self.torch, self.sf, self.np = torch, soundfile, numpy
        self.AutoModel, self.AutoProcessor = AutoModel, AutoProcessor
        self.snapshots, self.generation = snapshots, generation
        self.model = self.processor = None
        self.role = None
        torch.backends.cuda.enable_cudnn_sdp(False)
        torch.backends.cuda.enable_flash_sdp(True)
        torch.backends.cuda.enable_mem_efficient_sdp(True)
        torch.backends.cuda.enable_math_sdp(True)

    def unload(self):
        self.model = self.processor = None
        self.role = None
        gc.collect()
        self.torch.cuda.empty_cache()
        self.torch.cuda.synchronize()

    def load(self, role):
        self.unload()
        path = str(self.snapshots[role])
        arguments = {"trust_remote_code": True, "local_files_only": True, "codec_path": str(self.snapshots["audio_tokenizer"])}
        if role == "voice_generator":
            arguments["normalize_inputs"] = False
        self.processor = self.AutoProcessor.from_pretrained(path, **arguments)
        # Keep codec FP32 as published; changing codec precision is a separate audition.
        self.processor.audio_tokenizer = self.processor.audio_tokenizer.to("cuda").eval()
        self.model = self.AutoModel.from_pretrained(path, trust_remote_code=True, local_files_only=True,
                                                   attn_implementation=self.generation.get("attention", "sdpa"),
                                                   torch_dtype=self.torch.bfloat16).to("cuda").eval()
        self.role = role

    @property
    def sample_rate(self):
        return int(self.processor.model_config.sampling_rate)

    def read_audio(self, path):
        audio, sample_rate = self.sf.read(str(path), dtype="float32", always_2d=True)
        waveform = self.torch.from_numpy(audio.mean(axis=1)).unsqueeze(0)
        if sample_rate != self.sample_rate:
            import torchaudio.functional
            waveform = torchaudio.functional.resample(waveform, sample_rate, self.sample_rate)
        return waveform

    def _generate(self, conversation, mode, seed, maximum_seconds):
        random.seed(seed)
        self.np.random.seed(seed)
        self.torch.manual_seed(seed)
        self.torch.cuda.manual_seed_all(seed)
        batch = self.processor([conversation], mode=mode)
        inputs = batch["input_ids"].to("cuda")
        masks = batch["attention_mask"].to("cuda")
        downsample = int(self.processor.audio_tokenizer.config.downsample_rate)
        steps = math.ceil(maximum_seconds * self.sample_rate / downsample) + int(self.processor.model_config.n_vq) + 8
        context_limit = int(self.model.config.language_config.max_position_embeddings)
        if inputs.shape[1] + steps > context_limit:
            raise ValueError("The complete acoustic prefix and requested scene exceed this checkpoint's context; no truncation was performed.")
        parameters = {"max_new_tokens": steps, "audio_temperature": 1.1, "audio_top_p": 0.9, "audio_top_k": 50, "audio_repetition_penalty": 1.1}
        if self.role == "voice_generator":
            parameters.update(audio_temperature=1.5, audio_top_p=0.6)
        with self.torch.inference_mode():
            outputs = self.model.generate(input_ids=inputs, attention_mask=masks, **parameters)
            hit_limit = any(int(codes.shape[0]) - int(start) >= steps for start, codes in outputs)
            decoded = self.processor.decode(outputs)
        if len(decoded) != 1 or decoded[0] is None or not decoded[0].audio_codes_list:
            raise ValueError("The model returned no complete recording. No automatic retry was made.")
        clips = decoded[0].audio_codes_list
        if len(clips) != 1:
            raise ValueError("The model returned multiple audio segments unexpectedly; no silent concatenation was performed.")
        audio = clips[0].detach().float().cpu().numpy().reshape(-1)
        if not audio.size or not self.np.isfinite(audio).all():
            raise ValueError("The model returned empty or non-finite audio.")
        duration = audio.size / self.sample_rate
        return audio, {"sample_rate": self.sample_rate, "duration_seconds": duration, "seed": seed,
                       "hit_token_limit": hit_limit, "exceeds_duration_limit": duration > maximum_seconds + 1,
                       "input_sequence_positions": int(inputs.shape[1]), "max_new_tokens": steps,
                       "generation_parameters": parameters, "transcript_verified": False, "word_timings_verified": False,
                       "quality_status": "generated_needs_review"}

    def reference(self, actor, seed, maximum_seconds=30):
        user = self.processor.build_user_message(text=actor["reference_text"], instruction=actor["voice_prompt"])
        return self._generate([user], "generation", seed, maximum_seconds)

    def scene(self, cast, scene, references, history, seed, maximum_seconds):
        waveforms = [self.read_audio(references[actor["id"]]) for actor in cast]
        reference_codes = self.processor.encode_audios_from_wav(waveforms, sampling_rate=self.sample_rate)
        prefix_texts = [f"[{actor['id']}]{actor['reference_text']}" for actor in cast]
        for earlier_scene, earlier_path in history:
            prefix_texts.append(scene_script(earlier_scene))
            waveforms.append(self.read_audio(earlier_path))
        prefix_waveform = self.torch.cat(waveforms, dim=-1)
        prefix_codes = self.processor.encode_audios_from_wav([prefix_waveform], sampling_rate=self.sample_rate)[0]
        full_text = "\n".join(prefix_texts + [scene_script(scene)])
        conversation = [self.processor.build_user_message(text=full_text, reference=reference_codes),
                        self.processor.build_assistant_message(audio_codes_list=[prefix_codes])]
        # Mirrors upstream continuation: decode() trims the supplied acoustic prefix.
        return self._generate(conversation, "continuation", seed, maximum_seconds)


def candidate_identity(bundle, kind, item, dependencies):
    return value_hash({"bundle_sha256": value_hash(bundle), **implementation_identity(),
                       "kind": kind, "id": item["id"], "dependencies": dependencies})


def recover_candidate(output, kind, identity, expected):
    directory = Path(output) / kind / identity
    if not directory.exists():
        return None
    with (directory / "record.json").open(encoding="utf-8") as stream:
        record = json.load(stream)
    if record.get("candidate_identity") != expected:
        raise ValueError("An existing candidate belongs to a different request. It was not replaced.")
    verify_saved_record(output, record)
    return record


def publish_candidate(output, kind, identity, waveform, record, sf):
    """Publish WAV+metadata together, then the manifest may safely catch up."""
    parent = Path(output) / kind
    parent.mkdir(parents=True, exist_ok=True)
    destination = parent / identity
    if destination.exists():
        raise ValueError("Candidate already exists; no recording was overwritten.")
    staging = Path(tempfile.mkdtemp(prefix=".pending-", dir=parent))
    try:
        wav = staging / "audio.wav"
        sf.write(str(wav), waveform, record["sample_rate"], format="WAV", subtype="PCM_16")
        with wav.open("rb") as stream:
            os.fsync(stream.fileno())
        relative = f"{kind}/{identity}/audio.wav"
        record = {**record, "path": relative, "audio": relative, "sha256": file_hash(wav),
                  "bytes": wav.stat().st_size, "created_at": utc_now(), "status": "generated_needs_review",
                  "audio_seconds": record["duration_seconds"], "render_seconds": record["metrics"]["wall_seconds"]}
        atomic_json(staging / "record.json", record)
        staging.rename(destination)
        return record
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def check_candidate_bounds(record):
    if record["hit_token_limit"] or record["exceeds_duration_limit"]:
        raise ValueError("The candidate reached its token/duration limit. Its recording was saved for review; no continuation or automatic retry was attempted.")


def acoustic_history(scene, by_id, completed, output):
    ids = []
    previous = scene.get("continuation_of")
    while previous:
        if previous in ids:
            raise ValueError("Cyclic scene continuation.")
        ids.append(previous)
        previous = by_id[previous].get("continuation_of")
    history = []
    for identity in reversed(ids):
        if identity not in completed:
            raise ValueError("Generate the preceding scene before its acoustic continuation.")
        history.append((by_id[identity], verify_saved_record(output, completed[identity])))
    return history


def append_event(manifest, event, **details):
    manifest["events"].append({"at": utc_now(), "event": event, **details})
    # Identifiers and metrics only in process logs; source prose stays in the bundle/manifest.
    print(json.dumps({"event": event, **details}, ensure_ascii=False), flush=True)


def run_audition(bundle, output, snapshots, stage="all"):
    import torch
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    import fcntl  # The runnable GPU bootstrap intentionally targets Linux.
    with (output / ".runner.lock").open("a+") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("Another process owns this audition output directory.") from error
        manifest = open_manifest(output, bundle)
        manifest["hardware"] = inspect_machine()
        manifest["title"] = bundle.get("title", "MOSS audition")
        manifest["source"] = bundle.get("source", "")
        manifest["direction"] = "Context and personas are retained for listening review. TTSD receives only spoken scripts, speaker identities and acoustic prefixes."
        manifest["hardware"]["torch_cuda"] = torch.version.cuda
        manifest["hardware"]["gpu"] = {"name": torch.cuda.get_device_name(), "capability": list(torch.cuda.get_device_capability()),
                                             "total_memory_bytes": torch.cuda.get_device_properties(0).total_memory}
        manifest["snapshots"] = {role: {"id": PINNED_MODELS[role]["id"], "revision": PINNED_MODELS[role]["revision"],
                                       "weights_verified_sha256": {name: checksum for name, (_, checksum) in WEIGHT_FILES[role].items()}}
                                 for role in snapshots}
        manifest["status"] = "running"
        atomic_json(output / "manifest.json", manifest)
        runtime = MossRuntime(snapshots, bundle["generation"])
        started = time.monotonic()
        try:
            for actor in bundle["cast"]:
                identity = actor["id"]
                expected = candidate_identity(bundle, "references", actor, {})
                record = manifest["references"].get(identity) or recover_candidate(output, "references", identity, expected)
                if record is None:
                    if stage == "scenes":
                        raise ValueError("The scenes stage requires all character references to be generated first.")
                    if runtime.role != "voice_generator":
                        with Measurement(torch) as load_measurement:
                            runtime.load("voice_generator")
                        manifest["stage_metrics"]["voice_generator_load"] = load_measurement.metrics
                    append_event(manifest, "reference_started", id=identity)
                    atomic_json(output / "manifest.json", manifest)
                    with Measurement(torch) as measurement:
                        waveform, metadata = runtime.reference(actor, seed_for(bundle["seed"], "reference:" + identity))
                    metadata.update({"metrics": measurement.metrics, "candidate_identity": expected,
                                     "hardware": manifest["hardware"],
                                     "source_sha256": text_hash(actor["reference_text"]), "instruction_sha256": text_hash(actor["voice_prompt"]),
                                     "peak_amplitude": float(abs(waveform).max()), "pcm16_clip_samples": int((abs(waveform) > 1).sum())})
                    record = publish_candidate(output, "references", identity, waveform, metadata, runtime.sf)
                    del waveform
                manifest["references"][identity] = record
                for row in manifest["cast"]:
                    if row["id"] == identity:
                        row.update(record)
                append_event(manifest, "reference_saved", id=identity, audio_seconds=record["duration_seconds"])
                atomic_json(output / "manifest.json", manifest)
                check_candidate_bounds(record)
            runtime.unload()
            if stage != "references":
                by_id = {scene["id"]: scene for scene in bundle["scenes"]}
                completed = {scene["id"]: scene for scene in manifest["scenes"] if scene.get("path")}
                references = {actor["id"]: verify_saved_record(output, manifest["references"][actor["id"]]) for actor in bundle["cast"]}
                reference_hashes = {identity: record["sha256"] for identity, record in manifest["references"].items()}
                for scene in bundle["scenes"]:
                    identity = scene["id"]
                    history = acoustic_history(scene, by_id, completed, output)
                    history_hashes = {earlier["id"]: completed[earlier["id"]]["sha256"] for earlier, _ in history}
                    dependencies = {"references": reference_hashes, "previous_scenes": history_hashes}
                    expected = candidate_identity(bundle, "scenes", scene, dependencies)
                    record = completed.get(identity) or recover_candidate(output, "scenes", identity, expected)
                    if record is None:
                        if runtime.role != "dialogue":
                            with Measurement(torch) as load_measurement:
                                runtime.load("dialogue")
                            manifest["stage_metrics"]["dialogue_load"] = load_measurement.metrics
                        append_event(manifest, "scene_started", id=identity, continuation_of=scene.get("continuation_of"))
                        atomic_json(output / "manifest.json", manifest)
                        with Measurement(torch) as measurement:
                            waveform, metadata = runtime.scene(bundle["cast"], scene, references, history,
                                                               seed_for(bundle["seed"], "scene:" + identity), bundle["generation"]["max_scene_seconds"])
                        metadata.update({"metrics": measurement.metrics, "candidate_identity": expected,
                                         "hardware": manifest["hardware"],
                                         "source_sha256": text_hash(scene_script(scene)), "dependencies": dependencies,
                                         "spoken_source_sha256": text_hash("\n".join(turn["text"] for turn in scene["turns"])),
                                         "continuation_of": scene.get("continuation_of"),
                                         "conditioning": "cast_references_and_previous_scene_audio" if history else "cast_references",
                                         "nonspoken_context_sent_to_ttsd": False, "prefix_transcripts_verified": False,
                                         "peak_amplitude": float(abs(waveform).max()), "pcm16_clip_samples": int((abs(waveform) > 1).sum())})
                        record = publish_candidate(output, "scenes", identity, waveform, metadata, runtime.sf)
                        del waveform
                    completed[identity] = record
                    for row in manifest["scenes"]:
                        if row["id"] == identity:
                            row.update(record)
                    append_event(manifest, "scene_saved", id=identity, audio_seconds=record["duration_seconds"])
                    atomic_json(output / "manifest.json", manifest)
                    check_candidate_bounds(record)
            manifest["status"] = "references_generated_needs_review" if stage == "references" else "generated_needs_review"
            manifest["quality_status"] = "not_reviewed"
            append_event(manifest, "generation_finished", status=manifest["status"])
        except BaseException as error:
            manifest["status"] = "interrupted" if isinstance(error, (KeyboardInterrupt, SystemExit)) else "failed"
            manifest["failure"] = {"type": type(error).__name__, "message": str(error)[:1500], "at": utc_now()}
            raise
        finally:
            manifest["metrics"] = {"this_run_wall_seconds": time.monotonic() - started,
                                   "references_saved": len(manifest["references"]),
                                   "scenes_saved": sum(bool(row.get("path")) for row in manifest["scenes"])}
            manifest["updated_at"] = utc_now()
            atomic_json(output / "manifest.json", manifest)
            runtime.unload()
        return manifest


def gpu_preflight():
    if platform.system() != "Linux":
        raise RuntimeError("Real audition execution targets the prepared Linux GPU host; use --check or --dry-run on this computer.")
    if sys.version_info[:2] not in {(3, 11), (3, 12)}:
        raise RuntimeError("Use Python 3.11 or 3.12 with bootstrap.sh.")
    versions = package_versions()
    if versions["transformers"] != "5.0.0" or versions["torch"] != "2.9.1+cu128":
        raise RuntimeError("Use bootstrap.sh's pinned torch/transformers environment for this audition.")
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError("No CUDA GPU is available. No model download or inference was started.")
    major, _ = torch.cuda.get_device_capability()
    if major < 8 or not torch.cuda.is_bf16_supported():
        raise RuntimeError("This BF16 audition needs an Ampere-or-newer GPU; it is not the GTX 1070 compatibility experiment.")
    return torch


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--check", action="store_true", help="CPU-safe environment inspection; no model imports or downloads")
    action.add_argument("--dry-run", action="store_true", help="Validate bundle and show hashed plan; no model imports or downloads")
    action.add_argument("--run", action="store_true", help="Generate audition candidates on the prepared GPU")
    action.add_argument("--download-only", action="store_true", help="Explicitly download and verify pinned weights on the prepared GPU host")
    parser.add_argument("--bundle", type=Path, default=Path(__file__).with_name("audition.json"))
    parser.add_argument("--output", "--out", type=Path)
    parser.add_argument("--cache-dir", type=Path)
    parser.add_argument("--offline", action="store_true", help="Require cached snapshots; refuse network downloads")
    parser.add_argument("--stage", choices=("references", "scenes", "all"), default="all")
    args = parser.parse_args(argv)
    if args.check:
        print(json.dumps(inspect_machine(), ensure_ascii=False, indent=2))
        return 0
    bundle = load_bundle(args.bundle)
    if args.dry_run:
        print(json.dumps(build_plan(bundle), ensure_ascii=False, indent=2))
        return 0
    if args.run and args.output is None:
        parser.error("--run requires an explicit --output directory")
    gpu_preflight()  # Fail on CPU/unsupported GPU before touching model downloads.
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    if args.offline:
        os.environ["HF_HUB_OFFLINE"] = "1"
    snapshots = download_snapshots(str(args.cache_dir) if args.cache_dir else None, args.offline)
    if args.download_only:
        print(json.dumps({"status": "weights_verified", "models": PINNED_MODELS,
                          "weight_bytes": sum(size for group in WEIGHT_FILES.values() for size, _ in group.values()),
                          "inference_started": False}, indent=2))
        return 0
    manifest = run_audition(bundle, args.output, snapshots, args.stage)
    print(json.dumps({"status": manifest["status"], "manifest": str(args.output / "manifest.json"), "quality_verified": False}))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"status": "error", "type": type(error).__name__, "message": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
