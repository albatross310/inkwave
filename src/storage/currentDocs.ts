// The user-controlled auto-open queue for multi-window Inkwave.
//
// The document files remain OPFS's responsibility. This is only lightweight device-local workflow
// metadata: ordered ids plus explicit exclusions. New documents join the front automatically;
// removing one records an exclusion so a later edit cannot silently put it back in the queue.

const CURRENT_DOCS_KEY = 'inkwave:current-docs:v1'

interface CurrentDocsState {
  order: string[]
  excluded: string[]
  manual: boolean
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>

function storeOrNull(store?: KeyValueStore): KeyValueStore | null {
  if (store) return store
  try { return localStorage } catch { return null }
}

function unique(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))]
}

function readState(store?: KeyValueStore): CurrentDocsState {
  const target = storeOrNull(store)
  if (!target) return { order: [], excluded: [], manual: false }
  try {
    const raw = JSON.parse(target.getItem(CURRENT_DOCS_KEY) ?? '{}') as Partial<CurrentDocsState>
    return {
      order: unique(Array.isArray(raw.order) ? raw.order : []),
      excluded: unique(Array.isArray(raw.excluded) ? raw.excluded : []),
      manual: raw.manual === true,
    }
  } catch {
    return { order: [], excluded: [], manual: false }
  }
}

function writeState(state: CurrentDocsState, store?: KeyValueStore): void {
  const target = storeOrNull(store)
  if (!target) return
  try { target.setItem(CURRENT_DOCS_KEY, JSON.stringify(state)) } catch { /* private mode */ }
}

/** Reconcile storage's newest-first ids with the saved manual order. */
export function currentDocIds(availableNewestFirst: string[], store?: KeyValueStore): string[] {
  const available = unique(availableNewestFirst)
  const availableSet = new Set(available)
  const state = readState(store)
  const excluded = new Set(state.excluded)
  if (!state.manual) {
    const next = available.filter((id) => !excluded.has(id))
    writeState({ order: next, excluded: state.excluded, manual: false }, store)
    return next
  }
  const ordered = state.order.filter((id) => availableSet.has(id) && !excluded.has(id))
  const temporarilyUnavailable = state.order.filter((id) => !availableSet.has(id) && !excluded.has(id))
  const known = new Set(state.order)
  const newcomers = available.filter((id) => !known.has(id) && !excluded.has(id))
  const next = [...newcomers, ...ordered]
  // Keep a manually-added id that this particular caller cannot currently see. Edit's index can
  // temporarily miss an OPFS orphan; Storage's direct scan will see it again and must not find its
  // workflow choice silently erased by the narrower projection.
  writeState({ order: [...next, ...temporarilyUnavailable], excluded: state.excluded, manual: true }, store)
  return next
}

export function saveCurrentDocOrder(ids: string[], store?: KeyValueStore): string[] {
  const state = readState(store)
  const order = unique(ids).filter((id) => !state.excluded.includes(id))
  writeState({ ...state, order, manual: true }, store)
  return order
}

export function removeCurrentDoc(id: string, store?: KeyValueStore): void {
  const state = readState(store)
  writeState({
    order: state.order.filter((candidate) => candidate !== id),
    excluded: unique([...state.excluded, id]),
    manual: state.manual,
  }, store)
}

export function addCurrentDoc(id: string, store?: KeyValueStore): void {
  const state = readState(store)
  writeState({
    order: unique([id, ...state.order]),
    excluded: state.excluded.filter((candidate) => candidate !== id),
    manual: state.manual,
  }, store)
}
