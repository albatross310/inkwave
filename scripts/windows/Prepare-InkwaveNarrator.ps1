<#
.SYNOPSIS
Inspect a Windows narration host; optionally prepare a Pascal-compatible Python/CUDA environment.
.DESCRIPTION
This prepares the host for model auditions. It does not claim the Vercel queue is deployed,
start an unconfigured worker, buy cloud compute, or expose an inbound network port.
#>
[CmdletBinding()]
param(
  [switch]$InstallRuntime,
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Inkwave\Narrator')
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Run-Checked([string]$Program, [string[]]$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE. Setup stopped." }
}
if ($env:OS -ne 'Windows_NT') { throw 'Run this script on the Windows desktop.' }
New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
$osInfo = Get-CimInstance Win32_OperatingSystem
$systemInfo = Get-CimInstance Win32_ComputerSystem
$cpuInfo = Get-CimInstance Win32_Processor | Select-Object -First 1
$gpuInfo = @()
$smiCommand = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
if ($smiCommand) {
  $gpuInfo = @(& $smiCommand.Source '--query-gpu=name,memory.total,driver_version' '--format=csv,noheader,nounits')
  if ($LASTEXITCODE -ne 0) { throw 'The NVIDIA driver could not report the GPU. Update or repair the driver before model setup.' }
}
$report = [ordered]@{
  CheckedAt = [DateTime]::UtcNow.ToString('o')
  Windows = $osInfo.Caption
  CPU = $cpuInfo.Name
  RAMGiB = [math]::Round($systemInfo.TotalPhysicalMemory / 1GB, 1)
  NvidiaGPU_VRAMMiB_Driver = $gpuInfo
  RuntimeInstalled = $false
  VercelWorkerConnected = $false
  Note = 'Hardware preflight only. The model and outbound Vercel job service require separate configuration after auditions.'
}
Write-Host "Windows: $($report.Windows)"
Write-Host "CPU: $($report.CPU)"
Write-Host "Memory: $($report.RAMGiB) GiB"
if ($gpuInfo.Count) { $gpuInfo | ForEach-Object { Write-Host "NVIDIA: $_" } }
else { Write-Host 'No nvidia-smi found. GPU capability has not been verified.' }

if ($InstallRuntime) {
  if (-not $gpuInfo.Count) { throw 'Install the NVIDIA driver first; no unverified GPU runtime will be installed.' }
  $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
  if (-not $launcher) {
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) { throw 'Install Python 3.11 from python.org, then rerun with -InstallRuntime.' }
    Run-Checked $winget.Source @('install', '--id', 'Python.Python.3.11', '--exact', '--scope', 'user', '--accept-package-agreements', '--accept-source-agreements')
    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if (-not $launcher) { throw 'Python was installed. Reopen PowerShell so it sees the Python launcher, then rerun this script.' }
  }
  $python = & $launcher.Source '-3.11' '-c' 'import sys; print(sys.executable)'
  if ($LASTEXITCODE -ne 0) { throw 'Python 3.11 is required. Install it with winget install --id Python.Python.3.11 --exact, then rerun.' }
  $venv = Join-Path $InstallRoot 'venv-pascal'
  if (-not (Test-Path (Join-Path $venv 'Scripts\python.exe'))) {
    Run-Checked $python @('-m', 'venv', $venv)
  }
  $venvPython = Join-Path $venv 'Scripts\python.exe'
  Run-Checked $venvPython @('-m', 'pip', 'install', '--upgrade', 'pip')
  # CUDA 12.8+ PyTorch wheels omit Pascal. Keep this audition environment isolated.
  Run-Checked $venvPython @('-m', 'pip', 'install', 'torch==2.6.0', 'torchaudio==2.6.0', '--index-url', 'https://download.pytorch.org/whl/cu118')
  $probe = @'
import json, torch
if not torch.cuda.is_available():
    raise SystemExit("PyTorch cannot use CUDA. Check the NVIDIA driver.")
props = torch.cuda.get_device_properties(0)
a = torch.ones((256, 256), device="cuda", dtype=torch.float32)
b = a @ a
torch.cuda.synchronize()
if b[0, 0].item() != 256:
    raise SystemExit("CUDA arithmetic check failed.")
print(json.dumps({"torch": torch.__version__, "cuda": torch.version.cuda, "gpu": props.name,
 "compute_capability": [props.major, props.minor], "vram_gib": round(props.total_memory/2**30, 2),
 "cuda_arithmetic": "passed"}))
'@
  $probePath = Join-Path $InstallRoot 'check_cuda.py'
  Set-Content -Path $probePath -Value $probe -Encoding UTF8
  Run-Checked $venvPython @($probePath)
  $report.RuntimeInstalled = $true
  $report.Note = 'Pinned CUDA runtime passed arithmetic. This does not prove any specific voice model fits or meets the narration quality target.'
}
$reportPath = Join-Path $InstallRoot 'hardware-report.json'
$report | ConvertTo-Json -Depth 4 | Set-Content -Path $reportPath -Encoding UTF8
Write-Host "Saved hardware report: $reportPath"
Write-Host 'No Mac connection is needed. The final worker will fetch jobs from Vercel over outbound HTTPS.'
Write-Host 'No Vercel worker has been registered by this preparation script.'
