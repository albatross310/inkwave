// Askable completion signal for async media imports. A bare DOM event is insufficient: React can
// mount a NodeView after a very fast OPFS write has already fired it. The monotonically increasing
// version lets a load that began before completion detect that it missed the event and retry once.

const versions = new Map<string, number>()

export function mediaReadyVersion(assetId: string): number {
  return versions.get(assetId) ?? 0
}

export function announceMediaReady(assetId: string): void {
  versions.set(assetId, mediaReadyVersion(assetId) + 1)
  try { window.dispatchEvent(new CustomEvent('inkwave:media-ready', { detail: { assetId } })) } catch { /* non-browser */ }
}
