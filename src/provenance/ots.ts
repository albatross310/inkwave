// OpenTimestamps → Bitcoin anchoring (v4 spec §9, M2) — client side.
//
// The OTS library is a Node dependency (global Buffer, node crypto/fs) that does not bundle cleanly
// into the SPA's SSR/prerender build, so stamping/upgrading run in a stateless serverless relay
// (`/api/ots`, the spec's sanctioned `api/stamp` fallback — logs nothing, only handles a hash). The
// proofs live with the writer; VERIFICATION (M5) runs client-side against Bitcoin with no Inkwave
// server, so the existence guarantee stays independent of us.
//
// Every call degrades gracefully: on any failure the proof state is left unchanged by the caller.

import type { OtsProofState } from '../types/document'

const OTS_ENDPOINT = '/api/ots'

async function callRelay(body: Record<string, unknown>): Promise<OtsProofState | null> {
  try {
    const res = await fetch(OTS_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    return (await res.json()) as OtsProofState
  } catch {
    return null // offline / relay down — caller keeps the prior state
  }
}

/** Submit `bundleHash` → a complete PENDING proof, or null on failure. */
export async function stampBundle(bundleHashHex: string): Promise<OtsProofState | null> {
  return callRelay({ action: 'stamp', bundleHash: bundleHashHex })
}

/** Ask the calendars to upgrade a pending proof; returns 'confirmed' once Bitcoin has it, else the
 *  (possibly freshened) pending state, or null on failure. */
export async function upgradeProof(
  proofBase64: string,
  bundleHashHex: string,
): Promise<OtsProofState | null> {
  return callRelay({ action: 'upgrade', proofBase64, bundleHash: bundleHashHex })
}
