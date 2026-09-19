"""Small, dependency-free audition contract; direction is never spoken text."""
import hashlib
import json
import re

IDENTIFIER = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")
REVISION = re.compile(r"^[0-9a-f]{40}$")


def text_hash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def bundle_hash(bundle):
    return text_hash(json.dumps(bundle, sort_keys=True, ensure_ascii=False, separators=(",", ":")))


def _text(value, label, limit=12000):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError("Invalid " + label)
    if re.search(r"\[S\d+\]|[\x00-\x08\x0b\x0c\x0e-\x1f]", value):
        raise ValueError("Reserved speaker tag or control character in " + label)


def validate_bundle(data):
    if not isinstance(data, dict) or data.get("version") != 1:
        raise ValueError("Expected audition version 1")
    if type(data.get("seed")) is not int or not 0 <= data["seed"] < 2**32:
        raise ValueError("Expected a 32-bit seed")
    models = data.get("models", {})
    for name in ("voice_generator", "dialogue", "audio_tokenizer"):
        item = models.get(name, {})
        if not isinstance(item.get("id"), str) or not REVISION.fullmatch(item.get("revision", "")):
            raise ValueError("Pin the complete model revision: " + name)
    generation = data.get("generation", {})
    if generation.get("dtype") != "bfloat16" or generation.get("attention") != "sdpa":
        raise ValueError("This audition uses BF16 with SDPA")
    seconds = generation.get("max_scene_seconds")
    if type(seconds) not in (int, float) or not 10 <= seconds <= 300:
        raise ValueError("Bound scene duration between 10 and 300 seconds")
    cast = data.get("cast")
    if not isinstance(cast, list) or not 1 <= len(cast) <= 5:
        raise ValueError("MOSS audition requires one to five actors")
    speakers = set()
    for index, actor in enumerate(cast, 1):
        if actor.get("id") != "S" + str(index):
            raise ValueError("Use consecutive cast IDs S1 through S5")
        speakers.add(actor["id"])
        if actor.get("role") not in ("narrator", "character"):
            raise ValueError("Unknown cast role")
        for key in ("name", "voice_prompt", "reference_text"):
            _text(actor.get(key), "cast " + key, 2000)
    scenes = data.get("scenes")
    if not isinstance(scenes, list) or not 1 <= len(scenes) <= 10:
        raise ValueError("Expected one to ten short audition scenes")
    scene_ids = set()
    for scene in scenes:
        scene_id = scene.get("id", "")
        if not IDENTIFIER.fullmatch(scene_id) or scene_id in scene_ids:
            raise ValueError("Invalid or duplicate scene ID")
        if scene.get("continuation_of") and scene["continuation_of"] not in scene_ids:
            raise ValueError("Continuation must refer to an earlier scene")
        scene_ids.add(scene_id)
        _text(scene.get("title"), "scene title", 200)
        turns = scene.get("turns")
        if not isinstance(turns, list) or not 1 <= len(turns) <= 80:
            raise ValueError("Expected bounded dialogue turns")
        for turn in turns:
            if turn.get("speaker") not in speakers:
                raise ValueError("Unknown speaker")
            _text(turn.get("text"), "spoken turn", 4000)
        if len(scene_script(scene)) > 20000:
            raise ValueError("Audition scene too long")
    return data


def scene_script(scene):
    """Exact user-visible words with MOSS speaker markers, no motive annotations."""
    return "\n".join("[" + turn["speaker"] + "]" + turn["text"] for turn in scene["turns"])
