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

// ── CHARACTERIZATION (added before the shared-flag-core refactor, run green against the unmoved
// module). Both lanes share ONE `resolve()` here, so the cases above already cover the shape they
// have in common. What follows pins the places the two lanes DIFFER from each other and from their
// neighbours — the asymmetries a shared core would quietly even out:
//   • prodGraphs has window overrides; prodReport has NONE. Same file, same resolver, different
//     surface, and nothing in the code says so.
//   • denied storage keeps the DEFAULT (true) here, where the ledger flag next door deliberately
//     falls to FALSE on the same fault because it sits on the keystroke path.
//   • `off` clears the demo companion; `demo` implies on even over a stored '0'.
describe('the productivity flags — characterization', () => {
  it('prodGraphs honours window.__iwProdGraphs / __iwProdGraphsDemo, both directions', () => {
    const w = window as unknown as { __iwProdGraphs?: boolean; __iwProdGraphsDemo?: boolean }
    w.__iwProdGraphs = false
    expect(prodGraphsEnabled()).toBe(false)   // beats the default-ON
    w.__iwProdGraphs = true
    window.history.replaceState({}, '', '/?prodGraphs=off')
    __resetFlagsForTest()
    expect(prodGraphsEnabled()).toBe(true)    // beats a stored '0'
    w.__iwProdGraphsDemo = true
    expect(prodGraphsDemo()).toBe(true)
    delete w.__iwProdGraphs
    delete w.__iwProdGraphsDemo
  })

  it('prodReport has NO window override — __iwProdReport is inert', () => {
    ;(window as unknown as { __iwProdReport?: boolean }).__iwProdReport = false
    expect(prodReportEnabled()).toBe(true)    // the default wins; the global is not consulted
    delete (window as unknown as { __iwProdReport?: boolean }).__iwProdReport
  })

  it('?prodGraphs=off clears a previously stored demo', () => {
    localStorage.setItem('inkwave:prodGraphsDemo', '1')
    window.history.replaceState({}, '', '/?prodGraphs=off')
    expect(prodGraphsDemo()).toBe(false)
    expect(localStorage.getItem('inkwave:prodGraphsDemo')).toBeNull()
  })

  it('?prodReport=demo turns it on even over a stored opt-out', () => {
    localStorage.setItem('inkwave:prodReport', '0')
    window.history.replaceState({}, '', '/?prodReport=demo')
    expect(prodReportEnabled()).toBe(true)
    expect(prodReportDemo()).toBe(true)
  })

  // Denied storage keeps the DEFAULT here. The assertion is deliberately a stored '0' that must be
  // IGNORED, not a bare default: with real storage that '0' reads OFF, so a `true` answer can only
  // mean getItem threw — which is what proves the denied branch was genuinely reached rather than
  // the test agreeing with the default by construction.
  it('keeps the DEFAULT (on) when storage is denied — unlike the ledger flag next door', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!
    localStorage.setItem('inkwave:prodGraphs', '0')
    localStorage.setItem('inkwave:prodReport', '0')
    __resetFlagsForTest()
    expect(prodGraphsEnabled()).toBe(false)  // the known-positive: the '0' really is an opt-out
    try {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
          getItem: () => { throw new Error('denied') },
          setItem: () => { throw new Error('denied') },
          removeItem: () => { throw new Error('denied') },
        },
      })
      __resetFlagsForTest()
      expect(prodGraphsEnabled()).toBe(true)
      expect(prodReportEnabled()).toBe(true)
    } finally {
      Object.defineProperty(window, 'localStorage', real)
    }
  })
})
