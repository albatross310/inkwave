"""SSH callbacks for the audition supervisor; never receive the cloud API key."""
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tarfile
import time

HERE = Path(__file__).resolve().parent
REMOTE = "/workspace/inkwave-audition"
SOURCE_FILES = ("model_runner.py", "contract.py", "models.lock.json", "audition.json",
                "requirements.txt", "bootstrap.sh")


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def session():
    state_path = Path(os.environ["READALONG_STATE"]).resolve()
    state = json.loads(state_path.read_text())
    pod = state.get("pod") or {}
    if pod.get("id") != os.environ["READALONG_POD_ID"]:
        raise RuntimeError("Pod identity mismatch")
    ip = str(ipaddress.ip_address(pod.get("publicIp", "")))
    mapping = pod.get("portMappings") or {}
    raw_port = mapping.get("22", mapping.get("22/tcp", 0))
    if isinstance(raw_port, bool):
        raise RuntimeError("Invalid SSH port in supervisor state")
    port = int(raw_port)
    if not 1 <= port <= 65535:
        raise RuntimeError("No ready SSH port in supervisor state")
    key = state_path.parent / "audition_ed25519"
    if not key.is_file() or key.is_symlink():
        raise RuntimeError("Dedicated audition SSH key missing")
    common = ["-i", str(key), "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
              "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10",
              "-o", "UserKnownHostsFile=" + str(state_path.parent / "known_hosts")]
    # ssh receives a hostname argument; scp needs brackets to distinguish an
    # IPv6 address from the colon that separates the remote path.
    ssh_target = "root@" + ip
    scp_target = "root@" + ("[" + ip + "]" if ":" in ip else ip)
    return state, ["ssh", *common, "-p", str(port), ssh_target], ["scp", *common, "-P", str(port)], scp_target


def make_bundle(path):
    with tarfile.open(path, "w:gz") as archive:
        for name in SOURCE_FILES:
            source = HERE / name
            if not source.is_file() or source.is_symlink():
                raise RuntimeError("Audition source missing or linked: " + name)
            archive.add(source, arcname=name, recursive=False)


def run_job():
    state, ssh, scp, target = session()
    directory = Path(os.environ["READALONG_STATE"]).resolve().parent
    archive = directory / "audition-source.tar.gz"
    make_bundle(archive)
    # A mapped port may precede sshd readiness. The supervisor bounds this callback.
    ready = False
    for _ in range(30):
        try:
            probe = subprocess.run([*ssh, "true"], capture_output=True, timeout=15)
        except subprocess.TimeoutExpired:
            time.sleep(2)
            continue
        if probe.returncode == 0:
            ready = True
            break
        time.sleep(2)
    if not ready:
        raise RuntimeError("SSH did not become ready")
    subprocess.run([*ssh, "mkdir -p " + REMOTE + "/logs"], check=True, timeout=20)
    subprocess.run([*scp, str(archive), target + ":" + REMOTE + "/source.tar.gz"], check=True, timeout=60)
    # Only the packaged synthetic fixture is uploaded. No local environment file is copied.
    command = "\n".join([
        "set -euo pipefail",
        "cd " + REMOTE,
        "printf '%s  source.tar.gz\\n' '" + sha256(archive) + "' | sha256sum --check --status",
        "tar -xzf source.tar.gz",
        "export MOSS_PYTHON=python3 MOSS_VENV=" + REMOTE + "/.venv",
        "export PIP_CACHE_DIR=/workspace/pip-cache HF_HOME=/workspace/huggingface",
        "python3 -c 'import sys; assert sys.version_info[:2] in ((3, 11), (3, 12)), sys.version'",
        "bash bootstrap.sh > logs/setup.log 2>&1",
        ".venv/bin/python model_runner.py --dry-run --bundle audition.json > logs/plan.json",
        ".venv/bin/python model_runner.py --run --bundle audition.json --output output --cache-dir /workspace/huggingface > logs/render.log 2>&1",
    ])
    result = subprocess.run([*ssh, "timeout --signal=TERM --kill-after=30s 6600s bash -lc " + shlex.quote(command)])
    return result.returncode


