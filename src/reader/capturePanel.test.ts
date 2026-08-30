// THE CAPTURE PANEL'S DOCUMENT-LEVEL LISTENERS MUST BE CANCELLABLE, AND ITS REMOVAL MUST FUNNEL.
//
// `extension-src/entrypoints/content-source.ts` runs on `<all_urls>` and lives as long as the tab.
// A listener it puts on `document` outlives the panel that owns it unless something cancels it, and
// the shipped code cancelled the drag's `mousemove`/`mouseup` from a `{ once: true }` handler on
// the CLOSE BUTTON — one of two ways the panel goes away. The other is the removal at the top of
// `showCapturePanel`, taken on every re-show (a second capture, or the `tabs.onUpdated` re-injection
// after a reload), which dropped the panel without any click and leaked both listeners plus the
// detached panel they held.
//
// This is a SOURCE guard rather than a behavioural one, and that is a deliberate cost decision, not
// laziness: `content-source.ts` calls `defineContentScript` at module top level, so importing it
// EXECUTES it, and reaching it at all needs a `browser` stub plus a second vitest project for a
// workspace outside `tsconfig.app.json`. The two rules below are the whole of what the fix
// establishes, and they are checkable in ~5ms with none of that. See the report for the full
// costing of the harness route.
//
// ⚠ COMMENTS ARE STRIPPED BEFORE SCANNING, and here that is not a formality: the fix's own comment
// has to say `panel.remove()` and `{ once: true }` in order to explain what must never come back,
// so a guard reading raw text would fire on its own documentation. Third instance of this pattern
// in the repo (claims.test.ts, micBoundary.ts). Judge what the code DOES, never prose about it.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FILE = join(process.cwd(), 'extension-src/entrypoints/content-source.ts')

/** Strip block and line comments. The `[^:]` guard keeps `https://` out of the line-comment rule. */
function code(): string {
  return readFileSync(FILE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('the capture panel cannot leak a document listener', () => {
  it('VOID GUARD: the scan is looking at the real content script', () => {
    // Every assertion below is of the form "no bad occurrences". On an empty or moved file that is
    // vacuously true, so the sweep proves it can see the subject before any verdict is read.
    const src = code()
    expect(src.length, 'content-source.ts is empty or missing').toBeGreaterThan(5000)
    expect(src).toContain('inkwave-capture-panel')
    expect(src, 'the drag was removed entirely — re-aim this guard').toContain("addEventListener('mousemove'")
  })

  it('every document-level listener is cancellable', () => {
    // The general form of the bug, and the one that catches the NEXT listener somebody adds rather
    // than only the two that leaked. A listener on `document` from a content script has no natural
    // end; it must carry an AbortSignal (or be `{ once: true }`, which ends itself).
    const src = code()
    const calls = src.match(/document\.addEventListener\([^)]*\)/g) ?? []
    expect(calls.length, 'no document listeners found — the scan missed them').toBeGreaterThan(0)
    const uncancellable = calls.filter(c => !/signal\s*:/.test(c) && !/once\s*:\s*true/.test(c))
    expect(uncancellable, `document listener with no signal: ${uncancellable.join(' | ')}`).toEqual([])
  })

  it('the panel is removed only through the funnel', () => {
    // `removeCapturePanel` aborts the drag and then removes. A bare `.remove()` on the panel — by
    // id or by the local `panel` binding — is the exact shape of the shipped leak.
    const src = code()
    expect(src, 'the removal funnel is gone').toContain('function removeCapturePanel')

    const byId = src.match(/getElementById\(\s*['"]inkwave-capture-panel['"]\s*\)\s*\??\.\s*remove\(\)/g) ?? []
    expect(byId, 'the panel is removed by id without cancelling the drag').toEqual([])

    // `panel.remove()` — the close button's old path. Inner elements (`input.remove()`, a fill row,
    // the warnings block) are fine and deliberately not matched: they are children of the panel and
    // own no document listener.
    const byBinding = src.match(/(?<![A-Za-z0-9_$])panel\s*\.\s*remove\(\)/g) ?? []
    expect(byBinding, 'panel.remove() bypasses removeCapturePanel').toEqual([])
  })

  it('the funnel actually cancels rather than merely existing', () => {
    // A `removeCapturePanel` that only called `el.remove()` would satisfy both rules above while
    // fixing nothing, so the funnel's own body is checked for the abort.
    const src = code()
    const body = src.match(/function removeCapturePanel[\s\S]*?\n\}/)?.[0] ?? ''
    expect(body, 'removeCapturePanel not found').not.toBe('')
    expect(body, 'the funnel removes without aborting the drag').toMatch(/\.abort\(\)/)
    expect(body).toMatch(/\.remove\(\)/)
  })
})
