// @vitest-environment jsdom

import { createElement, StrictMode } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LoadingTip, LOADING_TIPS, loadingTipFontSize, loadingTipIndex } from './LoadingTip'

describe('loadingTipIndex', () => {
  it('maps the random range across every available tip', () => {
    for (let index = 0; index < LOADING_TIPS.length; index++) {
      expect(loadingTipIndex(() => (index + 0.25) / LOADING_TIPS.length)).toBe(index)
    }
    expect(loadingTipIndex(() => 0.9999)).toBe(LOADING_TIPS.length - 1)
  })

  it('marks exactly one tip active even when StrictMode replays its layout effect', () => {
    const { container } = render(createElement(StrictMode, null, createElement(LoadingTip, {
      ready: false,
      onContinue: () => {},
    })))

    const root = container.querySelector('.iw-loading-tip')
    expect(root?.querySelectorAll('[data-loading-tip-text][data-active]')).toHaveLength(1)
    expect(root?.getAttribute('data-loading-tip')).toBe(
      root?.querySelector('[data-loading-tip-text][data-active]')?.getAttribute('data-loading-tip-text'),
    )

    cleanup()
  })

  it('steps the type down without changing the shared box for long future hints', () => {
    expect(loadingTipFontSize('x'.repeat(72))).toBe('0.86rem')
    expect(loadingTipFontSize('x'.repeat(73))).toBe('0.8rem')
    expect(loadingTipFontSize('x'.repeat(111))).toBe('0.74rem')
  })

  it('opens automatically when countdown and readiness are both complete', () => {
    vi.useFakeTimers()
    const onContinue = vi.fn()
    const { queryByRole, rerender } = render(createElement(LoadingTip, { ready: false, onContinue }))

    expect(queryByRole('dialog')?.textContent).toContain('Ready in 3…')
    act(() => vi.advanceTimersByTime(1000))
    expect(queryByRole('dialog')?.textContent).toContain('Ready in 2…')
    rerender(createElement(LoadingTip, { ready: true, onContinue }))
    expect(onContinue).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1000))
    act(() => vi.advanceTimersByTime(1000))
    expect(onContinue).toHaveBeenCalledTimes(1)

    cleanup()
    vi.useRealTimers()
  })

  it('does not require or react to a click before the countdown completes', () => {
    vi.useFakeTimers()
    const onContinue = vi.fn()
    render(createElement(LoadingTip, { ready: true, onContinue }))

    fireEvent.pointerDown(window)
    expect(onContinue).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1000))
    act(() => vi.advanceTimersByTime(1000))
    act(() => vi.advanceTimersByTime(1000))
    expect(onContinue).toHaveBeenCalledTimes(1)

    cleanup()
    vi.useRealTimers()
  })

  it('offers another tip without treating that click as Continue', () => {
    const onContinue = vi.fn()
    const { getByRole, container } = render(createElement(LoadingTip, { ready: false, onContinue }))
    const root = container.querySelector('.iw-loading-tip')
    const before = root?.getAttribute('data-loading-tip')

    fireEvent.pointerDown(getByRole('button', { name: 'New tip (Tab)' }))
    fireEvent.click(getByRole('button', { name: 'New tip (Tab)' }))

    expect(root?.getAttribute('data-loading-tip')).not.toBe(before)
    expect(onContinue).not.toHaveBeenCalled()
    cleanup()
  })

  it('uses Tab for another tip rather than continuing the load', () => {
    const onContinue = vi.fn()
    const { container } = render(createElement(LoadingTip, { ready: false, onContinue }))
    const root = container.querySelector('.iw-loading-tip')
    const before = root?.getAttribute('data-loading-tip')

    fireEvent.keyDown(window, { key: 'Tab' })

    expect(root?.getAttribute('data-loading-tip')).not.toBe(before)
    expect(onContinue).not.toHaveBeenCalled()
    cleanup()
  })
})
