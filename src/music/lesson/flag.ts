// The music lesson layer's feature flag — DEFAULT OFF (the module ships dark).
//
// Follows the repo's sticky-flag pattern exactly (`?auth`, `?email`, `?prodGraphs`): resolve the URL
// param ONCE per load and persist it, so the flag survives the URL being rewritten by later
// navigation. Reading the URL fresh WITHOUT persisting is the bug that silently disabled the
// snapshot thumbnails the moment a scrub rewrote the URL (CLAUDE.md, /snapshot round 8, bug 2) —
// the flag died exactly when the feature started being used, and its absence looked like the
// feature being unnecessary.
//
//   ?lesson / ?lesson=1   enable (sticky)
//   ?lesson=off           disable + clear
//
// UNSET ⇒ OFF. SSR/prerender has no localStorage/location → false.

const KEY = 'inkwave:lesson'

let _resolved: boolean | null = null

function resolve(): boolean {
  try {
    const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null
    if (params?.get('lesson') === 'off') localStorage.removeItem(KEY)
    else if (params?.has('lesson')) localStorage.setItem(KEY, '1')
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** Whether the lesson layer is available at all. Default OFF. */
export function lessonEnabled(): boolean {
  const w = typeof window !== 'undefined'
    ? (window as unknown as { __iwLesson?: boolean })
    : null
  if (w && typeof w.__iwLesson === 'boolean') return w.__iwLesson
  if (_resolved === null) _resolved = resolve()
  return _resolved
}

/** Test-only: forget the resolved value so a fresh URL/localStorage state can be read. */
export function resetLessonFlagForTests(): void {
  _resolved = null
}
