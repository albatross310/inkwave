"""Mocked SSH/backup tests; never connect to a host or provision a cloud resource.

python3 -m unittest discover -s tools/readalong-moss -p 'test_remote_session.py'
"""
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

import cloud_runpod
import remote_session as remote


class RemoteSessionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="audition tests ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.source = self.root / "source"
        self.source.mkdir()
        self.artifacts = self.root / "artifacts"
        self.artifacts.mkdir()
        self.state_path = self.root / "state.json"
        self.key = self.root / "audition_ed25519"
        self.key.write_text("synthetic fixture, not a real key")
        self.key.chmod(0o600)
        self.state = {"pod": {"id": "fixturepod", "publicIp": "203.0.113.30", "portMappings": {"22": 22345}}}
        self.save_state()
        for name in set(remote.SOURCE_FILES) | {"review.html", "review.css", "review.js"}:
            (self.source / name).write_text("synthetic " + name)
        (self.source / ".env").write_text("NEVER_UPLOAD=synthetic-secret")
        self.patches = [patch.object(remote, "HERE", self.source), patch.dict(os.environ, {
            "READALONG_STATE": str(self.state_path), "READALONG_POD_ID": "fixturepod",
            "READALONG_ARTIFACTS": str(self.artifacts)})]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def save_state(self):
        self.state_path.write_text(json.dumps(self.state))

    def inventory(self, blobs):
        return {"files": [{"path": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
                          for name, data in blobs.items()]}

    def backup_with(self, blobs, *, inventory=None, corrupt=False):
        inventory = inventory if inventory is not None else self.inventory(blobs)
        calls = []
        def invoke(argv, **kwargs):
            self.assertFalse(kwargs.get("shell", False))
            calls.append(argv)
            if argv[0] == "ssh":
                return types.SimpleNamespace(stdout=json.dumps(inventory), returncode=0)
            name = argv[-2].split(remote.REMOTE + "/", 1)[1]
            Path(argv[-1]).write_bytes(b"corrupt" if corrupt else blobs[name])
            return types.SimpleNamespace(returncode=0)
        with patch.object(remote.subprocess, "run", side_effect=invoke):
            remote.run_backup()
        return calls

    def test_session_uses_dedicated_key_and_safe_arg_arrays(self):
        state, ssh, scp, target = remote.session()
        self.assertEqual(ssh[ssh.index("-i") + 1], str(self.key))
        self.assertIn("BatchMode=yes", ssh)
        self.assertIn("StrictHostKeyChecking=accept-new", ssh)
        self.assertIn("UserKnownHostsFile=" + str(self.root / "known_hosts"), ssh)
        self.assertEqual(ssh[-3:], ["-p", "22345", "root@203.0.113.30"])
        self.assertEqual(scp[-2:], ["-P", "22345"])

    def test_ipv6_ssh_and_scp_have_distinct_destinations(self):
        self.state["pod"]["publicIp"] = "2001:db8::30"
        self.save_state()
        _, ssh, _, target = remote.session()
        self.assertEqual(ssh[-1], "root@2001:db8::30")
        self.assertEqual(target, "root@[2001:db8::30]")

    def test_bad_identity_ip_or_port_never_runs_subprocess(self):
        for changes in ({"id": "wrongpod"}, {"publicIp": "203.0.113.30;touch /tmp/no"},
                        {"portMappings": {"22": "22;touch x"}}, {"portMappings": {"22": 65536}},
                        {"portMappings": {"22": True}}):
            original = dict(self.state["pod"])
            self.state["pod"].update(changes)
            self.save_state()
            with patch.object(remote.subprocess, "run") as run:
                with self.assertRaises((RuntimeError, ValueError)):
                    remote.session()
                run.assert_not_called()
            self.state["pod"] = original

    def test_missing_or_linked_key_is_rejected(self):
        self.key.unlink()
        with self.assertRaises(RuntimeError):
            remote.session()
        self.key.symlink_to(self.source / "audition.json")
        with self.assertRaises(RuntimeError):
            remote.session()

    def test_bundle_uploads_exact_allowlist_and_excludes_environment(self):
        archive = self.root / "source.tar.gz"
        remote.make_bundle(archive)
        with tarfile.open(archive) as bundle:
            self.assertEqual(set(bundle.getnames()), set(remote.SOURCE_FILES))
            self.assertNotIn(".env", bundle.getnames())
            self.assertTrue(all(item.isfile() for item in bundle.getmembers()))

    def test_bundle_rejects_linked_source(self):
        file = self.source / remote.SOURCE_FILES[0]
        file.unlink()
        file.symlink_to(self.source / ".env")
        with self.assertRaises(RuntimeError):
            remote.make_bundle(self.root / "source.tar.gz")

    def test_job_retries_probe_timeout_and_quotes_remote_script(self):
        calls = []
        def invoke(argv, **kwargs):
            self.assertFalse(kwargs.get("shell", False))
            calls.append(argv)
            if len(calls) == 1:
                raise subprocess.TimeoutExpired(argv, 15)
            return types.SimpleNamespace(returncode=0)
        with patch.object(remote.subprocess, "run", side_effect=invoke), patch.object(remote.time, "sleep"):
            self.assertEqual(remote.run_job(), 0)
        self.assertEqual(calls[0][-1], "true")
        self.assertEqual(calls[1][-1], "true")
        command = shlex.split(calls[-1][-1])
        self.assertEqual(command[:6], ["timeout", "--signal=TERM", "--kill-after=30s", "6600s", "bash", "-lc"])
        self.assertEqual(len(command), 7)
        self.assertIn("sha256sum --check --status", command[-1])
        self.assertNotIn("NEVER_UPLOAD", command[-1])

    def test_exhausted_ssh_probes_never_upload_or_render(self):
        with patch.object(remote.subprocess, "run", return_value=types.SimpleNamespace(returncode=255)) as run, \
             patch.object(remote.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "SSH did not become ready"):
                remote.run_job()
        self.assertEqual(run.call_count, 30)
        self.assertTrue(all(item.args[0][-1] == "true" for item in run.call_args_list))

    def test_verified_backup_preserves_audition_manifest_and_includes_review(self):
        blobs = {"output/manifest.json": b'{"audition":"result"}', "output/scene.wav": b"synthetic-wave", "logs/render.log": b"done"}
        calls = self.backup_with(blobs)
        self.assertEqual(len(calls), 4)
        self.assertEqual((self.artifacts / "output/manifest.json").read_bytes(), blobs["output/manifest.json"])
        self.assertEqual(cloud_runpod.verify_backup(self.artifacts, "fixturepod"), 7)
        self.assertTrue((self.artifacts / "output/review.html").is_file())

    def test_invalid_download_does_not_publish_deletion_proof(self):
        with self.assertRaisesRegex(RuntimeError, "checksum"):
            self.backup_with({"output/scene.wav": b"expected"}, corrupt=True)
        self.assertFalse((self.artifacts / "backup-manifest.json").exists())

    def test_inventory_guards_reject_before_scp(self):
        base = {"path": "output/scene.wav", "sha256": "0" * 64, "bytes": 1}
        cases = [[], [dict(base, path="output/../secret")], [dict(base, path="logs/x;echo")],
                 [dict(base, sha256="bad")], [dict(base, bytes=1_000_000_001)], [dict(base, bytes=True)]]
        for files in cases:
            with self.subTest(files=files), patch.object(remote.subprocess, "run", return_value=types.SimpleNamespace(stdout=json.dumps({"files": files}))) as run:
                with self.assertRaises(RuntimeError):
                    remote.run_backup()
                self.assertEqual(run.call_count, 1)
                self.assertFalse((self.artifacts / "backup-manifest.json").exists())

    def test_dangling_destination_is_rejected_before_copy(self):
        (self.artifacts / "output").mkdir()
        outside = self.root / "outside"
        (self.artifacts / "output/scene.wav").symlink_to(outside)
        with self.assertRaises(RuntimeError):
            self.backup_with({"output/scene.wav": b"synthetic"})
        self.assertFalse(outside.exists())

    def test_linked_parent_is_rejected_before_mkdir(self):
        outside = self.root / "outside"
        outside.mkdir()
        (self.artifacts / "output").symlink_to(outside, target_is_directory=True)
        with self.assertRaises(RuntimeError):
            self.backup_with({"output/new/scene.wav": b"synthetic"})
        self.assertFalse((outside / "new").exists())

    def test_review_assets_do_not_overwrite_downloaded_files(self):
        with self.assertRaisesRegex(RuntimeError, "overwrite"):
            self.backup_with({"output/review.html": b"different remote artifact"})
        self.assertEqual((self.artifacts / "output/review.html").read_bytes(), b"different remote artifact")
        self.assertFalse((self.artifacts / "backup-manifest.json").exists())


if __name__ == "__main__":
    unittest.main()
