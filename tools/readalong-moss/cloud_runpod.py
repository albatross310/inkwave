#!/usr/bin/env python3
"""Quote-first Runpod audition supervisor (stdlib only; never buys account credit).

Default invocation is read-only: --image IMAGE prints the current exact A6000 quote.
--create also requires --state, --artifacts, --ssh-public-key, --job-program and
--backup-program. Both local callback programs receive READALONG_POD_ID,
READALONG_STATE and READALONG_ARTIFACTS in their environment, with no Runpod key.
The job callback performs SSH setup/rendering; backup copies outputs and writes:
  {"podId": "...", "files": [{"path": "sample.wav", "sha256": "..."}, ...]}
to ARTIFACTS/backup-manifest.json. The audition's manifest.json stays separate.
Only verified backup permits automatic deletion. The supervisor records the Pod's
IP and SSH port before invoking the job callback; callbacks need no control-plane key.

The two-hour deadline is enforced by this local process, NOT a provider hard TTL.
Keep this machine awake/connected. API/network failure can prevent stopping; a
US$5 estimate limit is NOT an account-level spending cap. No HTTP port is exposed.
API docs: https://docs.runpod.io/sdks/graphql/manage-pods
          https://docs.runpod.io/api-reference/pods/POST/pods
"""
import argparse
import hashlib
import ipaddress
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import uuid

GPU_ID = "NVIDIA RTX A6000"
REST = "https://rest.runpod.io/v1"
GRAPHQL = "https://api.runpod.io/graphql"
CONTAINER_GB, VOLUME_GB = 20, 70
STORAGE_HOURLY = (CONTAINER_GB + VOLUME_GB) * .10 / (30 * 24)
BACKUP_SECONDS = 300
READY_SECONDS = 900


