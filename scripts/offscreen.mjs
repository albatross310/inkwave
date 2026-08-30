// KEEPING A HEADED BROWSER OFF PETER'S SCREEN, ON macOS.
//
// ⚠ `--window-position=-32000,-32000` DOES NOT WORK HERE, and every probe in this repo was using it.
// It is the documented trick on Linux/X11; macOS CLAMPS a window onto a visible display, so the
// window appeared anyway. Peter watched browser windows flash over his desk all evening while the
// scripts claimed to be off-screen — a comment asserting a property nobody measured.
//
// Headless is not the alternative: MEASURED on this machine with a canary rule that BLOCKS a frame,
// across `headless:true`, `--headless=new`, and `channel:'chrome'` — the canary stayed silent in all
// three, so extensions do not load in any headless mode here and an extension probe MUST be headed.
//
// So the window is hidden the way macOS hides an application: System Events sets the process
// invisible. It keeps running, keeps compositing, and never appears. `hideBrowser` returns whether
// it actually took, so a probe can SAY it failed rather than assume it worked — which is the whole
// mistake being corrected.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const run = promisify(execFile)

/** Chromium's process name differs by channel; try the ones Playwright can launch. */
const NAMES = ['Chromium', 'Google Chrome', 'Google Chrome for Testing']

/**
 * Hide any browser process this run started. Returns the name it hid, or null.
 * Never throws: a probe must not fail because a cosmetic step did.
 */
export async function hideBrowser()  {
  if (process.platform !== 'darwin') return null          // Linux probes use xvfb; nothing to do
  for (const name of NAMES) {
    try {
      const { stdout } = await run('osascript', ['-e',
        `tell application "System Events" to if exists process "${name}" then ` +
        `set visible of process "${name}" to false`])
      if (!/error/i.test(stdout)) {
        const { stdout: check } = await run('osascript', ['-e',
          `tell application "System Events" to if exists process "${name}" then ` +
          `get visible of process "${name}"`])
        if (check.trim() === 'false') return name          // verified, not assumed
      }
    } catch { /* not this one */ }
  }
  return null
}

/** Launch args that at least keep it small and out of the way while it exists. */
export const OFFSCREEN_ARGS = ['--window-position=0,3000', '--window-size=1280,900']
