"""No-account tests for lifecycle, startup bounds, spending and backup guards.

Run: python3 -m unittest discover -s tools/readalong-moss -p 'test_cloud_runpod.py'
All cloud APIs are mocked; no paid resource can be created by this suite.
"""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

import cloud_runpod as cloud


class CloudTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state_path = self.root / "state.json"
        self.artifacts = self.root / "artifacts"
        self.artifacts.mkdir()
        for name in ("job.py", "backup.py"):
            (self.root / name).touch()
        (self.root / "key.pub").write_text("ssh-ed25519 AAAATEST synthetic")
        self.args = types.SimpleNamespace(state=str(self.state_path), artifacts=str(self.artifacts),
            job_program=str(self.root / "job.py"), backup_program=str(self.root / "backup.py"),
            ssh_public_key=str(self.root / "key.pub"), max_usd=5, hours=2, image="synthetic:image")
        self.offer = {"gpuUSDPerHour": .53, "estimatedUSD": 1.085,
                      "stockStatus": "Low", "availableGpuCounts": None}
        self.pod = {"id": "fixturepod", "costPerHr": .5425, "desiredStatus": "RUNNING",
                    "publicIp": "203.0.113.20", "portMappings": {"22": 22123}}

    def backup(self, bad_hash=False):
        (self.artifacts / "sample.wav").write_bytes(b"synthetic-wave")
        # Actual audition manifest must coexist with the supervisor's verification manifest.
        (self.artifacts / "manifest.json").write_text('{"audition":"fixture"}')
        files = [{"path": name, "sha256": hashlib.sha256((self.artifacts / name).read_bytes()).hexdigest()}
                 for name in ("sample.wav", "manifest.json")]
        if bad_hash:
            files[0]["sha256"] = "bad"
        (self.artifacts / "backup-manifest.json").write_text(json.dumps({"podId": "fixturepod", "files": files}))

    def lifecycle(self, *, bad_hash=False, job_exit=0, balance=100, readiness_error=False):
        events = []
        def api(url, method="GET", payload=None, key=None, **kwargs):
            events.append(method)
            self.assertEqual(key, "synthetic-account-key")
            if method == "POST":
                self.assertEqual(payload["ports"], ["22/tcp"])
                self.assertEqual(payload["gpuTypeIds"], [cloud.GPU_ID])
                self.assertNotIn("synthetic-account-key", json.dumps(payload))
                return dict(self.pod, publicIp=None, portMappings={})
            return self.pod
        def endpoint(*args):
            events.append("ready")
            if readiness_error:
                raise RuntimeError("Startup timed out")
            state = args[3]
            state["pod"] = self.pod
            cloud.write_state(self.state_path, state)
        def callback(program, state, directory, pod_id, seconds):
            events.append(program.name)
            self.assertGreater(seconds, 0)
            self.assertLessEqual(seconds, 7200)
            if program.name == "job.py":
                saved = json.loads(self.state_path.read_text())["pod"]
                self.assertEqual(saved["portMappings"]["22"], 22123)
                self.assertEqual(saved["publicIp"], "203.0.113.20")
                return job_exit
            self.backup(bad_hash)
            return 0
        def stop(*args):
            events.append("STOP")
            return True
        with patch.object(cloud, "request", side_effect=api), \
             patch.object(cloud, "graphql", return_value={"myself": {"clientBalance": balance}}), \
             patch.object(cloud, "wait_for_ssh", side_effect=endpoint), \
             patch.object(cloud, "callback", side_effect=callback), \
             patch.object(cloud, "stop", side_effect=stop), contextlib.redirect_stdout(io.StringIO()):
            try:
                cloud.run(self.args, self.offer, "synthetic-account-key")
                error = None
            except RuntimeError as exception:
                error = exception
        if self.state_path.exists():
            self.assertNotIn("synthetic-account-key", self.state_path.read_text())
        return events, error

    def test_endpoint_is_persisted_before_job_and_delete_follows_backup_stop(self):
        events, error = self.lifecycle()
        self.assertIsNone(error)
        self.assertEqual(events.count("POST"), 1)
        self.assertLess(events.index("ready"), events.index("job.py"))
        self.assertLess(events.index("backup.py"), events.index("STOP"))
        self.assertLess(events.index("STOP"), events.index("DELETE"))
        self.assertEqual(json.loads((self.artifacts / "manifest.json").read_text()), {"audition": "fixture"})

    def test_corrupt_backup_stops_without_deleting(self):
        events, error = self.lifecycle(bad_hash=True)
        self.assertIsNotNone(error)
        self.assertIn("STOP", events)
        self.assertNotIn("DELETE", events)

    def test_failed_job_still_backs_up_then_stops(self):
        events, error = self.lifecycle(job_exit=1)
        self.assertIsNotNone(error)
        self.assertLess(events.index("backup.py"), events.index("STOP"))

    def test_failed_startup_never_launches_job_and_still_stops(self):
        events, error = self.lifecycle(readiness_error=True)
        self.assertIsNotNone(error)
        self.assertNotIn("job.py", events)
        self.assertIn("STOP", events)

    def test_budget_rejection_cannot_create(self):
        self.args.max_usd = .5
        events, error = self.lifecycle()
        self.assertIsNotNone(error)
        self.assertEqual(events, [])

    def test_low_credit_cannot_create(self):
        events, error = self.lifecycle(balance=0)
        self.assertIsNotNone(error)
        self.assertEqual(events, [])

    def test_readiness_waits_for_both_ip_and_ssh_mapping(self):
        clock = [1000.0]
        state = {"pod": None}
        pending = [dict(self.pod, publicIp=None, portMappings={}),
                   dict(self.pod, portMappings={}), self.pod]
        with patch.object(cloud.time, "time", side_effect=lambda: clock[0]), \
             patch.object(cloud.time, "monotonic", side_effect=lambda: clock[0]), \
             patch.object(cloud.time, "sleep", side_effect=lambda seconds: clock.__setitem__(0, clock[0]+seconds)), \
             patch.object(cloud, "request", side_effect=pending) as api:
            cloud.wait_for_ssh("fixturepod", "key", self.state_path, state, 2000)
        self.assertEqual(api.call_count, 3)
        self.assertEqual(clock[0], 1010)
        saved = json.loads(self.state_path.read_text())
        self.assertEqual(saved["phase"], "ssh_endpoint_ready")
        self.assertEqual(saved["pod"]["portMappings"]["22"], 22123)

    def test_readiness_respects_remaining_session_budget(self):
        clock = [1000.0]
        with patch.object(cloud.time, "time", side_effect=lambda: clock[0]), \
             patch.object(cloud.time, "monotonic", side_effect=lambda: clock[0]), \
             patch.object(cloud.time, "sleep", side_effect=lambda seconds: clock.__setitem__(0, clock[0]+seconds)), \
             patch.object(cloud, "request", return_value=dict(self.pod, portMappings={})) as api:
            with self.assertRaisesRegex(RuntimeError, "readiness timed out"):
                cloud.wait_for_ssh("fixturepod", "key", self.state_path, {}, 1307)
        self.assertEqual(clock[0], 1007)
        self.assertEqual(api.call_count, 2)
        self.assertLessEqual(api.call_args.kwargs["timeout"], 2)

    def test_readiness_rejects_a_different_pod(self):
        with patch.object(cloud, "request", return_value=dict(self.pod, id="wrongpod")):
            with self.assertRaisesRegex(RuntimeError, "did not identify"):
                cloud.wait_for_ssh("fixturepod", "key", self.state_path, {}, cloud.time.time()+600)

    def test_audition_manifest_alone_is_never_backup_proof(self):
        (self.artifacts / "manifest.json").write_text('{"podId":"fixturepod","files":[]}')
        with self.assertRaises(FileNotFoundError):
            cloud.verify_backup(self.artifacts, "fixturepod")

    def test_backup_pod_binding_and_path_escape(self):
        for pod_id, name in [("differentpod", "sample.wav"), ("fixturepod", "../escape"), ("fixturepod", "/etc/passwd")]:
            (self.artifacts / "backup-manifest.json").write_text(json.dumps({"podId": pod_id,
                "files": [{"path": name, "sha256": "bad"}]}))
            with self.assertRaises(RuntimeError):
                cloud.verify_backup(self.artifacts, "fixturepod")

    def test_callback_does_not_receive_account_key(self):
        program = self.root / "job.py"
        program.write_text("import os\nassert 'RUNPOD_API_KEY' not in os.environ\nassert os.environ['READALONG_POD_ID']=='fixturepod'\n")
        with patch.dict(os.environ, {"RUNPOD_API_KEY": "synthetic-account-key"}):
            self.assertEqual(cloud.callback(program, self.state_path, self.artifacts, "fixturepod", 3), 0)

    def test_callback_timeout_terminates_child(self):
        program = self.root / "job.py"
        program.write_text("import time\ntime.sleep(30)\n")
        with self.assertRaises(subprocess.TimeoutExpired):
            cloud.callback(program, self.state_path, self.artifacts, "fixturepod", .05)

    def test_read_only_network_error_does_not_imply_a_mutation(self):
        with patch.object(cloud, "urlopen", side_effect=cloud.URLError("synthetic network fault")):
            with self.assertRaisesRegex(RuntimeError, "^Runpod network request failed$"):
                cloud.request(cloud.GRAPHQL, "POST", {"query": "{ gpuTypes { id } }"})


if __name__ == "__main__":
    unittest.main()
