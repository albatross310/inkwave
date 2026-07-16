// @vitest-environment jsdom
//
// ScoreView's CONTRACT, not its engraving.
//
// OSMD cannot really render here: it measures glyphs through live SVG layout, which jsdom does not
// do. So the engine is mocked and what is asserted is everything ScoreView is actually responsible
// for — the theming class the night palette is scoped to, the colours it hands the engine, the bar
// range it asks for, and that a failure is announced rather than swallowed. Whether the notation is
// BEAUTIFUL is a question for eyes on a browser, and is reported as unverified rather than implied
// by a green test.

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

// ─── the mock engine ─────────────────────────────────────────────────────────────────────────
// A PLAIN recorder, built inside the factory, using no `vi` at all.
//
// vi.mock's factory is hoisted above every import in this .tsx file — including vitest's own — so
// anything it touches (a `vi.hoisted` binding, an `await import('vitest')`) is either in its
// temporal dead zone or circular. Recording calls by hand needs nothing hoisted and nothing
// imported, which sidesteps the whole ordering problem. The assertions below read plain arrays.
interface Recorder {
  ctor: { host: HTMLElement; options: Record<string, unknown> }[]
  loadCalls: string[]
  renders: number
  cursorCalls: string[]
  /** Set by a test to make the next load() reject — the failure path. */
  loadError: Error | null
  reset(): void
}

vi.mock('opensheetmusicdisplay', () => {
  const rec: Recorder = {
    ctor: [], loadCalls: [], renders: 0, cursorCalls: [], loadError: null,
    reset() { rec.ctor = []; rec.loadCalls = []; rec.renders = 0; rec.cursorCalls = []; rec.loadError = null },
  }
  const cursor = {
    reset: () => rec.cursorCalls.push('reset'),
    show: () => rec.cursorCalls.push('show'),
    hide: () => rec.cursorCalls.push('hide'),
    next: () => rec.cursorCalls.push('next'),
    update: () => rec.cursorCalls.push('update'),
    iterator: { EndReached: true, CurrentMeasureIndex: 0 },
  }
  return {
    __rec: rec,
    OpenSheetMusicDisplay: class {
      cursor = cursor
      zoom = 1
      constructor(host: HTMLElement, options: Record<string, unknown>) { rec.ctor.push({ host, options }) }
      async load(xml: string) {
        rec.loadCalls.push(xml)
        if (rec.loadError) throw rec.loadError
      }
      render() { rec.renders++ }
      clear() { /* no-op */ }
    },
  }
})

// Static imports are safe here: vi.mock is hoisted ABOVE them, so ScoreView receives the mock.
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as osmdModule from 'opensheetmusicdisplay'
import { ScoreView } from './ScoreView'
import { SIMPLE_SCALE } from './scoreFixtures'

const rec = (osmdModule as unknown as { __rec: Recorder }).__rec
const optionsPassed = () => rec.ctor[0].options

beforeEach(() => { rec.reset(); document.documentElement.dataset.theme = 'day' })
afterEach(() => {
  // EXPLICIT unmount. @testing-library only auto-cleans when vitest runs with `globals: true`, and
  // this repo does not — so without this every previous test's ScoreView stays mounted, keeps its
  // MutationObserver on <html data-theme>, and re-renders on the next test's theme switch. The
  // theme test then counts 4 constructions instead of 2 and reads as a bug in the component. A
  // leaked mount is a test measuring other tests.
  cleanup()
  delete document.documentElement.dataset.theme
})

