// ─── Toolbar slot reorder math ───────────────────────────────────────────────
// Pure helpers behind the phone touch-hold drag-to-reorder (TiptapEditor footer).
// INSERTION semantics: the dragged circle is lifted out, neighbours between the
// origin and the hovered slot get "pushed out of the way" one step toward the
// origin, and the drop inserts at the hovered slot (adjacent drag ≡ a swap —
// matching the desktop HTML5-drag behaviour for the common case).

/** Reorder `order` by lifting index `from` and inserting it at index `to`. */
export function moveSlot<T>(order: readonly T[], from: number, to: number): T[] {
  const next = [...order]
  if (from === to || from < 0 || from >= next.length || to < 0 || to >= next.length) return next
  const [lifted] = next.splice(from, 1)
  next.splice(to, 0, lifted)
  return next
}

/**
 * How many slot-steps neighbour `j` shifts while the circle dragged from `from`
 * hovers slot `over`: −1 (one slot left), +1 (one slot right) or 0. The dragged
 * slot itself never shifts (it follows the finger).
 */
export function neighborShift(j: number, from: number, over: number): -1 | 0 | 1 {
  if (j === from) return 0
  if (from < over && j > from && j <= over) return -1 // dragged rightward: parted neighbours slide left
  if (over < from && j >= over && j < from) return 1 // dragged leftward: parted neighbours slide right
  return 0
}

/**
 * The slot whose centre the dragged circle (at visual centre `x`) is nearest —
 * i.e. the midpoint-crossing rule: passing a neighbour's midpoint retargets to it.
 * Centres are the slots' ARM-TIME layout positions (preview transforms don't move layout).
 */
export function nearestSlot(centers: readonly number[], x: number): number {
  let best = 0
  let bestDist = Infinity
  for (let j = 0; j < centers.length; j++) {
    const d = Math.abs(centers[j] - x)
    if (d < bestDist) {
      bestDist = d
      best = j
    }
  }
  return best
}
