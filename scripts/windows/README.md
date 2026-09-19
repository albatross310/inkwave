# Windows narration host preparation

Copy `Prepare-InkwaveNarrator.ps1` to the Windows 11 Pro desktop. Open PowerShell and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Prepare-InkwaveNarrator.ps1
```

This reports Windows, CPU, memory, GPU and NVIDIA driver details. It stores a hardware report under
`%LOCALAPPDATA%\Inkwave\Narrator` and does not install software or open ports.

To prepare the isolated CUDA audition environment as well:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Prepare-InkwaveNarrator.ps1 -InstallRuntime
```

That installs Python 3.11 if needed, creates a dedicated environment, installs PyTorch 2.6/CUDA 11.8,
and checks real GPU arithmetic. This pin avoids the newer PyTorch CUDA builds that omit Pascal,
the architecture used by the GTX 1070. It does not establish that an 8B dialogue model will fit.
The first installation downloads large runtime packages; no paid service or model subscription is used.
`ExecutionPolicy Bypass` applies only to this PowerShell process, not to the system policy.

**Prepared, not Windows-tested in this session.** The current environment is macOS, with no remote
connection to the desktop. Inspect the script before running it. No worker service is created yet:
model selection follows the voice comparison/auditions, and the Vercel queue endpoints and worker
registration must be deployed before an outbound worker can connect. The current Vercel connector
returns no teams; project access remains a deployment prerequisite.

The intended production path is **browser → Vercel job service ← Windows worker**. The worker
polls outward over HTTPS, so it needs neither a connection to the Mac nor router port forwarding.
Its eventual registration secret belongs in the desktop's private configuration, never in a
manuscript, browser bundle, Git, or chat. The public demo can submit jobs without a user API key;
private, unguessable job receipts protect access to each submitted book and its recordings.

See [the model comparison](../../docs/READALONG-VOICE-MODEL-COMPARISON.md) before choosing a GPU or
speech model. The locally running Kokoro proof is a baseline and does not implement book direction,
character analysis, prompt-created actors, or a public desktop worker.

Source: [PyTorch previous versions and CUDA 11.8 wheels](https://pytorch.org/get-started/previous-versions/),
[Pascal removal from CUDA 12.8/12.9 PyTorch binaries](https://dev-discuss.pytorch.org/t/cuda-toolkit-version-and-architecture-support-update-maxwell-and-pascal-architecture-support-removed-in-cuda-12-8-and-12-9-builds/3128).
