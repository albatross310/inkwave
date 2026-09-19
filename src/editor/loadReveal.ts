export type LoadRevealState = {
  ready: boolean
  continued: boolean
  waterRested: boolean
  coastVisible: boolean
  touch: boolean
}

/** A short visible brake beat makes the transition read as an intentional slowdown rather than a
 * page appearing on the same frame the waves change speed. Touch still keeps its sole water shell
 * until full rest. */
export const DESKTOP_COAST_BEFORE_REVEAL_MS = 420

export function canBeginEditorReveal(state: LoadRevealState): boolean {
  return state.ready && state.continued && (state.touch ? state.waterRested : state.coastVisible)
}