def request(url, method="GET", payload=None, key=None, timeout=20):
    headers = {"Content-Type": "application/json", "User-Agent": "InkwaveReadalong/1.0"}
    if key:
        headers["Authorization"] = "Bearer " + key
    body = None if payload is None else json.dumps(payload).encode()
    try:
        with urlopen(Request(url, data=body, method=method, headers=headers), timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except HTTPError as error:
        # API responses may contain submitted environment values: never echo them.
        raise RuntimeError("Runpod HTTP %s for %s" % (error.code, method)) from None
    except (URLError, TimeoutError) as error:
        raise RuntimeError("Runpod network request failed") from None


def graphql(query, key=None):
    value = request(GRAPHQL, "POST", {"query": query}, key)
    if value.get("errors") or not isinstance(value.get("data"), dict):
        raise RuntimeError("Runpod GraphQL rejected the read; no mutation attempted")
    return value["data"]


def quote(hours):
    # Discovery precedes selection; never substitute another GPU when unavailable.
    catalog = graphql("{ gpuTypes { id displayName memoryInGb secureCloud } }")["gpuTypes"]
    matches = [gpu for gpu in catalog if gpu["id"] == GPU_ID]
    if len(matches) != 1 or matches[0]["memoryInGb"] != 48 or not matches[0]["secureCloud"]:
        raise RuntimeError("Exact 48 GB Secure Cloud RTX A6000 not in the catalog")
    query = '''{ gpuTypes(input: { id: "NVIDIA RTX A6000" }) {
      id memoryInGb lowestPrice(input: {gpuCount: 1, minDisk: 90,
      minMemoryInGb: 48, minVcpuCount: 4, secureCloud: true}) {
        uninterruptablePrice stockStatus availableGpuCounts } } }'''
    gpu = graphql(query)["gpuTypes"][0]
    offer = gpu.get("lowestPrice") or {}
    rate = offer.get("uninterruptablePrice")
    if not isinstance(rate, (float, int)) or not math.isfinite(rate) or rate <= 0:
        raise RuntimeError("No finite live price for the requested GPU")
    return {"gpuId": GPU_ID, "memoryGB": 48, "cloud": "SECURE",
            "stockStatus": offer.get("stockStatus"), "availableGpuCounts": offer.get("availableGpuCounts"),
            "gpuUSDPerHour": rate, "diskUSDPerHourEstimate": STORAGE_HOURLY,
            "runtimeHours": hours, "estimatedUSD": (rate + STORAGE_HOURLY) * hours,
            "observedAt": time.time()}


def safe_pod(pod):
    return {key: pod.get(key) for key in
            ("id", "name", "desiredStatus", "costPerHr", "publicIp", "portMappings", "lastStatusChange")}


def write_state(path, state):
    temp = path.with_suffix(path.suffix + ".tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as stream:
        json.dump(state, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp, path)


def wait_for_ssh(pod_id, key, state_path, state, deadline):
    """Poll endpoint metadata, not authentication; the callback retries SSH login.

    Every request/sleep shares a bounded startup budget, also bounded by the
    session deadline minus backup time. No callback sees the initial empty endpoint.
    """
    remaining = min(READY_SECONDS, deadline - time.time() - BACKUP_SECONDS)
    end = time.monotonic() + max(0, remaining)
    state["phase"] = "waiting_for_ssh_endpoint"
    write_state(state_path, state)
    while time.monotonic() < end:
        try:
            pod = request(REST + "/pods/" + pod_id, key=key,
                          timeout=min(20, max(.1, end - time.monotonic())))
        except RuntimeError:
            state["readinessLastReadFailed"] = True
            write_state(state_path, state)
        else:
            if not isinstance(pod, dict) or pod.get("id") != pod_id:
                raise RuntimeError("Readiness response did not identify the created Pod")
            state["pod"] = safe_pod(pod)
            state.pop("readinessLastReadFailed", None)
            if pod.get("desiredStatus") in ("EXITED", "TERMINATED", "DELETED"):
                write_state(state_path, state)
                raise RuntimeError("Pod stopped before an SSH endpoint became available")
            port = (pod.get("portMappings") or {}).get("22")
            try:
                ipaddress.ip_address(pod.get("publicIp") or "")
                valid_ip = True
            except ValueError:
                valid_ip = False
            if valid_ip and isinstance(port, int) and not isinstance(port, bool) and 1 <= port <= 65535:
                state["phase"] = "ssh_endpoint_ready"
                write_state(state_path, state)
                return pod
            write_state(state_path, state)
        time.sleep(min(5, max(0, end - time.monotonic())))
    raise RuntimeError("SSH endpoint readiness timed out; no job callback started")


def verify_backup(directory, pod_id):
    root = directory.resolve()
    manifest_path = directory / "backup-manifest.json"
    if manifest_path.is_symlink():
        raise RuntimeError("Backup manifest must not be a symlink")
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("podId") != pod_id or not manifest.get("files"):
        raise RuntimeError("Backup manifest must bind nonempty artifacts to this Pod")
    seen = set()
    for entry in manifest["files"]:
        name = entry["path"]
        path = directory / name
        if not name or Path(name).is_absolute() or ".." in Path(name).parts or name in seen:
            raise RuntimeError("Invalid or duplicate backup path")
        seen.add(name)
        if path.is_symlink() or root not in path.resolve().parents or not path.is_file():
            raise RuntimeError("Backup path escapes output directory or is missing")
        for parent in path.parents:
            if parent == directory:
                break
            if parent.is_symlink():
                raise RuntimeError("Backup may not traverse symlinks")
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        if digest.hexdigest() != entry.get("sha256"):
            raise RuntimeError("Backup checksum mismatch")
    return len(seen)


def callback(program, state_path, directory, pod_id, seconds):
    env = {name: os.environ[name] for name in ("PATH", "HOME", "TMPDIR", "SSH_AUTH_SOCK", "LANG")
           if name in os.environ}
    env.update(READALONG_POD_ID=pod_id, READALONG_STATE=str(state_path),
               READALONG_ARTIFACTS=str(directory))
    command = ([sys.executable, str(program)] if program.suffix == ".py" else [str(program)])
    process = subprocess.Popen(command, env=env, start_new_session=True)
    try:
        return process.wait(timeout=max(.1, seconds))
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()


def stop(pod_id, key):
    for attempt in range(3):
        try:
            request(REST + "/pods/" + pod_id + "/stop", "POST", key=key)
            for _ in range(6):
                value = request(REST + "/pods/" + pod_id, key=key)
                if value.get("desiredStatus") == "EXITED":
                    return True
                time.sleep(2)
        except RuntimeError:
            pass
        time.sleep(attempt + 1)
    return False


def run(args, offer, key):
    state_path = Path(args.state).resolve()
    directory = Path(args.artifacts).resolve()
    if state_path.exists():
        raise RuntimeError("State exists: inspect its Pod before any new create attempt")
    if directory.exists() and any(directory.iterdir()):
        raise RuntimeError("Use an empty artifact directory; stale backup is not proof")
    programs = [Path(args.job_program).resolve(), Path(args.backup_program).resolve()]
    if any(not path.is_file() for path in programs):
        raise RuntimeError("Job and backup callbacks must exist before creating a Pod")
    public_key = Path(args.ssh_public_key).read_text().strip()
    if "\n" in public_key or not public_key.startswith(("ssh-ed25519 ", "ssh-rsa ")):
        raise RuntimeError("Expected one SSH public key, never a private key")
    if offer["stockStatus"] not in ("Low", "Medium", "High"):
        raise RuntimeError("No currently available requested GPU")
    if offer["availableGpuCounts"] is not None and 1 not in offer["availableGpuCounts"]:
        raise RuntimeError("No single-GPU offer available")
    if offer["estimatedUSD"] > args.max_usd:
        raise RuntimeError("Quoted session exceeds the requested estimated budget")
    account = graphql("{ myself { clientBalance } }", key).get("myself") or {}
    balance = account.get("clientBalance")
    if not isinstance(balance, (float, int)) or balance < max(offer["estimatedUSD"], offer["gpuUSDPerHour"]):
        raise RuntimeError("Insufficient verified account credit; no top-up attempted")
    state_path.parent.mkdir(parents=True, exist_ok=True)
    directory.mkdir(parents=True, exist_ok=True)
    state = {"name": "readalong-moss-" + uuid.uuid4().hex[:12], "phase": "creating",
             "quote": offer, "createdAt": time.time(), "pod": None, "backupVerified": False}
    # Persist intent before mutation. Never blindly retry a timed-out create.
    write_state(state_path, state)
    payload = {"name": state["name"], "imageName": args.image, "cloudType": "SECURE",
               "computeType": "GPU", "gpuTypeIds": [GPU_ID], "gpuCount": 1,
               "minRAMPerGPU": 48, "minVCPUPerGPU": 4, "interruptible": False,
               "containerDiskInGb": CONTAINER_GB, "volumeInGb": VOLUME_GB,
               "volumeMountPath": "/workspace", "ports": ["22/tcp"],
               "supportPublicIp": True, "env": {"PUBLIC_KEY": public_key}}
    try:
        pod = request(REST + "/pods", "POST", payload, key)
    except RuntimeError:
        state["phase"] = "create_outcome_unknown"
        write_state(state_path, state)
        raise RuntimeError("Create outcome uncertain. Inspect Pods matching " + state["name"] +
                           "; do not repeat --create") from None
    if not isinstance(pod, dict) or not pod.get("id"):
        raise RuntimeError("Create returned no Pod ID; inspect recorded unique name before retry")
    pod_id = pod["id"]
    if not pod_id.isalnum():
        raise RuntimeError("Unexpected Pod ID; inspect recorded unique name manually")
    state["pod"] = safe_pod(pod)
    state["phase"] = "running"
    write_state(state_path, state)
    print(json.dumps(state), flush=True)
    deadline = state["createdAt"] + args.hours * 3600
    failure = None
    try:
        rate = pod.get("costPerHr")
        if not isinstance(rate, (float, int)) or not math.isfinite(rate) or rate <= 0:
            raise RuntimeError("Actual Pod price unavailable: stopping before work")
        if (rate + STORAGE_HOURLY) * args.hours > args.max_usd:
            raise RuntimeError("Actual Pod price exceeds budget: stopping before work")
        wait_for_ssh(pod_id, key, state_path, state, deadline)
        # Endpoint discovery is complete. The callback may still need to retry SSH
        # while sshd initializes; setup/downloads use the remaining session budget.
        result = callback(programs[0], state_path, directory, pod_id,
                          deadline - time.time() - BACKUP_SECONDS)
        state["jobExitCode"] = result
        if result:
            failure = "Job failed; attempting backup of partial results/logs"
    except (Exception, KeyboardInterrupt) as error:
        failure = type(error).__name__ + ": " + str(error)
    finally:
        try:
            state["phase"] = "backing_up"
            state["pod"] = safe_pod(request(REST + "/pods/" + pod_id, key=key))
            write_state(state_path, state)
            if callback(programs[1], state_path, directory, pod_id,
                        min(BACKUP_SECONDS, deadline - time.time())) != 0:
                raise RuntimeError("Backup callback failed")
            state["artifactCount"] = verify_backup(directory, pod_id)
            state["backupVerified"] = True
        except (Exception, KeyboardInterrupt) as error:
            state["backupError"] = type(error).__name__ + ": " + str(error)
        state["stopConfirmed"] = stop(pod_id, key)
        state["phase"] = "stopped_volume_retained" if state["stopConfirmed"] else "STOP_NOT_CONFIRMED"
        write_state(state_path, state)
        if state["backupVerified"]:
            try:
                request(REST + "/pods/" + pod_id, "DELETE", key=key)
                state["phase"] = "delete_accepted"
            except RuntimeError:
                state["deleteError"] = "Delete not confirmed; inspect Pod and retained storage"
        state["failure"] = failure
        write_state(state_path, state)
        print(json.dumps(state), flush=True)
    if not state.get("backupVerified") or state["phase"] != "delete_accepted" or failure:
        raise RuntimeError("Session needs review; see state file. Retained storage may still bill")


def main():
    def interrupted(signum, frame):
        raise KeyboardInterrupt("Supervisor interrupted; attempting backup/stop")
    signal.signal(signal.SIGTERM, interrupted)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", help="Exact reviewed image/tag; must start SSH from PUBLIC_KEY")
    parser.add_argument("--hours", type=float, default=2)
    parser.add_argument("--max-usd", type=float, default=5)
    parser.add_argument("--create", action="store_true", help="Explicitly authorize one paid Pod")
    parser.add_argument("--status", action="store_true", help="Read only the Pod in --state")
    for name in ("state", "artifacts", "ssh-public-key", "job-program", "backup-program"):
        parser.add_argument("--" + name)
    args = parser.parse_args()
    if not math.isfinite(args.hours) or not 1/6 <= args.hours <= 2:
        parser.error("Runtime must be 10 minutes to 2 hours")
    if not math.isfinite(args.max_usd) or not 0 < args.max_usd <= 5:
        parser.error("Estimated budget must be positive and no more than US$5")
    key = os.environ.get("RUNPOD_API_KEY")
    if args.status:
        if not args.state or not key or args.create:
            parser.error("--status needs --state and RUNPOD_API_KEY; cannot create")
        state = json.loads(Path(args.state).read_text())
        pod_id = (state.get("pod") or {}).get("id")
        if not isinstance(pod_id, str) or not pod_id.isalnum():
            raise RuntimeError("No verified Pod ID; inspect unique name " + state.get("name", ""))
        print(json.dumps(safe_pod(request(REST + "/pods/" + pod_id, key=key)), indent=2))
        return
    offer = quote(args.hours)
    print(json.dumps({"mode": "create" if args.create else "preview", "quote": offer,
                      "image": args.image, "containerGB": CONTAINER_GB, "volumeGB": VOLUME_GB,
                      "ports": ["22/tcp"], "accountKeyPresent": bool(key),
                      "limit": "Local watchdog, not provider-enforced hard spending cap"}, indent=2), flush=True)
    if args.create:
        if not key or not all((args.image, args.state, args.artifacts, args.ssh_public_key,
                               args.job_program, args.backup_program)):
            parser.error("Create requires RUNPOD_API_KEY and all image/state/artifacts/key/callback arguments")
        run(args, offer, key)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
