// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { WorkspaceNavigation, workspacePreviewJson, workspacePreviewText } from './WorkspaceNavigation'
import { workspaceSwipeSettleX } from '../workspace/gesture'
import { replaceWorkspacePanelHistory } from '../workspace/history'
import type { InkwaveDocument } from '../types/document'

function doc(contentJson: InkwaveDocument['contentJson']): InkwaveDocument {
  return {
    id: 'page',
    title: 'Page',
    contentJson,
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    schemaVersion: '0.1.0',
    scasLimitN: 'infinite',
    scasSessionSeed: 'seed',
  }
}

describe('workspace static neighbour', () => {
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    document.querySelector('.inkwave-editor-surface')?.remove()
    document.documentElement.classList.remove('iw-no-swipe-nav')
  })

  it('extracts an inert label without mounting another editor', () => {
    const text = workspacePreviewText(doc({
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Heading' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Some prose.' }] },
      ],
    }))
    expect(text).toBe('Heading\nSome prose.')
  })

  it('bounds the prepainted rich neighbour without flattening its formatting', () => {
    const preview = workspacePreviewJson({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '123456789' }] },
      ],
    }, 10)
    expect(preview.content?.[0]).toMatchObject({ type: 'heading', attrs: { level: 2 } })
    expect(preview.content?.[1]?.content?.[0]?.text).toBe('123')
  })

  it('settles from the finger velocity monotonically with no slow-start or endpoint jump', () => {
    const values = Array.from({ length: 31 }, (_, index) =>
      workspaceSwipeSettleX(-140, -1440, -1.8, index * 10, 300))
    expect(values[0]).toBe(-140)
    expect(values[values.length - 1]).toBe(-1440)
    expect(values[1]).toBeLessThan(values[0])
    for (let index = 1; index < values.length; index++) {
      expect(values[index]).toBeLessThanOrEqual(values[index - 1])
      expect(values[index]).toBeGreaterThanOrEqual(-1440)
    }
    expect(Math.abs(values[values.length - 2] + 1440)).toBeLessThan(4)
  })

  it('follows one horizontal wheel stream, leaves vertical native, and commits only after release', async () => {
    vi.useFakeTimers()
    const surface = document.createElement('div')
    surface.className = 'inkwave-editor-surface iw-fill'
    const box = document.createElement('div')
    box.className = 'iw-magnify-box'
    surface.appendChild(box)
    document.body.appendChild(surface)
    const onNavigate = vi.fn(async () => {})
    const onNavigateTo = vi.fn(async () => {})
    const right = doc({ type: 'doc', content: [{ type: 'paragraph' }] })
    render(
      <WorkspaceNavigation
        activeId="mail"
        left={null}
        right={right}
        onNavigate={onNavigate}
        onNavigateTo={onNavigateTo}
      />,
    )

    const rightSlot = document.querySelector('.iw-workspace-swipe-slot--right') as HTMLElement
    const strip = document.querySelector('.iw-workspace-swipe-strip') as HTMLElement
    expect(rightSlot).not.toBeNull()
    expect(rightSlot.style.transform).toBe('') // the exact +100vw offset is declarative CSS
    expect(document.querySelectorAll('.ProseMirror')).toHaveLength(0)

    const vertical = new WheelEvent('wheel', { deltaX: 3, deltaY: 50, cancelable: true })
    surface.dispatchEvent(vertical)
    expect(vertical.defaultPrevented).toBe(false)
    expect(onNavigate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(91) // the next physical gesture re-arms after the vertical one settles

    const horizontal = new WheelEvent('wheel', { deltaX: -40, deltaY: 2, cancelable: true })
    surface.dispatchEvent(horizontal)
    expect(horizontal.defaultPrevented).toBe(true)
    expect(onNavigate).not.toHaveBeenCalled()
    expect(strip.style.transform).toBe('translate3d(-40.00px,0,0)')
    expect(box.style.transform).toBe(strip.style.transform)
    expect(box.style.transform).not.toContain('rotate')

    const momentum = new WheelEvent('wheel', { deltaX: -90, deltaY: 0, cancelable: true })
    surface.dispatchEvent(momentum)
    expect(momentum.defaultPrevented).toBe(true)
    expect(onNavigate).not.toHaveBeenCalled()

    await act(async () => { vi.advanceTimersByTime(91); await Promise.resolve(); await Promise.resolve() })
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate).toHaveBeenCalledWith(1, { interactive: true })
    expect(document.documentElement.classList.contains('iw-no-swipe-nav')).toBe(true)
  })

  it('consumes the full momentum stream before the active editor surface remount', async () => {
    vi.useFakeTimers()
    const firstSurface = document.createElement('div')
    firstSurface.className = 'inkwave-editor-surface iw-fill'
    document.body.appendChild(firstSurface)
    const onNavigate = vi.fn(async () => {})
    const onNavigateTo = vi.fn(async () => {})
    const page = doc({ type: 'doc', content: [{ type: 'paragraph' }] })
    const view = render(
      <WorkspaceNavigation activeId="mail" left={null} right={page} onNavigate={onNavigate} onNavigateTo={onNavigateTo} />,
    )

    firstSurface.dispatchEvent(new WheelEvent('wheel', {
      deltaX: -40, deltaY: 0, cancelable: true,
    }))
    firstSurface.dispatchEvent(new WheelEvent('wheel', {
      deltaX: -90, deltaY: 0, cancelable: true,
    }))
    expect(onNavigate).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(91); await Promise.resolve(); await Promise.resolve() })
    expect(onNavigate).toHaveBeenCalledTimes(1)

    firstSurface.remove()
    const nextSurface = document.createElement('div')
    nextSurface.className = 'inkwave-editor-surface iw-fill'
    document.body.appendChild(nextSurface)
    view.rerender(
      <WorkspaceNavigation activeId="page" left={page} right={null} onNavigate={onNavigate} onNavigateTo={onNavigateTo} />,
    )

    // Any exceptionally late residual sample is still consumed and cannot synchronously bounce
    // the newly mounted editor back.
    const tail = new WheelEvent('wheel', { deltaX: -90, deltaY: 0, cancelable: true })
    nextSurface.dispatchEvent(tail)
    expect(tail.defaultPrevented).toBe(true)
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('routes a marked browser Back/Forward entry to its panel without a page reload', async () => {
    const surface = document.createElement('div')
    surface.className = 'inkwave-editor-surface iw-fill'
    document.body.appendChild(surface)
    const onNavigateTo = vi.fn(async () => {})
    const page = doc({ type: 'doc', content: [{ type: 'paragraph' }] })
    render(
      <WorkspaceNavigation
        activeId="mail"
        left={null}
        right={page}
        onNavigate={async () => {}}
        onNavigateTo={onNavigateTo}
      />,
    )

    replaceWorkspacePanelHistory('page')
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    await act(async () => { await Promise.resolve() })

    expect(onNavigateTo).toHaveBeenCalledWith('page')
  })

  it('queues the latest browser-history entry while a panel is still revealing', async () => {
    const surface = document.createElement('div')
    surface.className = 'inkwave-editor-surface iw-fill'
    document.body.appendChild(surface)
    let finishFirst!: () => void
    const first = new Promise<void>((resolve) => { finishFirst = resolve })
    const onNavigateTo = vi.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue(undefined)
    render(
      <WorkspaceNavigation
        activeId="mail"
        left={null}
        right={doc({ type: 'doc', content: [{ type: 'paragraph' }] })}
        onNavigate={async () => {}}
        onNavigateTo={onNavigateTo}
      />,
    )

    replaceWorkspacePanelHistory('page')
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    replaceWorkspacePanelHistory('email-two')
    window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    expect(onNavigateTo).toHaveBeenCalledTimes(1)

    finishFirst()
    await act(async () => { await first; await Promise.resolve(); await Promise.resolve() })
    expect(onNavigateTo).toHaveBeenNthCalledWith(2, 'email-two')
  })
})
