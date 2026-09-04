// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ApplicationSurface, ApplicationSurfaceModeSwitch } from './ApplicationSurface'

const css = readFileSync(resolve(__dirname, '../styles/index.css'), 'utf8')

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(window.screen, 'width', { configurable: true, value: 1728 })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
})
afterEach(cleanup)

describe('ApplicationSurface', () => {
  it('defaults every tool to the reusable isolated frame', () => {
    render(<ApplicationSurface app="email" label="Email draft"><p>Message</p></ApplicationSurface>)
    const surface = screen.getByRole('region', { name: 'Email draft' })
    expect(surface.getAttribute('data-iw-application')).toBe('email')
    expect(surface.getAttribute('data-iw-surface-mode')).toBe('isolated')
    expect(surface.classList.contains('iw-application-surface--isolated')).toBe(true)
    expect(screen.getByText('Message')).toBeTruthy()
  })

  it('offers the same frame in contextual mode without an app-specific component copy', () => {
    render(
      <ApplicationSurface app="music" label="Music work" mode="contextual">
        <p>Score</p>
      </ApplicationSurface>,
    )
    const surface = screen.getByRole('region', { name: 'Music work' })
    expect(surface.getAttribute('data-iw-surface-mode')).toBe('contextual')
    expect(surface.classList.contains('iw-application-surface--contextual')).toBe(true)
  })

  it('offers one reusable accessible switch for focused and contextual application layouts', () => {
    let selected = ''
    render(<ApplicationSurfaceModeSwitch mode="isolated" onChange={(mode) => { selected = mode }} />)

    expect(screen.getByRole('button', { name: 'Focus' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Studio' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Studio' }))
    expect(selected).toBe('contextual')
  })

  it('does not inherit document-page margins as an application-body indent', () => {
    const block = css.match(/\.iw-application-surface__body\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? ''
    expect(block).toContain('var(--iw-application-inset)')
    expect(block).not.toContain('--iw-page-side-margin')
    expect(block).not.toContain('--iw-page-bottom-margin')
  })

  it('ends after its content instead of manufacturing a blank page-height tail', () => {
    const block = css.match(/\.iw-application-surface\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? ''
    expect(block).toContain('min-height: 0')
    expect(block).toContain('border: 0')
    expect(block).not.toContain('border: 1px solid')
    expect(block).not.toContain('--iw-page-height')
    expect(block).not.toContain('100dvh')
  })

  it('gives isolated email a screen-calibrated pixel default while keeping contextual tools independent', () => {
    const block = css.match(/\.iw-application-surface--isolated\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? ''
    expect(block).toContain('width: var(--iw-application-default-width, 900px)')
    expect(block).not.toContain('max-width: calc(100% - 48px)')
    expect(block).toContain('margin-inline: auto')
  })

  it('accepts a different natural-width profile for another isolated tool', () => {
    Object.defineProperty(window.screen, 'width', { configurable: true, value: 1440 })
    render(
      <ApplicationSurface
        app="music"
        label="Music work"
        widthProfile={{ screenWidthPx: 1920, surfaceWidthPx: 1200 }}
      >
        <p>Score</p>
      </ApplicationSurface>,
    )

    const surface = screen.getByRole('region', { name: 'Music work' })
    expect(surface.style.getPropertyValue('--iw-application-default-width')).toBe('900px')
    expect(surface.parentElement?.classList.contains('iw-application-fit-box')).toBe(true)
  })

  it('uses the main editor fit ratio only when an isolated surface no longer fits', () => {
    render(<ApplicationSurface app="email" label="Email draft" resizable><p>Message</p></ApplicationSurface>)
    const surface = screen.getByRole('region', { name: 'Email draft' })
    const fitBox = surface.parentElement!
    const container = fitBox.parentElement!
    Object.defineProperty(surface, 'offsetWidth', { configurable: true, value: 900 })
    Object.defineProperty(surface, 'offsetHeight', { configurable: true, value: 600 })
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 624 })

    fireEvent.resize(window)

    expect(surface.style.getPropertyValue('--iw-application-fit-scale')).toBe(String(2 / 3))
    expect(surface.classList.contains('iw-application-surface--fit-capped')).toBe(true)
    expect(fitBox.style.width).toBe('600px')
    expect(fitBox.style.height).toBe('400px')

    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 924 })
    fireEvent.resize(window)

    expect(surface.style.getPropertyValue('--iw-application-fit-scale')).toBe('1')
    expect(surface.classList.contains('iw-application-surface--fit-capped')).toBe(false)
    expect(fitBox.style.width).toBe('900px')
    expect(fitBox.style.height).toBe('600px')
  })

  it('offers symmetric side handles and an independent bottom handle when enabled', () => {
    render(<ApplicationSurface app="email" label="Email draft" resizable><p>Message</p></ApplicationSurface>)
    expect(screen.getByRole('separator', { name: /left edge/ })).toBeTruthy()
    expect(screen.getByRole('separator', { name: /right edge/ })).toBeTruthy()
    expect(screen.getByRole('separator', { name: /height from the bottom edge/ })).toBeTruthy()
  })

  it('keeps keyboard width changes centred and persists their scale against screen resolution', () => {
    render(<ApplicationSurface app="email" label="Email draft" resizable><p>Message</p></ApplicationSurface>)
    const surface = screen.getByRole('region', { name: 'Email draft' })
    const container = surface.parentElement!.parentElement!
    Object.defineProperty(surface, 'offsetWidth', { configurable: true, value: 600 })
    Object.defineProperty(surface, 'offsetHeight', { configurable: true, value: 400 })
    Object.defineProperty(surface, 'getBoundingClientRect', { value: () => ({ width: 600, height: 400 }) })
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 800 })
    Object.defineProperty(container, 'getBoundingClientRect', { value: () => ({ width: 800 }) })
    fireEvent.resize(window)

    fireEvent.keyDown(screen.getByRole('separator', { name: /right edge/ }), { key: 'ArrowRight' })

    expect(surface.style.width).toBe('624px')
    expect(Number(localStorage.getItem('inkwave:applicationSurface:email:isolated:widthScale'))).toBeCloseTo(624 / 900)
  })

  it('does not recalculate the default from browser-window width', () => {
    render(<ApplicationSurface app="email" label="Email draft" resizable><p>Message</p></ApplicationSurface>)
    const surface = screen.getByRole('region', { name: 'Email draft' })
    expect(surface.style.getPropertyValue('--iw-application-default-width')).toBe('900px')

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 620 })
    fireEvent.resize(window)

    expect(surface.style.getPropertyValue('--iw-application-default-width')).toBe('900px')
  })
})
