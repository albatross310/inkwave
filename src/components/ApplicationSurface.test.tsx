// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ApplicationSurface } from './ApplicationSurface'

const css = readFileSync(resolve(__dirname, '../styles/index.css'), 'utf8')

beforeEach(() => localStorage.clear())
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

  it('does not inherit document-page margins as an application-body indent', () => {
    const block = css.match(/\.iw-application-surface__body\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? ''
    expect(block).toContain('var(--iw-application-inset)')
    expect(block).not.toContain('--iw-page-side-margin')
    expect(block).not.toContain('--iw-page-bottom-margin')
  })

  it('ends after its content instead of manufacturing a blank page-height tail', () => {
    const block = css.match(/\.iw-application-surface\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? ''
    expect(block).toContain('min-height: 0')
    expect(block).not.toContain('--iw-page-height')
    expect(block).not.toContain('100dvh')
  })

  it('makes isolated email 25% narrower on desktop while keeping contextual tools independent', () => {
    const block = css.match(/\[data-iw-application="email"\]\.iw-application-surface--isolated\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? ''
    expect(block).toContain('width: 75%')
    expect(block).toContain('margin-inline: auto')
  })

  it('offers symmetric side handles and an independent bottom handle when enabled', () => {
    render(<ApplicationSurface app="email" label="Email draft" resizable><p>Message</p></ApplicationSurface>)
    expect(screen.getByRole('separator', { name: /left edge/ })).toBeTruthy()
    expect(screen.getByRole('separator', { name: /right edge/ })).toBeTruthy()
    expect(screen.getByRole('separator', { name: /height from the bottom edge/ })).toBeTruthy()
  })

  it('keeps keyboard width changes centred and persists them as a responsive percentage', () => {
    render(<ApplicationSurface app="email" label="Email draft" resizable><p>Message</p></ApplicationSurface>)
    const surface = screen.getByRole('region', { name: 'Email draft' })
    Object.defineProperty(surface, 'getBoundingClientRect', { value: () => ({ width: 600, height: 400 }) })
    Object.defineProperty(surface.parentElement, 'getBoundingClientRect', { value: () => ({ width: 800 }) })

    fireEvent.keyDown(screen.getByRole('separator', { name: /right edge/ }), { key: 'ArrowRight' })

    expect(surface.style.width).toBe('78%')
    expect(localStorage.getItem('inkwave:applicationSurface:email:isolated:width')).toBe('78')
  })
})
