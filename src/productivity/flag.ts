// Feature flag for the productivity AI report — DEFAULT OFF.
//
// Sticky-resolved once per load into localStorage, following the `?snapThumbs` / `?auth` pattern:
// a flag read fresh from the URL on every call DIES the moment any local-first navigation
// rewrites the URL — which silently disabled snapThumbs exactly when it was being used
// (CLAUDE.md, snapThumbs round 8, bug 2). Don't reintroduce that.
//
//   ?prodReport=1     on
//   ?prodReport=demo  on, with a labelled synthetic ledger (no real ledger exists yet)
//   ?prodReport=off   clears both

const FLAG = 'inkwave:prodReport'
const DEMO_FLAG = 'inkwave:prodReportDemo'

let resolved: { on: boolean; demo: boolean } | null = null

function flags(): { on: boolean; demo: boolean } {
  if (resolved) return resolved
  resolved = { on: false, demo: false }
  try {
    const p = new URLSearchParams(window.location.search).get('prodReport')
    if (p === 'off') {
      localStorage.removeItem(FLAG)
      localStorage.removeItem(DEMO_FLAG)
    } else if (p === '1' || p === 'demo') {
      localStorage.setItem(FLAG, '1')
      if (p === 'demo') localStorage.setItem(DEMO_FLAG, '1')
      else localStorage.removeItem(DEMO_FLAG)
    }
    resolved = {
      on: localStorage.getItem(FLAG) === '1',
      demo: localStorage.getItem(DEMO_FLAG) === '1',
    }
  } catch { /* private mode → stays off */ }
  return resolved
}

export function prodReportEnabled(): boolean { return flags().on }

/** `?prodReport=demo` — synthetic ledger data, labelled as such in the panel. Never silent. */
export function prodReportDemo(): boolean { return flags().demo }

/** Tests only. */
export function __resetProdReportFlag(): void { resolved = null }
