// ONE implementation of the sticky feature flag, which nine modules had written out by hand.
//
// ─── WHY THIS IS NOT TIDINESS ────────────────────────────────────────────────────────────────
// The pattern has two OPPOSITE failure modes and this repo has shipped both:
//
//   NOT PERSISTING WHEN YOU MUST. /snapshot's local-first nav rewrites the URL on every scrub
//   step, so a flag read fresh from the URL DIED on the first scrub — silently disabling the
//   snapshot thumbnails and their debug overlay exactly when someone started using them. The
//   feature's absence looked like the feature being unnecessary.
//
//   PERSISTING WHEN YOU MUST NOT. `?snapThumbs=debug` wrote localStorage, so a diagnostic overlay
//   set once outlived its session and appeared on every later visit forever.
//
// Nine independent re-derivations of a rule with two ways to be wrong is nine chances to pick the
// wrong one, and each was picked in a different file by a different lane. Here each is a named
// field on ONE spec, decided at ONE site, with the core's own guards (below) proving both
// directions still hold.
//
// ─── EVERY FIELD BELOW IS A MEASURED DIFFERENCE, NOT A GUESS ─────────────────────────────────
// The characterization pass that preceded this extraction found the nine modules disagreeing on
// six axes, none of which is visible from a flag's own answer:
//   • the DEFAULT, which also decides the reader (`!== '0'` vs `=== '1'`) and what OFF must write;
//   • whether a param enables on PRESENCE or on an exact '1';
//   • what a storage FAULT falls back to — and it is genuinely not always the default;
//   • whether NO WINDOW answers the same as a fault (in one flag it deliberately does not);
//   • whether the resolution is CACHED, which is load-bearing for three callers;
//   • whether there is a `=demo` companion and a `window.__iw*` override.
// A field that could not be expressed cleanly was left as a caller's own code rather than bent
// into the spec — see `src/auth/config.ts`, which uses this for its flag and keeps its Clerk key
// and provider latch to itself.

/** How an ON param is recognised. `present` means `?x`, `?x=1` and `?x=yes` all enable. */
export type OnParamRule = 'exact1' | 'present'

export type StickyFlagSpec = {
  /** The localStorage key. Never change one: it is already in writers' browsers. */
  key: string
  /**
   * The default with nothing stored. It also decides the READER (`!== '0'` when on,
   * `=== '1'` when off) and the default off-write, because an on-by-default flag CANNOT record
   * an opt-out as an absence — `removeItem` would read as "back to on" the moment it succeeded.
   */
  defaultOn: boolean
  /** The URL param. OMITTED for a storage-only flag whose param is synced elsewhere. */
  param?: string
  /** Default `exact1`. */
  onParam?: OnParamRule
  /** What an ON param writes. Default a sticky `'1'`; `clear` removes the key instead. */
  onWrite?: 'set1' | 'clear'
  /** Param values meaning off. Default `['off']`. */
  offValues?: readonly string[]
  /** What an OFF param writes. Default: a sticky `'0'` when `defaultOn`, else an absence. */
  offWrite?: 'set0' | 'clear'
  /** The `=demo` companion key (a second flag that implies this one). */
  companionKey?: string
  /** The param value that sets the companion. Default `'demo'`. */
  companionValue?: string
  /**
   * Where the companion lives. Default `'local'`, alongside the flag itself.
   *
   * `'session'` IS THE SECOND HAZARD'S ANSWER, and it exists because the first version of it was a
   * shipped bug: `?snapThumbs=debug` wrote localStorage, so a diagnostic overlay switched on once
   * appeared on every later visit forever. sessionStorage still survives the in-session URL
   * rewrites that make a fresh-from-the-URL read impossible, and is gone on a new browser session.
   *
   * It also PURGES any local copy of the companion key on every resolve — not a special case but
   * what "this companion is session-scoped" MEANS: a stale persistent one from before the rule
   * must not go on haunting, and only the code that reads the key is in a position to clear it.
   */
  companionStorage?: 'local' | 'session'
  /**
   * The answer when storage throws — private mode, or a browser refusing site data.
   * Default: the flag's own default. NOT always right: a gate on the keystroke path may prefer
   * to fall OFF rather than run where it cannot tell.
   */
  onFault?: boolean
  /**
   * The answer when there is no `window` at all — SSR and prerender. Default: `onFault`.
   * Separate because the two faults can want opposite answers: a private window should get the
   * feature rather than a silent downgrade, while a prerender must not bake the feature's state
   * into static HTML.
   */
  onNoWindow?: boolean
  /**
   * Resolve ONCE per load (default), or on every read. Uncached is load-bearing where another
   * module writes the key mid-session and expects to be seen.
   */
  cache?: boolean
  /** `window.__iwFoo` — an A/B seam that beats storage in both directions. */
  override?: string
  /** `window.__iwFooDemo`. */
  companionOverride?: string
}

export type StickyFlag = {
  /** The flag's answer. */
  enabled: () => boolean
  /** The `=demo` companion's answer; always false without a `companionKey`. */
  demo: () => boolean
  /** Persist an explicit choice and update the cache. Off clears the companion. */
  set: (on: boolean) => void
  /** A test/UI seam that writes the CACHE ONLY, leaving storage untouched. */
  setCachedOnly: (on: boolean) => void
  /** Forget the resolution so the next read re-resolves. Tests, and any live re-read. */
  reset: () => void
}

type Resolved = { on: boolean; demo: boolean }

