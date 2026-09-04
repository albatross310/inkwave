import type { ApplicationSurfaceMode } from './ApplicationSurface'

const DEFAULT_MODE: ApplicationSurfaceMode = 'isolated'

function modeKey(app: string, scope: string): string {
  return `inkwave:applicationSurface:${app}:mode:${scope}`
}

/**
 * Application presentation is local view state: it must survive a reload without entering the
 * document, its snapshots, or its provenance hash. A future workspace manifest can replace the
 * scope with its own display metadata without changing ApplicationSurface or the app inside it.
 */
export function readApplicationSurfaceMode(app: string, scope: string): ApplicationSurfaceMode {
  try {
    const value = localStorage.getItem(modeKey(app, scope))
    return value === 'contextual' || value === 'isolated' ? value : DEFAULT_MODE
  } catch {
    return DEFAULT_MODE
  }
}

export function writeApplicationSurfaceMode(app: string, scope: string, mode: ApplicationSurfaceMode): void {
  try { localStorage.setItem(modeKey(app, scope), mode) } catch { /* private mode */ }
}

