// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ApplicationSurface } from './ApplicationSurface'

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
})
