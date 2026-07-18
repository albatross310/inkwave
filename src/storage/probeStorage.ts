// IS THIS DEVICE'S STORAGE FUNDAMENTALLY UNAVAILABLE, OR DID ONE READ JUST FAIL?
//
// StorageUnavailable (the full-screen panel a writer sees when a read fails) exists because of the
// 2026-07-15 data-loss incident: a TRANSIENT OPFS read failure showed a blank page, Peter thought
// his thesis was gone, and his recovery attempt blind-overwrote real work. For that case — a
// transient failure on WORKING storage — the reassurance "your writing is still here, nothing was
// changed or deleted" is exactly right and load-bearing.
//
// But the SAME screen appears in a private/incognito window, where that reassurance is a LIE: a
// private window has no persistent storage, so there is nothing "still here" and nothing to recover
// via the Storage inspector (which reads OPFS and will be empty/broken). This probe decides which
// message is honest.
//
// THE ASYMMETRY IS THE WHOLE POINT. The transient-failure message is the SAFE DEFAULT; a false
// "you're in private mode" shown to a genuine transient failure on working storage would tell a real
// writer their storage is broken — the exact inverse of the bug we are fixing. So we flag
// "unavailable" ONLY on high confidence.
//
// THE PROBE: `navigator.storage.getDirectory()`, run FRESH.
//   • absent (no navigator.storage / no getDirectory) ⇒ unavailable.
//   • REJECTS ⇒ unavailable. In a Firefox private window getDirectory() itself throws (confirmed
//     in-repo: opfs.ts's readAppJson comment, "In a private window navigator.storage.getDirectory()
//     itself can throw").
//   • RESOLVES ⇒ storage WORKS; the earlier failure was transient ⇒ keep the safe message. Chrome
//     incognito RESOLVES (storage is ephemeral but works for the session — so NOT flagged, correctly:
//     the data IS there for the session). iOS Safari normal mode RESOLVES (OPFS supported 15.2+).
//
// DO NOT use a createWritable write-probe: iOS Safari lacks createWritable (opfsWrite.ts uses a
// worker sync-access fallback), so a write-probe would FALSELY flag normal iOS users as private-mode.
// Probe getDirectory() RESOLUTION ONLY.

/**
 * Resolve to `true` only when this device's storage is PROVABLY unavailable (private/incognito
 * window, or a browser that cannot open OPFS at all). Resolves to `false` when storage works — in
 * which case an earlier read failure was transient and the reassuring default message stands.
 *
 * Never rejects: the caller starts in the SAFE (transient) message and only switches on a `true`,
 * so any surprise in the probe itself must resolve to the safe answer, never throw into a blank.
 */
export async function probeStorageUnavailable(): Promise<boolean> {
  const storage: StorageManager | undefined =
    typeof navigator !== 'undefined' ? navigator.storage : undefined
  // getDirectory absent ⇒ this browser cannot store here at all.
  if (!storage || typeof storage.getDirectory !== 'function') return true
  try {
    await storage.getDirectory()
    return false // it resolved — storage is real; the earlier failure was transient.
  } catch {
    return true // it rejected — a private window (or no OPFS): unavailable.
  }
}