describe('ScoreView — theming (MANDATORY, CLAUDE.md)', () => {
  it('puts iw-nightable on its container', () => {
    // Load-bearing TWICE: it themes the chrome, AND the night colour tokens are declared under
    // `:root[data-theme="night"] .iw-nightable` — so without this class resolveScoreColors reads
    // day values and the notation renders black on a charcoal page, with no error at all.
    const { container } = render(<ScoreView xml={SIMPLE_SCALE} />)
    expect(container.querySelector('.iw-nightable')).not.toBeNull()
  })

  it('hands the engine colours, never leaving them to the engine’s defaults', async () => {
    render(<ScoreView xml={SIMPLE_SCALE} />)
    await waitFor(() => expect(rec.ctor.length).toBe(1))
    const opts = optionsPassed()
    // OSMD's own default is black. If we passed nothing, night mode would silently render black.
    expect(opts.defaultColorMusic).toBeTruthy()
    expect(opts.defaultColorTitle).toBeTruthy()
    expect((opts.cursorsOptions as { color: string }[])[0].color).toBeTruthy()
  })

  it('uses no bare hex in the component — colours come from tokens', () => {
    const source = readFileSync(resolve(__dirname, 'ScoreView.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    for (const [, hex] of source.matchAll(/(#[0-9a-fA-F]{6})/g)) {
      // Any hex left must be a var() fallback, exactly like `var(--iw-ink, #5c2d8a)`.
      expect(source, `bare hex ${hex} outside a var() fallback`).toMatch(
        new RegExp(`var\\(--iw-[a-z-]+,\\s*${hex}\\)`),
      )
    }
  })

  it('re-renders when the theme changes — OSMD bakes colours in and cannot restyle itself', async () => {
    render(<ScoreView xml={SIMPLE_SCALE} />)
    await waitFor(() => expect(rec.ctor.length).toBe(1))

    document.documentElement.dataset.theme = 'night'
    // Unlike a var()-styled chart, the SVG's colours are literals written at draw time. Without a
    // redraw the score would stay in day colours until the next full reload.
    await waitFor(() => expect(rec.ctor.length).toBe(2))
  })
})

describe('ScoreView — excerpt range (§B6)', () => {
  it('asks the engine for exactly the bar range it was given', async () => {
    render(<ScoreView xml={SIMPLE_SCALE} fromMeasureNumber={2} toMeasureNumber={3} />)
    await waitFor(() => expect(rec.ctor.length).toBe(1))
    expect(optionsPassed().drawFromMeasureNumber).toBe(2)
    expect(optionsPassed().drawUpToMeasureNumber).toBe(3)
  })

  it('omits the range entirely for a full score', async () => {
    // OSMD gates on `>= 0`, so a stray `undefined` is harmless — but omitting is the honest way to
    // say "no range", and keeps the whole score drawing.
    render(<ScoreView xml={SIMPLE_SCALE} />)
    await waitFor(() => expect(rec.ctor.length).toBe(1))
    expect('drawFromMeasureNumber' in optionsPassed()).toBe(false)
    expect('drawUpToMeasureNumber' in optionsPassed()).toBe(false)
  })

  it('drops the title for an inline excerpt', async () => {
    render(<ScoreView xml={SIMPLE_SCALE} showTitle={false} />)
    await waitFor(() => expect(rec.ctor.length).toBe(1))
    expect(optionsPassed().drawTitle).toBe(false)
    expect(optionsPassed().drawComposer).toBe(false)
  })
})

describe('ScoreView — failure is announced, never an empty box', () => {
  it('reports a load failure to the caller', async () => {
    rec.loadError = new Error('this score is broken')
    const onError = vi.fn()
    render(<ScoreView xml="<nonsense/>" onError={onError} />)
    // An empty score view looks EXACTLY like a score with no notes in it. It has to say something.
    await waitFor(() => expect(onError).toHaveBeenCalledWith('this score is broken'))
  })

  it('does not render when the score fails to load', async () => {
    rec.loadError = new Error('nope')
    const onError = vi.fn()
    render(<ScoreView xml="<nonsense/>" onError={onError} />)
    await waitFor(() => expect(onError).toHaveBeenCalled())
    expect(rec.renders).toBe(0)
  })

  it('renders the score on a successful load, and tells the caller it is ready', async () => {
    const onReady = vi.fn()
    render(<ScoreView xml={SIMPLE_SCALE} onReady={onReady} />)
    await waitFor(() => expect(rec.renders).toBe(1))
    expect(onReady).toHaveBeenCalled()
  })

  it('hands the engine the xml it was given', async () => {
    render(<ScoreView xml={SIMPLE_SCALE} />)
    await waitFor(() => expect(rec.loadCalls).toEqual([SIMPLE_SCALE]))
  })

  it('shows a loading line until the score is engraved', () => {
    render(<ScoreView xml={SIMPLE_SCALE} />)
    expect(screen.getByText(/Engraving the score/)).toBeTruthy()
  })
})

describe('ScoreView — cursor (§B3)', () => {
  it('hides the cursor when there is no position', async () => {
    render(<ScoreView xml={SIMPLE_SCALE} cursorMeasureIndex={null} />)
    await waitFor(() => expect(rec.cursorCalls).toContain('hide'))
  })

  it('shows the cursor when the player gives it a bar', async () => {
    render(<ScoreView xml={SIMPLE_SCALE} cursorMeasureIndex={0} />)
    await waitFor(() => expect(rec.cursorCalls).toContain('show'))
  })
})
