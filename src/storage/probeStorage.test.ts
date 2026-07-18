// @vitest-environment jsdom
// THE PRIVATE-WINDOW DETECTOR, PROVED — both ways.
//
// This classifier decides whether the full-screen storage-error panel keeps its SAFE default
// ("your writing is still here") or switches to the private-window message ("Inkwave can't save
// here"). Getting it wrong in EITHER direction ships a scary lie:
//   • flag a real transient failure as private-mode ⇒ a genuine writer is told their storage is
//     broken and their work is gone — the exact INVERSE of the 2026-07-15 bug this whole screen
//     exists to prevent.
//   • flag a real private window as transient ⇒ the writer is reassured "nothing was deleted" while
//     nothing was ever saved — the current bug.
// So the suite is MUTATION-PROVED: a classifier hard-wired to either verdict must fail the other's
// test. A `expect(x).toBe(true)` suite that a constant `() => true` passes proves nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { probeStorageUnavailable } from './probeStorage'

// MOCK ISOLATION — NO navigator.storage MOCK MAY SURVIVE A TEST.
//
// These tests install fake `navigator.storage.getDirectory`s that RESOLVE, REJECT, or are ABSENT to
// exercise the probe. A leaked reject-mock is not a cosmetic tidiness issue: another suite's
// "brand-new document opens normally" reads the same storage surface, and a getDirectory that
// rejects makes a genuine document look like it is in a private window — the exact scary-lie inverse,
// surfacing as a red test instead of the UI. (openDocArchiveFail.test.ts reinstalls its own OPFS
// shim per test, so it is defended anyway — but "the next suite happens to override it" is not
// isolation. This file leaves `navigator` EXACTLY as it found it, per test.)
//
// Restore the EXACT pre-test own-descriptor: if there was none (jsdom has no navigator.storage), the
// own property we added must be DELETED, not overwritten with `undefined` — leaving an own
// `storage: undefined` behind is itself a mutation that outlives the file.
let prevDesc: PropertyDescriptor | undefined

beforeEach(() => {
  prevDesc = Object.getOwnPropertyDescriptor(navigator, 'storage')
})

function setStorage(value: unknown): void {
  Object.defineProperty(navigator, 'storage', { value, configurable: true, writable: true })
}

afterEach(() => {
  if (prevDesc) Object.defineProperty(navigator, 'storage', prevDesc)
  else delete (navigator as { storage?: unknown }).storage // remove the own prop we added
  vi.restoreAllMocks()
})

describe('probeStorageUnavailable', () => {
  it('getDirectory RESOLVES ⇒ storage works ⇒ NOT unavailable (Chrome incognito, iOS Safari, normal)', async () => {
    setStorage({ getDirectory: () => Promise.resolve({} as FileSystemDirectoryHandle) })
    // A classifier hard-wired to "unavailable" (constant true) FAILS here — and would reintroduce
    // Peter's scary-lie inverse: telling a working writer their storage is gone.
    expect(await probeStorageUnavailable()).toBe(false)
  })

  it('getDirectory REJECTS ⇒ unavailable (Firefox private window)', async () => {
    setStorage({ getDirectory: () => Promise.reject(new Error('SecurityError')) })
    // A classifier hard-wired to "transient" (constant false) FAILS here — the current bug: the
    // reassurance "your writing is still here" shown in a window that can save nothing.
    expect(await probeStorageUnavailable()).toBe(true)
  })

  it('navigator.storage.getDirectory ABSENT ⇒ unavailable (no OPFS at all)', async () => {
    setStorage({}) // storage object exists but no getDirectory
    expect(await probeStorageUnavailable()).toBe(true)
  })

  it('navigator.storage itself absent ⇒ unavailable', async () => {
    setStorage(undefined)
    expect(await probeStorageUnavailable()).toBe(true)
  })

  it('does NOT reject even if the probe throws synchronously — resolves to the safe default is a decision, a throw is a blank page', async () => {
    setStorage({ getDirectory: () => { throw new Error('sync throw') } })
    // A synchronous throw is caught like a rejection ⇒ unavailable. The one thing it must never do
    // is propagate: the component starts safe and only switches on a boolean, so a throw here would
    // be an unhandled rejection, not a message.
    await expect(probeStorageUnavailable()).resolves.toBe(true)
  })
})
