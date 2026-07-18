// @vitest-environment jsdom
//
// THE PRODUCTIVITY-LAYER FLAG DEFAULTS — mutation-proved.
//
// After 2026-07-18 BOTH lanes in flag.ts are default-ON, and each is mutation-proved both ways:
//   • prodReport (P1c AI report)  — GRADUATED to default-ON. Finished, backend-free.
//   • prodGraphs (P1a-viz)        — GRADUATED to default-ON (feat/prodgraphs-panel). The charts are a
//                                   portalled panel off the clock drop-up now, not the `/productivity`
//                                   route (retired), so "no routes, all panels" is satisfied and the
//                                   finished charts ship live. This file GUARDS the new default and
//                                   that OFF is a STICKY '0' (not an absence — with the default ON,
//                                   removeItem would silently re-enable it).
//
// Mutations checked to kill a test (proven by hand, both directions):
//   • report reader  `!== '0'` → `=== '1'`  ⇒ "prodReport is ON by default" fails.
//   • report off-path `setItem('0')` → `removeItem` ⇒ "report off is sticky" fails.
//   • graphs reader  `!== '0'` → `=== '1'`  ⇒ "prodGraphs is ON by default" fails.
//   • graphs default `true` → `false` in graphFlags() ⇒ "prodGraphs is ON by default" fails.
//   • graphs off-path `setItem('0')` → `removeItem` ⇒ "graphs off is sticky" fails.
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

describe('prodGraphs — DEFAULT ON (graduated 2026-07-18, a panel now)', () => {
  it('is ON with no flag set', () => {
    // Mutants: reader `=== \'1\'`, or the graphFlags() default `false`, ⇒ this dies.
    expect(prodGraphsEnabled()).toBe(true)
    expect(prodGraphsDemo()).toBe(false) // demo is a separate, still-off flag
  })

  it('?prodGraphs=off disables it and writes a sticky \'0\'', () => {
    window.history.replaceState({}, '', '/?prodGraphs=off')
    expect(prodGraphsEnabled()).toBe(false)
    // Mutant: off-path `removeItem` instead of setItem(\'0\') ⇒ this dies (an absence re-enables it).
    expect(localStorage.getItem('inkwave:prodGraphs')).toBe('0')
  })

  it('a sticky \'0\' survives a reload (mutant removeItem ⇒ dies here too)', () => {
    window.history.replaceState({}, '', '/?prodGraphs=off')
    expect(prodGraphsEnabled()).toBe(false)
    __resetFlagsForTest() // fresh load, URL param gone
    window.history.replaceState({}, '', '/')
    expect(prodGraphsEnabled()).toBe(false)
  })

  it('KNOWN-POSITIVE: ?prodGraphs=1 clears a prior opt-out, so OFF is a real state not a stuck flag', () => {
    window.history.replaceState({}, '', '/?prodGraphs=off')
    expect(prodGraphsEnabled()).toBe(false)
    __resetFlagsForTest()
    window.history.replaceState({}, '', '/?prodGraphs=1')
    expect(prodGraphsEnabled()).toBe(true)
  })

  it('?prodGraphs=demo turns it on plus demo mode', () => {
    window.history.replaceState({}, '', '/?prodGraphs=demo')
    expect(prodGraphsEnabled()).toBe(true)
    expect(prodGraphsDemo()).toBe(true)
  })
})