REMOTE_INVENTORY = r'''
import hashlib,json,pathlib
root=pathlib.Path("/workspace/inkwave-audition")
files=[]
total=0
for directory in (root/"output",root/"logs"):
    if not directory.exists(): continue
    if directory.is_symlink(): raise RuntimeError("linked output directory")
    for path in sorted(directory.rglob("*")):
        if path.is_symlink(): raise RuntimeError("linked output")
        if not path.is_file(): continue
        size=path.stat().st_size
        total+=size
        if total>1000000000: raise RuntimeError("backup exceeds audition size bound")
        digest=hashlib.sha256()
        with path.open("rb") as stream:
            for block in iter(lambda:stream.read(1048576),b""): digest.update(block)
        files.append({"path":str(path.relative_to(root)),"sha256":digest.hexdigest(),"bytes":size})
print(json.dumps({"files":files}))
'''


def run_backup():
    state, ssh, scp, target = session()
    result = subprocess.run([*ssh, "python3 -c " + shlex.quote(REMOTE_INVENTORY)],
                            check=True, capture_output=True, text=True, timeout=60)
    inventory = json.loads(result.stdout)
    files = inventory.get("files")
    if not isinstance(files, list) or not files:
        raise RuntimeError("No outputs or logs were found; retain the Pod volume")
    artifacts = Path(os.environ["READALONG_ARTIFACTS"]).resolve()
    seen = set()
    total = 0
    for item in files:
        name = item.get("path", "")
        if not re.fullmatch(r"(?:output|logs)/[A-Za-z0-9_./-]+", name) or ".." in Path(name).parts or name in seen:
            raise RuntimeError("Unsafe backup path")
        seen.add(name)
        if not re.fullmatch(r"[a-f0-9]{64}", item.get("sha256", "")):
            raise RuntimeError("Invalid remote checksum")
        size = item.get("bytes")
        if type(size) is not int or size < 0:
            raise RuntimeError("Invalid remote file size")
        total += size
        if total > 1_000_000_000:
            raise RuntimeError("Backup exceeds audition size bound")
        destination = artifacts / name
        # Check links before mkdir: a linked parent could otherwise create local
        # directories outside the backup. exists() alone misses dangling links.
        if destination.exists() or destination.is_symlink() or any(p.is_symlink() for p in destination.parents):
            raise RuntimeError("Backup must not overwrite or traverse linked local files")
        destination.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([*scp, target + ":" + REMOTE + "/" + name, str(destination)], check=True, timeout=120)
        if destination.stat().st_size != size or sha256(destination) != item["sha256"]:
            raise RuntimeError("Downloaded file does not match remote checksum")
    output = artifacts / "output"
    output.mkdir(exist_ok=True)
    for name in ("review.html", "review.css", "review.js", "audition.json"):
        source, destination = HERE / name, output / name
        if not source.is_file() or source.is_symlink():
            raise RuntimeError("Review source missing or linked: " + name)
        if destination.is_symlink() or output.is_symlink():
            raise RuntimeError("Review asset would traverse a linked output")
        data = source.read_bytes()
        if destination.exists():
            if not destination.is_file() or destination.read_bytes() != data:
                raise RuntimeError("Review asset would overwrite a downloaded file: " + name)
        else:
            with destination.open("xb") as stream:
                stream.write(data)
        relative = "output/" + name
        if relative not in seen:
            files.append({"path": relative, "sha256": sha256(destination), "bytes": len(data)})
            seen.add(relative)
    # Publish proof last, after every file is copied and validated. The real
    # audition manifest.json is an artifact, never the supervisor's proof file.
    inventory["podId"] = state["pod"]["id"]
    with (artifacts / "backup-manifest.json").open("x") as stream:
        stream.write(json.dumps(inventory, indent=2) + "\n")
    return 0
