#!/usr/bin/env bash
# Run a Playwright/browser command HEADED but contained to a virtual display, so
# nothing pops a window over the desktop on WSLg.
#
# WHY: WSLg exports DISPLAY=:0 + WAYLAND_DISPLAY=wayland-0, so any headed browser
# forwards its window to the Windows host. xvfb-run gives the child its OWN X
# display (:99+), and unsetting WAYLAND_DISPLAY + MOZ_ENABLE_WAYLAND=0 stops the
# Wayland passthrough (the WSLg gotcha that xvfb-run alone does NOT contain,
# especially Firefox). --window-position is a belt-and-suspenders fallback.
#
# Prefer HEADLESS where fidelity allows (no window at all). Use this only when a
# real compositor is needed. NB: xvfb has no GPU — true raster/paint fidelity
# still needs a real device.
#
# Usage:  scripts/pw-headed.sh <your playwright command...>
#   e.g.  scripts/pw-headed.sh node probes/wave-sway.mjs
set -euo pipefail
exec env -u WAYLAND_DISPLAY MOZ_ENABLE_WAYLAND=0 \
  xvfb-run -a --server-args="-screen 0 1600x900x24" \
  "$@"
