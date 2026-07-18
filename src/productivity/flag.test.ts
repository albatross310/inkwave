// @vitest-environment jsdom
//
// THE PRODUCTIVITY-LAYER FLAG DEFAULTS — mutation-proved.
//
// After 2026-07-18 the two lanes in flag.ts have DIFFERENT defaults, and both matter:
//   • prodReport (P1c AI report)  — GRADUATED to default-ON. Finished, backend-free.
//   • prodGraphs (P1a-viz)        — STILL default-OFF. Its only caller is the `/productivity` ROUTE,
//                                   and Peter's ethos is "no routes, all panels"; graduating it would
//                                   ship a route. This file GUARDS that it did NOT get graduated by
//                                   accident when prodReport did.
//
// Mutations checked to kill a test:
//   • report reader `!== '0'` → `=== '1'`  ⇒ "prodReport is ON by default" fails.
//   • report off-path `setItem('0')` → `removeItem` ⇒ "off is sticky" fails.
//   • graphs reader `=== '1'` → `!== '0'`  ⇒ "prodGraphs stays OFF" fails.
//
// jsdom so localStorage/location exist (node has neither).

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  prodReportEnabled, prodReportDemo, setProdReportEnabled,
  prodGraphsEnabled, prodGraphsDemo, __resetFlagsForTest,
} from './flag'

beforeEach(() => {
  localStorage.clear()
  window.history.replaceState({}, '', '/')
  __resetFlagsForTest()
})
afterEach(() => {
  localStorage.clear()
  __resetFlagsForTest()
})

describe('prodReport — DEFAULT ON (graduated 2026-07-18)', () => {
  it('is ON with no flag set', () => {
    // Mutant: reader `=== \'1\'` ⇒ dies.
    expect(prodReportEnabled()).toBe(true)
    expect(prodReportDemo()).toBe(false) // demo is a separate, still-off flag
  })

  it('?prodReport=off disables it and writes a sticky \'0\'', () => {
    window.history.replaceState({}, '', '/?prodReport=off')
    expect(prodReportEnabled()).toBe(false)
    expect(localStorage.getItem('inkwave:prodReport')).toBe('0')
  })

  it('setProdReportEnabled(false) is a sticky off that survives a reload', () => {
    setProdReportEnabled(false)
    expect(prodReportEnabled()).toBe(false)
    expect(localStorage.getItem('inkwave:prodReport')).toBe('0') // mutant removeItem ⇒ dies
    __resetFlagsForTest() // fresh load
    expect(prodReportEnabled()).toBe(false)
  })

  it('setProdReportEnabled(true) clears a prior opt-out', () => {
    setProdReportEnabled(false)
    setProdReportEnabled(true)
    expect(prodReportEnabled()).toBe(true)
  })
})

describe('prodGraphs — STILL DEFAULT OFF (a route, not a panel)', () => {
  it('is OFF with no flag set — NOT graduated alongside prodReport', () => {
    // Mutant: reader `!== \'0\'` (the on-default) ⇒ this dies. Guards the route from shipping live.
    expect(prodGraphsEnabled()).toBe(false)
    expect(prodGraphsDemo()).toBe(false)
  })

  it('KNOWN-POSITIVE: ?prodGraphs=1 still turns it on, so the OFF above is a real default not a stuck flag', () => {
    window.history.replaceState({}, '', '/?prodGraphs=1')
    expect(prodGraphsEnabled()).toBe(true)
  })
})
