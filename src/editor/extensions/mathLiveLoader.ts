// Singleton lazy loader — MathLive is only fetched once, the first time a math
// node is clicked. All subsequent calls return the same resolved promise.
let promise: Promise<void> | null = null

export function loadMathLive(): Promise<void> {
  if (!promise) {
    promise = import('mathlive').then(() => {})
  }
  return promise
}
