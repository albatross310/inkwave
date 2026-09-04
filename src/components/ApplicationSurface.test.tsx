// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ApplicationSurface } from './ApplicationSurface'

const css = readFileSync(resolve(__dirname, '../styles/index.css'), 'utf8')

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
})