// ─── environment ─────────────────────────────────────────────────────────────────────────────
// The nine modules read `location` two ways (`window.location` and the bare global) and storage
// two ways, for no reason anyone recorded — in a browser they are the same object. Both are tried
// here so neither spelling's callers change behaviour, and each read is guarded so SSR, prerender
// and a node test env all take the no-window path rather than throwing.

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function win(): (Window & typeof globalThis) | undefined {
  return typeof window !== 'undefined' ? window : undefined
}

function search(): string | null {
  const fromWindow = win()?.location?.search
  if (typeof fromWindow === 'string') return fromWindow
  if (typeof location !== 'undefined' && typeof location.search === 'string') return location.search
  return null
}

function store(): Store | undefined {
  const fromWindow = win()?.localStorage as Store | undefined
  if (fromWindow) return fromWindow
  return typeof localStorage !== 'undefined' ? localStorage : undefined
}

function sessionStore(): Store | undefined {
  const fromWindow = win()?.sessionStorage as Store | undefined
  if (fromWindow) return fromWindow
  return typeof sessionStorage !== 'undefined' ? sessionStorage : undefined
}

function overrideOf(name: string | undefined): boolean | undefined {
  if (!name) return undefined
  const w = win() as unknown as Record<string, unknown> | undefined
  const v = w?.[name]
  return typeof v === 'boolean' ? v : undefined
}

// ─── the resolution ──────────────────────────────────────────────────────────────────────────

function resolve(spec: StickyFlagSpec): Resolved {
  const fault = spec.onFault ?? spec.defaultOn
  const off: Resolved = { on: fault, demo: false }

  // THE ENVIRONMENT TEST IS "IS THERE A STORE", NOT "IS THERE A WINDOW", and the difference is one
  // this extraction FOUND rather than reasoned about. Three of the nine modules never mention
  // `window` in their resolve path — they read the bare `location`/`localStorage` globals — so
  // gating on `window` answered "SSR, take the default" for an environment that could read the
  // writer's choice perfectly well. Their characterization tests failed on the move and were right
  // to: a window is a PROXY for what this function needs, and the store is the thing itself.
  //
  // NO STORE ⇒ `onNoWindow`. That is SSR/prerender/node: a known environment, not a fault, and one
  // flag deliberately answers it opposite to a fault. A store that THROWS is the fault case below.
  const s = store()
  if (!s) return { on: spec.onNoWindow ?? fault, demo: false }

  try {
    // The companion may live in a DIFFERENT store from the flag. A session-scoped one is also
    // purged from local storage on every resolve: a stale persistent copy written before the rule
    // existed is exactly the overlay that haunted Peter, and only the code reading the key can
    // clear it. Inside the try, so a browser refusing site data takes the fault path as before.
    const cs = spec.companionStorage === 'session' ? sessionStore() : s
    if (spec.companionKey && spec.companionStorage === 'session') s.removeItem(spec.companionKey)

    const raw = spec.param ? search() : null
    const p = raw === null ? null : new URLSearchParams(raw).get(spec.param!)

    if (p !== null) {
      const offValues = spec.offValues ?? ['off']
      const companionValue = spec.companionValue ?? 'demo'
      if (offValues.includes(p)) {
        if ((spec.offWrite ?? (spec.defaultOn ? 'set0' : 'clear')) === 'set0') s.setItem(spec.key, '0')
        else s.removeItem(spec.key)
        if (spec.companionKey) cs?.removeItem(spec.companionKey)
      } else if (spec.companionKey && p === companionValue) {
        s.setItem(spec.key, '1')
        cs?.setItem(spec.companionKey, '1')
      } else if (spec.onParam === 'present' || p === '1') {
        if ((spec.onWrite ?? 'set1') === 'set1') s.setItem(spec.key, '1')
        else s.removeItem(spec.key)
        if (spec.companionKey) cs?.removeItem(spec.companionKey)
      }
    }

    const stored = s.getItem(spec.key)
    return {
      on: spec.defaultOn ? stored !== '0' : stored === '1',
      demo: spec.companionKey ? cs?.getItem(spec.companionKey) === '1' : false,
    }
  } catch {
    return off // storage denied — private mode, or site data blocked
  }
}

/** Build one flag from its spec. Call at module scope; the returned readers are the module's API. */
export function stickyFlag(spec: StickyFlagSpec): StickyFlag {
  const cached = spec.cache ?? true
  let memo: Resolved | null = null

  const current = (): Resolved => {
    if (!cached) return resolve(spec)
    if (!memo) memo = resolve(spec)
    return memo
  }

  return {
    enabled() {
      return overrideOf(spec.override) ?? current().on
    },
    demo() {
      return overrideOf(spec.companionOverride) ?? current().demo
    },
    set(on: boolean) {
      try {
        // Always an explicit '1'/'0', never an absence: under a default-ON reader an absence means
        // "on", so an opt-out that removed the key would silently undo itself.
        const s = store()
        s?.setItem(spec.key, on ? '1' : '0')
        if (!on && spec.companionKey) {
          const cs = spec.companionStorage === 'session' ? sessionStore() : s
          cs?.removeItem(spec.companionKey)
        }
      } catch { /* private mode — the choice survives the session in the cache below */ }
      memo = { on, demo: on ? (memo?.demo ?? false) : false }
    },
    // Cache-only. No shipped UNCACHED flag has a setter, so this is a cached-flag seam; on an
    // uncached spec the memo is never read and this would be inert.
    setCachedOnly(on: boolean) {
      memo = { on, demo: memo?.demo ?? false }
    },
    reset() {
      memo = null
    },
  }
}
