// @vitest-environment jsdom
//
// THE DEFAULT OF THE PRODUCTIVITY LEDGER FLAG — mutation-proved both ways.
//
// `?prodLedger` graduated from default-OFF to default-ON on 2026-07-18 (Peter: "take all the flags
// off … for everything"). A default that cannot fail is not a default, so this file pins BOTH
// directions and each was checked to DIE under the obvious mutation:
//   • ON with no flag set   — revert the reader to `=== '1'` (the old off-default) ⇒ the first two
//                             tests fail.
//   • `off` genuinely OFF   — make the off-path `removeItem` (an absence, which with default-ON reads
//                             as ON) ⇒ the disable + stickiness tests fail.
//
// jsdom (not node) so localStorage exists: node has none, and there the gate is deliberately OFF
// (capture must not run during prerender — pinned separately in capture.perf.test.ts).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  prodLedgerEnabled, refreshProdLedgerFlag, setProdLedgerEnabled, _resetProdLedgerFlag,
} from './ledgerFlag'

const KEY = 'inkwave:prodLedger'

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/') // no ?prodLedger param
  _resetProdLedgerFlag()
})
afterEach(() => {
  localStorage.clear()
  _resetProdLedgerFlag()
})

describe('default ON in the browser', () => {
  it('is ON with no flag set and empty storage', () => {
    // Mutant: reader `=== \'1\'` ⇒ null === \'1\' is false ⇒ this dies.
    expect(refreshProdLedgerFlag()).toBe(true)
    expect(prodLedgerEnabled()).toBe(true)
  })

  it('KNOWN-POSITIVE for this harness: a stored \'1\' also reads ON, so the assertion can tell them apart', () => {
    localStorage.setItem(KEY, '1')
    expect(refreshProdLedgerFlag()).toBe(true)
  })
})

describe('off genuinely disables', () => {
  it('setProdLedgerEnabled(false) turns it OFF and writes a STICKY \'0\'', () => {
    setProdLedgerEnabled(false)
    expect(prodLedgerEnabled()).toBe(false)
    // The off must be an explicit \'0\', not an absence — mutant `removeItem` ⇒ default-ON ⇒ dies.
    expect(localStorage.getItem(KEY)).toBe('0')
  })

  it('the \'0\' opt-out survives a reload (re-resolve reads it back)', () => {
    setProdLedgerEnabled(false)
    _resetProdLedgerFlag() // simulate a fresh load: forget the cache, keep storage
    expect(refreshProdLedgerFlag()).toBe(false)
  })

  it('?prodLedger=off writes the sticky \'0\' and disables', () => {
    window.history.replaceState({}, '', '/?prodLedger=off')
    expect(refreshProdLedgerFlag()).toBe(false)
    expect(localStorage.getItem(KEY)).toBe('0')
  })

  it('setProdLedgerEnabled(true) / ?prodLedger=1 clears a prior opt-out', () => {
    setProdLedgerEnabled(false)
    expect(prodLedgerEnabled()).toBe(false)
    setProdLedgerEnabled(true)
    expect(prodLedgerEnabled()).toBe(true)
    // and the URL escape hatch back on
    setProdLedgerEnabled(false)
    _resetProdLedgerFlag()
    window.history.replaceState({}, '', '/?prodLedger=1')
    expect(refreshProdLedgerFlag()).toBe(true)
  })
})
