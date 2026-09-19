#!/usr/bin/env bash
set -euo pipefail
MOSS_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MOSS_PYTHON="${MOSS_PYTHON:-python3}"
MOSS_VENV="${MOSS_VENV:-${MOSS_SCRIPT_DIR}/.venv}"
if [[ "${1:-}" == "--check" ]]; then
  exec "${MOSS_PYTHON}" "${MOSS_SCRIPT_DIR}/model_runner.py" --check
fi
if [[ "$(uname -s)" != "Linux" ]]; then
  echo 'This bootstrap targets a Linux GPU audition host. --check and --dry-run work without it.' >&2
  exit 1
fi
"${MOSS_PYTHON}" -c 'import sys; assert sys.version_info[:2] in {(3, 11), (3, 12)}, "Use Python 3.11 or 3.12 for the pinned audition runtime"'
if [[ ! -d "${MOSS_VENV}" ]]; then
  "${MOSS_PYTHON}" -m venv "${MOSS_VENV}"
fi
"${MOSS_VENV}/bin/python" -m pip install --upgrade 'pip==25.3'
"${MOSS_VENV}/bin/python" -m pip install --extra-index-url https://download.pytorch.org/whl/cu128 -r "${MOSS_SCRIPT_DIR}/requirements.txt"
"${MOSS_VENV}/bin/python" -m pip check
"${MOSS_VENV}/bin/python" "${MOSS_SCRIPT_DIR}/model_runner.py" --check
printf 'Runtime ready. Model weights have not been downloaded. Use model_runner.py --dry-run with the audition bundle first.\n'
