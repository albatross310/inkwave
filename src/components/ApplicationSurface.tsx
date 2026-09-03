import type { ReactNode } from 'react'

/**
 * The shared frame for a focused Inkwave tool. Email owns the fields inside it; future music and
 * other tools reuse the same isolated/contextual shell instead of growing parallel page chrome.
 */
export type ApplicationSurfaceMode = 'isolated' | 'contextual'

interface ApplicationSurfaceProps {
  app: string
  label: ReactNode
  ariaLabel?: string
  mode?: ApplicationSurfaceMode
  nightable?: boolean
  children: ReactNode
}

export function ApplicationSurface({
  app,
  label,
  ariaLabel,
  mode = 'isolated',
  nightable = false,
  children,
}: ApplicationSurfaceProps) {
  return (
    <section
      className={`iw-application-surface iw-application-surface--${mode}${nightable ? ' iw-nightable' : ''}`}
      data-iw-application={app}
      data-iw-surface-mode={mode}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : `${app} application`)}
    >
      <div className="iw-application-surface__label">{label}</div>
      {children}
    </section>
  )
}
