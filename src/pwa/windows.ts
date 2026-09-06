// One explicit route for every "open another Inkwave" surface: the in-app menu/hotkey and the
// installed app's manifest shortcut. `noopener` is load-bearing here. A same-origin window opened
// with an opener inherits a COPY of this tab's sessionStorage, including its document identity;
// the new window would then try to edit the same document instead of starting blank.
export const NEW_INKWAVE_WINDOW_URL = '/?new-window=1'
export const NEW_BLANK_INKWAVE_WINDOW_URL = '/?new-window=1&blank=1'

const WINDOW_NAME_PREFIX = 'inkwave-window:'
const WINDOW_REGISTRY_KEY = 'inkwave:windows:v1'
const WINDOW_CHANNEL_NAME = 'inkwave:windows'
const WINDOW_ALIVE_MS = 15_000
const WINDOW_HEARTBEAT_MS = 4_000

type WindowEntry = { id: string; openedAt: number; seenAt: number; slot: number }
type WindowRegistry = WindowEntry[]
type WindowMessage =
  | { type: 'present'; entry: WindowEntry }
  | { type: 'focus'; targetId: string }

type CycleKey = Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>

let activeCycle: ((direction: 1 | -1) => void) | null = null
let activeWindowSlot: number | null = null

type WindowOpener = (url?: string | URL, target?: string, features?: string) => Window | null

export function openNewInkwaveWindow(
  openWindow: WindowOpener = window.open.bind(window),
): void {
  openWindow(NEW_INKWAVE_WINDOW_URL, '_blank', 'noopener')
}

export function openNewBlankInkwaveWindow(
  openWindow: WindowOpener = window.open.bind(window),
): void {
  openWindow(NEW_BLANK_INKWAVE_WINDOW_URL, '_blank', 'noopener')
}

function randomWindowId(): string {
  try { return crypto.randomUUID() } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}` }
}

function readRegistry(store: Storage, now = Date.now()): WindowRegistry {
  try {
    const parsed = JSON.parse(store.getItem(WINDOW_REGISTRY_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is WindowEntry => {
      if (!entry || typeof entry !== 'object') return false
      const item = entry as Partial<WindowEntry>
      return typeof item.id === 'string' && Number.isFinite(item.openedAt) &&
        Number.isFinite(item.seenAt) && Number.isInteger(item.slot) && Number(item.slot) > 0 &&
        now - Number(item.seenAt) <= WINDOW_ALIVE_MS
    })
  } catch { return [] }
}

export function lowestAvailableWindowSlot(registry: WindowRegistry): number {
  const occupied = new Set(registry.map((entry) => entry.slot))
  let slot = 1
  while (occupied.has(slot)) slot += 1
  return slot
}

function writeEntry(store: Storage, entry: WindowEntry, now = Date.now()): WindowRegistry {
  const next = [...readRegistry(store, now).filter((item) => item.id !== entry.id), entry]
  try { store.setItem(WINDOW_REGISTRY_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  return next
}

function removeEntry(store: Storage, id: string): void {
  try {
    store.setItem(WINDOW_REGISTRY_KEY, JSON.stringify(readRegistry(store).filter((item) => item.id !== id)))
  } catch { /* private mode */ }
}

/** Stable creation-order cycling, shared by the keyboard handler and its characterization tests. */
export function adjacentInkwaveWindowId(
  registry: WindowRegistry,
  currentId: string,
  direction: 1 | -1,
): string | null {
  const ordered = [...registry].sort((a, b) => a.openedAt - b.openedAt || a.id.localeCompare(b.id))
  if (ordered.length < 2) return null
  const current = ordered.findIndex((entry) => entry.id === currentId)
  if (current < 0) return ordered[0]?.id ?? null
  return ordered[(current + direction + ordered.length) % ordered.length]?.id ?? null
}

/**
 * ⌥Tab moves forward and ⌃⌥Tab moves backward on macOS. Windows owns Alt+Tab before a web app can
 * see it, so Ctrl+Alt+Right/Left are supported as app-safe equivalents there (and everywhere).
 */
export function inkwaveWindowCycleDirection(key: CycleKey): 1 | -1 | 0 {
  if (!key.altKey || key.metaKey || key.shiftKey) return 0
  if (key.key === 'Tab') return key.ctrlKey ? -1 : 1
  if (key.ctrlKey && key.key === 'ArrowRight') return 1
  if (key.ctrlKey && key.key === 'ArrowLeft') return -1
  return 0
}

/**
 * Register this browsing context in a tiny same-origin window roster. BroadcastChannel lets the
 * selected peer focus itself, so this works for independently launched installed-PWA windows too —
 * there is no fragile opener chain and no document state is copied between windows.
 */
export function installInkwaveWindowCycling(win: Window = window): () => void {
  let store: Storage
  try { store = win.localStorage } catch { return () => {} }

  let id = win.name.startsWith(WINDOW_NAME_PREFIX) ? win.name.slice(WINDOW_NAME_PREFIX.length) : ''
  if (!id) {
    id = randomWindowId()
    try { win.name = `${WINDOW_NAME_PREFIX}${id}` } catch { /* restricted host */ }
  }
  const prior = readRegistry(store).find((entry) => entry.id === id)
  const registry = readRegistry(store)
  const entry: WindowEntry = {
    id,
    openedAt: prior?.openedAt ?? Date.now(),
    seenAt: Date.now(),
    slot: prior?.slot ?? lowestAvailableWindowSlot(registry),
  }
  // A slot is the window's stable visual identity for its lifetime. CSS owns the palette; this
  // module only assigns the lowest free positive slot, so the same mechanism generalises to N.
  activeWindowSlot = entry.slot
  win.document.documentElement.dataset.iwWindowSlot = String(entry.slot)
  let channel: BroadcastChannel | null = null
  try { channel = new BroadcastChannel(WINDOW_CHANNEL_NAME) } catch { /* old/private browser */ }

  const announce = () => {
    entry.seenAt = Date.now()
    writeEntry(store, entry, entry.seenAt)
    try { channel?.postMessage({ type: 'present', entry } satisfies WindowMessage) } catch { /* closed */ }
  }
  const onMessage = (event: MessageEvent<WindowMessage>) => {
    const message = event.data
    if (message?.type === 'present') writeEntry(store, message.entry)
    else if (message?.type === 'focus' && message.targetId === id) {
      try { win.focus() } catch { /* host denied focus */ }
      announce()
    }
  }
  if (channel) channel.onmessage = onMessage
  announce()
  const timer = win.setInterval(announce, WINDOW_HEARTBEAT_MS)

  activeCycle = (direction) => {
    announce()
    const targetId = adjacentInkwaveWindowId(readRegistry(store), id, direction)
    if (!targetId) return
    try { channel?.postMessage({ type: 'focus', targetId } satisfies WindowMessage) } catch { /* closed */ }
  }

  const dispose = () => {
    win.clearInterval(timer)
    removeEntry(store, id)
    try { channel?.close() } catch { /* already closed */ }
    if (activeCycle) activeCycle = null
    activeWindowSlot = null
  }
  win.addEventListener('pagehide', dispose, { once: true })
  return dispose
}

/** React may recover a document hydration mismatch by replacing `<html>`; restore its slot token. */
export function reapplyInkwaveWindowSlot(doc: Document = document): void {
  if (activeWindowSlot !== null) doc.documentElement.dataset.iwWindowSlot = String(activeWindowSlot)
}

export function cycleInkwaveWindow(direction: 1 | -1): void {
  activeCycle?.(direction)
}
