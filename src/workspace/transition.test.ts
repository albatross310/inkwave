// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runWorkspacePanelTransition } from './transition'

describe('workspace panel transition', () => {
  afterEach(() => {
    document.querySelector('.inkwave-editor-surface')?.remove()
    delete document.documentElement.dataset.iwWorkspaceSlide
    vi.restoreAllMocks()
  })

  it('uses a directional same-document transition and cleans its root marker', async () => {
    const surface = document.createElement('div')
    surface.className = 'inkwave-editor-surface iw-fill'
    surface.innerHTML = '<div class="iw-magnify-box"></div>'
    document.body.appendChild(surface)
    const update = vi.fn(async () => {})
    const start = vi.fn((callback: () => Promise<void>) => {
      const done = callback()
      return { ready: Promise.resolve(), finished: done }
    })
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false }),
    })

    await expect(runWorkspacePanelTransition(-1, update)).resolves.toBe('animated')
    expect(start).toHaveBeenCalledOnce()
    expect(update).toHaveBeenCalledOnce()
    expect(document.documentElement.hasAttribute('data-iw-workspace-slide')).toBe(false)
  })

  it('switches instantly for reduced motion without invoking the snapshot API', async () => {
    const surface = document.createElement('div')
    surface.className = 'inkwave-editor-surface iw-fill'
    document.body.appendChild(surface)
    const start = vi.fn()
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: true }),
    })
    const update = vi.fn()

    await expect(runWorkspacePanelTransition(1, update)).resolves.toBe('instant')
    expect(update).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
  })

  it('defines directional slide frames with no panel fade', () => {
    const css = readFileSync(resolve(__dirname, '../styles/index.css'), 'utf8')
    expect(css).toContain('::view-transition-old(iw-workspace-outgoing)')
    expect(css).toContain('::view-transition-new(iw-workspace-incoming)')
    for (const name of [
      'iw-workspace-slide-old-left', 'iw-workspace-slide-new-right',
      'iw-workspace-slide-old-right', 'iw-workspace-slide-new-left',
    ]) {
      const block = css.slice(css.indexOf(`@keyframes ${name}`), css.indexOf('}', css.indexOf(`@keyframes ${name}`)) + 1)
      expect(block).toContain('opacity: 1')
      expect(block).not.toMatch(/opacity:\s*0/)
    }
  })
})
