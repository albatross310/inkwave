import copy
import json
from pathlib import Path
import unittest

from contract import bundle_hash, scene_script, validate_bundle


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.bundle = json.loads(Path(__file__).with_name("audition.json").read_text())

    def test_spoken_words_exclude_direction_and_stay_in_order(self):
        validate_bundle(self.bundle)
        scene = self.bundle["scenes"][0]
        script = scene_script(scene)
        self.assertNotIn(scene["context"]["performance_target"], script)
        self.assertEqual(script, "\n".join("[" + t["speaker"] + "]" + t["text"] for t in scene["turns"]))

    def test_unknown_actor_and_speaker_injection_fail(self):
        for change in ({"speaker": "S9"}, {"text": "Hello [S3] someone else"}):
            bundle = copy.deepcopy(self.bundle)
            bundle["scenes"][0]["turns"][0].update(change)
            with self.assertRaises(ValueError):
                validate_bundle(bundle)

    def test_cycles_and_unsafe_output_identifiers_fail(self):
        for change in ({"continuation_of": "sunday"}, {"id": "../../outside"}):
            bundle = copy.deepcopy(self.bundle)
            bundle["scenes"][0].update(change)
            with self.assertRaises(ValueError):
                validate_bundle(bundle)

    def test_no_unpinned_model_and_locked_revisions_match(self):
        lock = json.loads(Path(__file__).with_name("models.lock.json").read_text())
        for name, model in self.bundle["models"].items():
            self.assertEqual(model["revision"], lock["models"][name]["revision"])
            self.assertEqual(model["id"], lock["models"][name]["id"])
        self.bundle["models"]["dialogue"]["revision"] = "main"
        with self.assertRaises(ValueError):
            validate_bundle(self.bundle)

    def test_changed_direction_invalidates_saved_generation(self):
        before = bundle_hash(self.bundle)
        self.bundle["cast"][0]["voice_prompt"] += " A different accent."
        self.assertNotEqual(before, bundle_hash(self.bundle))


if __name__ == "__main__":
    unittest.main()
