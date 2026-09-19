#!/usr/bin/env python3
"""Preview by default. --create runs one paid, bounded MOSS cloud audition."""
import argparse
import getpass
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--create", action="store_true")
    parser.add_argument("--work-dir", type=Path, help="New private directory for SSH key, state and downloaded recordings")
    parser.add_argument("--hours", type=float, default=2)
    parser.add_argument("--max-usd", type=float, default=5)
    parser.add_argument("--prompt-key", action="store_true", help="Read Runpod key privately in this terminal, without saving it")
    args = parser.parse_args()
    if args.prompt_key and not args.create:
        parser.error("Preview does not need credentials")
    subprocess.run([sys.executable, str(HERE / "model_runner.py"), "--dry-run", "--bundle", str(HERE / "audition.json")], check=True)
    lock = json.loads((HERE / "models.lock.json").read_text())
    command = [sys.executable, str(HERE / "cloud_runpod.py"), "--image", lock["image"],
               "--hours", str(args.hours), "--max-usd", str(args.max_usd)]
    env = os.environ.copy()
    if args.create:
        if not args.work_dir:
            parser.error("--create requires a new --work-dir")
        if args.prompt_key:
            if not sys.stdin.isatty():
                parser.error("Use an interactive terminal for the private key prompt")
            env["RUNPOD_API_KEY"] = getpass.getpass("Runpod API key (hidden; held only for this run): ").strip()
        if not env.get("RUNPOD_API_KEY"):
            parser.error("Sign in and provide RUNPOD_API_KEY locally or use --prompt-key; do not paste it into chat")
        for executable in ("ssh", "scp", "ssh-keygen"):
            if not shutil.which(executable):
                parser.error("Required local program missing: " + executable)
        work = args.work_dir.expanduser().resolve()
        if work.exists():
            parser.error("Choose a new work directory; existing state must be inspected before retrying")
        work.mkdir(parents=True, mode=0o700)
        os.chmod(work, 0o700)
        key = work / "audition_ed25519"
        subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "inkwave-audition", "-f", str(key)], check=True)
        command += ["--create", "--state", str(work / "state.json"), "--artifacts", str(work / "artifacts"),
                    "--ssh-public-key", str(key) + ".pub", "--job-program", str(HERE / "remote_job.py"),
                    "--backup-program", str(HERE / "remote_backup.py")]
        # Keep the local supervisor awake on macOS; the cloud API remains the stop mechanism.
        if sys.platform == "darwin" and shutil.which("caffeinate"):
            command = ["caffeinate", "-i", *command]
    return subprocess.run(command, env=env).returncode


if __name__ == "__main__":
    raise SystemExit(main())
