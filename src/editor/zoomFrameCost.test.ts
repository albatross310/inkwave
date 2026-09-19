import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, './Scroll.tsx'), 'utf8')
const css = readFileSync(resolve(__dirname, '../styles/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const frame = code.slice(code.indexOf('const applyMagnifyFrame'), code.indexOf('const applyFrame'))
const magnifyAnchor = code.slice(code.indexOf('const applyMagnifyAnchor'), code.indexOf('const applyMagnifyFrame'))
const sharedFrame = code.slice(code.indexOf('const applyFrame'), code.indexOf('const scheduleFrame'))
const waveWriter = code.slice(code.indexOf('const writeWave'), code.indexOf('const apply = () =>', code.indexOf('const writeWave')))

describe('whole-page GPU zoom frame cost', () => {
  it('keeps every whole-page zoom frame geometry-read-free', () => {
    expect(source).toMatch(/getBoundingClientRect\(\)/) // known-positive: the source still measures at boundaries
    expect(source).toMatch(/offsetHeight/)              // known-positive: ResizeObserver refreshes the cache
    expect(frame).toContain('applyMagnifyAnchor')
    expect(magnifyAnchor).toContain('anchoredScrollTarget')
    expect(magnifyAnchor).not.toMatch(/getBoundingClientRect\(\)/)
    expect(magnifyAnchor).toContain('centredPageLeft')
    expect(magnifyAnchor).not.toMatch(/offsetHeight/)
    expect(frame).not.toMatch(/getBoundingClientRect\(\)|offsetHeight/)
  })

  it('returns from a water-only frame before measuring text geometry', () => {
    const emptyStepReturn = sharedFrame.indexOf('if (!net) return')
    const editorRectRead = sharedFrame.indexOf('el.getBoundingClientRect()')

    expect(emptyStepReturn).toBeGreaterThan(-1)
    expect(editorRectRead).toBeGreaterThan(emptyStepReturn)
  })

  it('does not rewrite a visually unchanged wave scene during anchored zoom scrolling', () => {
    const unchangedReturn = waveWriter.indexOf('if (wx === lastWaveX) return')
    expect(unchangedReturn).toBeGreaterThan(-1)
    expect(waveWriter.indexOf("el.style.setProperty('--wave-x'")).toBeGreaterThan(unchangedReturn)
    expect(waveWriter.indexOf('swayFields(el, wx)')).toBeGreaterThan(unchangedReturn)
  })

  it('firebreaks the inherited magnify value before the document subtree', () => {
    expect(css).toMatch(/\.iw-magnify-box\s*>\s*div\s*>\s*\*\s*\{\s*--iw-magnify:\s*1\s*;/)
  })

  it('prepares the parchment compositor layer only while Shift is physically held', () => {
    expect(css).toMatch(/\[data-iw-magnify-armed\]\[data-iw-webkit-transform-magnify\][^{]*\.iw-magnify-box\s*>\s*div\s*\{\s*will-change:\s*transform\s*;/)
    expect(source).toContain("el.toggleAttribute('data-iw-magnify-armed', armed)")
    expect(source).toContain("if (e.key === 'Shift') beginShiftTransaction()")
    expect(source).toContain("if (e.key === 'Shift') endShiftTransaction()")
    expect(source).toMatch(/const beginShiftTransaction[\s\S]*?setMagnifyArmed\(true\)/)
    expect(source).toMatch(/const endShiftTransaction[\s\S]*?setMagnifyArmed\(false\)/)
  })

  it('keeps WebKit on transform throughout while allowing Chromium a fresh rest raster', () => {
    expect(css).toMatch(/@supports\s*\(zoom:\s*1\)/)
    expect(css).toMatch(/:not\(\[data-iw-magnify-moving\]\):not\(\[data-iw-webkit-transform-magnify\]\)[^{]*\{\s*zoom:\s*var\(--iw-magnify/)
    expect(source).toContain("el.toggleAttribute('data-iw-webkit-transform-magnify', webkit)")
    expect(css).not.toMatch(/:not\(\[data-iw-magnify-armed\]\):not\(\[data-iw-magnify-moving\]\)/)
    expect(source).toContain("el.setAttribute('data-iw-magnify-moving', '')")
    expect(source).toContain("el.removeAttribute('data-iw-magnify-moving')")
    const waterInput = code.slice(code.indexOf("if (mode === 'water')"), code.indexOf("} else if", code.indexOf("if (mode === 'water')")))
    const moving = waterInput.indexOf("setAttribute('data-iw-magnify-moving'")
    expect(waterInput.indexOf('settledBoxRect')).toBeLessThan(moving) // X preserves the pre-switch pixel
    expect(waterInput.indexOf('const cursor')).toBeGreaterThan(moving) // Y measures moving geometry
  })

  it('hard-stops vertical motion without swallowing the next physical zoom input', () => {
    expect(source).toContain("el.style.setProperty('overflow-y', 'hidden')")
    expect(source).toMatch(/const beginShiftTransaction[\s\S]*?if \(physicalShiftHeld\) return[\s\S]*?setShiftScrollFrozen\(true\)/)
    expect(code).not.toContain('shiftTailBlocked')
    expect(code).not.toContain('plainTailBlocked')
    const boundary = code.slice(code.indexOf('const endShiftTransaction'), code.indexOf('let ctrlHeld'))
    expect(boundary.indexOf('if (mSteps) applyMagnifyFrame()')).toBeGreaterThan(-1)
    expect(boundary.indexOf('if (mSteps) applyMagnifyFrame()')).toBeLessThan(boundary.indexOf('setShiftScrollFrozen(false)'))
  })

  it('coalesces to the display frame without a second timer cadence', () => {
    const schedule = code.slice(code.indexOf('const requestApplyFrame'), code.indexOf('const latch ='))
    expect(schedule).toContain('requestAnimationFrame(applyFrame)')
    expect(schedule).not.toContain('cadenceWait')
    expect(schedule).not.toContain('zoomFrameInterval')
  })

  it('replaces a fine-input release with one bounded analytic coast before the well', () => {
    expect(source).toContain('const releaseMagnifyWithCoast')
    expect(source).toContain('exponentialCoastOffset(initialVelocity, elapsed, WATER_COAST_TAU_MS, WATER_COAST_MAX_STEPS)')
    expect(source).toContain('Math.exp(-elapsed / WATER_COAST_TAU_MS)')
    expect(source).toContain('waterTrackpadGesture ||= e.deltaMode === WheelEvent.DOM_DELTA_PIXEL')
  })

  it('does not rebind magnetic geometry when Shift temporarily removes WebKit’s scrollbar gutter', () => {
    const fit = code.slice(code.indexOf('const computeFit'), code.indexOf('const ro = new ResizeObserver'))
    expect(fit).toContain("if (el.hasAttribute('data-iw-shift-scroll-frozen')) return")
    expect(fit.indexOf("if (el.hasAttribute('data-iw-shift-scroll-frozen'))")).toBeLessThan(fit.indexOf('setFitContext('))
    expect(fit.indexOf("if (el.hasAttribute('data-iw-shift-scroll-frozen')) return")).toBeLessThan(fit.indexOf('centringWidth = measuredAvailableWidth'))
  })

  it('drops pending text movement before a fresh Shift gesture can enter the shared frame', () => {
    const boundary = code.slice(code.indexOf('const beginShiftTransaction'), code.indexOf('const endShiftTransaction'))
    expect(boundary).toMatch(/if \(physicalShiftHeld\) return\s*steps = 0/)
    expect(boundary.indexOf('steps = 0')).toBeLessThan(boundary.indexOf('setShiftScrollFrozen(true)'))
    expect(source).toContain("physicalShiftHeld && hybrid ? 'water' : zoomModeForWheel(e, hybrid)")
    expect(source).toContain("requestedMode === 'water'\n        ? omnidirectionalZoomDelta")
  })
})
