import { describe, it, expect, afterEach } from 'vitest'
import {
  ALL_SLOTS, DEFAULT_SLOTS, ROW_SLOTS, SlotId,
  livePopulation, slotIsLive, migrateSlots, overflowSlots, planBarToggle,
  readToolbarConfig, resolveToolbarRow, mayPersistConfig,
} from './toolbarContract'
import { setProdLedgerEnabled, _resetProdLedgerFlag } from '../productivity/ledgerFlag'

afterEach(() => { setProdLedgerEnabled(false); _resetProdLedgerFlag() })

// The six a writer with NOTHING gets — Peter's first-run list, VERBATIM and complete since the
// media lane landed (2026-07-17). It was ['…', 'receipt', 'bib'] while `media` fell through to the
// next canonical member; that stopgap is gone, so this now equals DEFAULT_SLOTS exactly.
const FIRST_RUN: SlotId[] = ['page', 'style', 'guide', 'settings', 'media', 'receipt']

// The contract's keepers. A green gate is not a guard (CLAUDE.md): every negative below was
// checked to FIRE before it was trusted — see the mutation notes on each block.

describe('migrateSlots — the row, from any stored vintage', () => {
  // THE PRECEDENT, VERBATIM (CLAUDE.md: "legacy 4 migrates by appending style,settings").
  it('legacy 4 migrates by APPENDING the formerly-fixed buttons, in the writer’s own order', () => {
    expect(migrateSlots(['bib', 'guide', 'math', 'receipt']))
      .toEqual(['bib', 'guide', 'math', 'receipt', 'style', 'settings'])
  })

  // The shipped rule keyed on `parsed.length === 4`, so a REORDERED legacy 4 still had to get
  // style+settings — not "whatever the defaults are missing". This is the case that separates
  // appending FORMERLY_FIXED from appending DEFAULT_SLOTS, and it is why the fill order exists.
  it('a REORDERED legacy 4 keeps its order and still gains style+settings first', () => {
    const out = migrateSlots(['page', 'bib', 'guide', 'math'])
    expect(out.slice(0, 4)).toEqual(['page', 'bib', 'guide', 'math'])
    expect(out.slice(4, 6)).toEqual(['style', 'settings'])
  })

  // The row is SIX (Peter: "only 6 slots not 7… it fits well on phone"), so a stored six is
  // already whole — the writer's toolbar must come back byte-identical, not be "helpfully" redone.
  it('a stored 6 is returned untouched', () => {
    const stored: SlotId[] = ['bib', 'guide', 'math', 'receipt', 'style', 'settings']
    expect(migrateSlots(stored)).toEqual(stored)
  })

  it('a CURATED 6 keeps its exact order as the prefix (the writer is not re-shuffled)', () => {
    const curated: SlotId[] = ['settings', 'style', 'receipt', 'math', 'guide', 'bib']
    expect(migrateSlots(curated).slice(0, 6)).toEqual(curated)
  })

  // REGISTERED ≠ BUILT. `media` sits in Peter's first-run six while its lane does not exist; music
  // and clock are registered for their lanes. None may render a dead circle in the meantime — and
  // none may appear in the ▲ drawer either, which would be a button that does nothing.
  it('a registered-but-NOT-LIVE slot NEVER renders — not in the row, not in ▲', () => {
    const row = migrateSlots(null)
    for (const id of ['music', 'clock'] as SlotId[]) {
      expect(ALL_SLOTS, `${id} must be registered`).toContain(id)
      expect(slotIsLive(id), `${id} is not live yet`).toBe(false)
      expect(row, `${id} must not reach the row`).not.toContain(id)
      expect(overflowSlots(row), `${id} must not reach the drawer`).not.toContain(id)
    }
  })

  // The gate must be able to OPEN, or it is a permanent off-switch dressed as a seam.
  it('livePopulation is exactly the slots whose predicate says yes', () => {
    expect(livePopulation()).toEqual(ALL_SLOTS.filter(slotIsLive))
    expect(livePopulation().length).toBeGreaterThanOrEqual(ROW_SLOTS)
  })

  // RECONCILED FROM feat/prod-ledger, whose own guarantee this must keep: "a stored 7-row can't
  // strand an unrenderable id". Their flag-conditional slot triple is gone; this is that promise,
  // now carried by the one liveness rule — the clock appears with its flag and leaves without it.
  it('the clock joins the population with ?prodLedger and LEAVES when it goes off', () => {
    expect(slotIsLive('clock')).toBe(false)
    expect(livePopulation()).not.toContain('clock' as SlotId)

    setProdLedgerEnabled(true)
    expect(slotIsLive('clock')).toBe(true)
    expect(livePopulation()).toContain('clock' as SlotId)
    // Peter re-settled the row at SIX, so the clock competes for a slot like everything else
    // rather than widening the bar — it lands in the ▲ drawer by default.
    expect(migrateSlots(null)).toHaveLength(ROW_SLOTS)
    expect(migrateSlots(null)).not.toContain('clock' as SlotId)
    expect(overflowSlots(migrateSlots(null))).toContain('clock' as SlotId)
    // ...and a writer who promotes it keeps it, without the row growing.
    const promoted = migrateSlots(['clock', 'bib', 'guide', 'math', 'receipt', 'style'])
    expect(promoted[0]).toBe('clock')
    expect(promoted).toHaveLength(ROW_SLOTS)

    // The flag goes off: a STORED clock must not strand an unrenderable id.
    setProdLedgerEnabled(false)
    const after = migrateSlots(['clock', 'bib', 'guide', 'math', 'receipt', 'style'])
    expect(after).not.toContain('clock' as SlotId)
    expect(after).toHaveLength(ROW_SLOTS)          // healed, not reset
    expect(after.slice(0, 5)).toEqual(['bib', 'guide', 'math', 'receipt', 'style'])
  })

  // The gate OPENED for real — this is the case that proves it is a seam and not a permanent
  // off-switch: media went live by flipping one predicate, and the first-run six became Peter's
  // list verbatim with no other edit.
  it('media is LIVE and sits in Peter’s first-run six itself — the fallthrough is retired', () => {
    expect(DEFAULT_SLOTS).toContain('media' as SlotId)
    expect(slotIsLive('media')).toBe(true)
    expect(migrateSlots(null)).toEqual(FIRST_RUN)
    expect(migrateSlots(null)).toContain('media' as SlotId)
    expect(FIRST_RUN).toEqual([...DEFAULT_SLOTS])   // no fallthrough left to diverge them
  })

  // HEALING, not resetting. The shipped rule returned DEFAULT_SLOTS for any of these — throwing
  // away a curated toolbar because one entry aged out.
  it('drops a RETIRED id and heals to a full row, keeping the rest of the writer’s order', () => {
    const out = migrateSlots(['bib', 'guide', 'retired-thing', 'receipt'])
    expect(out).toHaveLength(ROW_SLOTS)
    expect(out).not.toContain('retired-thing' as SlotId)
    expect(out.slice(0, 3)).toEqual(['bib', 'guide', 'receipt'])
  })

  it('drops duplicates rather than failing the whole config', () => {
    const out = migrateSlots(['bib', 'bib', 'guide'])
    expect(out.filter(id => id === 'bib')).toHaveLength(1)
    expect(out).toHaveLength(ROW_SLOTS)
  })

  it('falls back to the first-run six only when there is nothing usable to keep', () => {
    for (const junk of [null, undefined, {}, 'nonsense', [], [1, 2, 3], ['not-a-slot']]) {
      expect(migrateSlots(junk)).toEqual(FIRST_RUN)
    }
  })

  // THE PROPERTY THAT MAKES "a received document locks me out" UNREPRESENTABLE. Everything the
  // .studio config path returns runs through here, so a hostile/truncated row cannot produce a
  // short, duplicated, or unknown-button toolbar. Mutation-proved: dropping the `.slice(0, ROW_SLOTS)`
  // or the `!kept.includes(id)` dedupe fails this on real inputs.
  it('ALWAYS returns exactly ROW_SLOTS unique, real slots — from any input at all', () => {
    const inputs: unknown[] = [
      null, {}, [], ['bib'], ['bib', 'bib', 'bib'], ALL_SLOTS, [...ALL_SLOTS, ...ALL_SLOTS],
      ['x', 'y', 'z'], [42, true, null], ['style'], [...DEFAULT_SLOTS], ['music', 'media', 'clock'],
    ]
    for (const input of inputs) {
      const out = migrateSlots(input)
      expect(out, `input=${JSON.stringify(input)}`).toHaveLength(ROW_SLOTS)
      expect(new Set(out).size).toBe(ROW_SLOTS)
      for (const id of out) expect(livePopulation()).toContain(id)
    }
  })

  it('the row and the ▲ drawer PARTITION the live population — nothing is unreachable', () => {
    const row = migrateSlots(ALL_SLOTS)
    expect(row).toEqual(livePopulation().slice(0, ROW_SLOTS))
    expect([...row, ...overflowSlots(row)].sort()).toEqual([...livePopulation()].sort())
  })
})

describe('planBarToggle — "mutually exclusive" as a structure, not a promise', () => {
  const LAYERS = ['style', 'review', 'music'] as const

  it('tapping the active layer closes the bar', () => {
    for (const l of LAYERS) expect(planBarToggle(l, l)).toEqual({ open: null, handoff: false })
  })

  it('opening from closed needs no handoff', () => {
    for (const l of LAYERS) expect(planBarToggle(null, l)).toEqual({ open: l, handoff: false })
  })

  // Peter's word: R and music cannot both own the bar.
  it('swapping between DIFFERENT layers collapses the outgoing one first', () => {
    expect(planBarToggle('review', 'music')).toEqual({ open: 'music', handoff: true })
    expect(planBarToggle('music', 'review')).toEqual({ open: 'review', handoff: true })
    expect(planBarToggle('style', 'music')).toEqual({ open: 'music', handoff: true })
  })

  // THE INVARIANT, swept over every pair — including the pairs a third layer newly creates.
  // The shipped two-boolean state could represent "both open" and was prevented only by the
  // discipline of one hand-written function; this cannot represent it at all.
  it('NO input can ever leave two layers open — exhaustive over every (active, which) pair', () => {
    for (const active of [null, ...LAYERS]) {
      for (const which of LAYERS) {
        const plan = planBarToggle(active, which)
        // The result names at most ONE layer. There is no second field to disagree with it.
        expect(plan.open === null || LAYERS.includes(plan.open)).toBe(true)
        // A handoff is claimed only when something different is genuinely open to collapse.
        expect(plan.handoff).toBe(active !== null && active !== which)
      }
    }
  })
})

describe('readToolbarConfig — absent is not error, and neither is null', () => {
  it('absent: a pre-config document', () => {
    expect(readToolbarConfig(undefined)).toEqual({ kind: 'absent' })
    expect(readToolbarConfig(null)).toEqual({ kind: 'absent' })
  })

  it('found: a real config, normalised through the row rule', () => {
    const read = readToolbarConfig({ v: 1, row: ['math', 'bib'] })
    expect(read.kind).toBe('found')
    if (read.kind !== 'found') throw new Error('unreachable')
    expect(read.row).toHaveLength(ROW_SLOTS)
    expect(read.row.slice(0, 2)).toEqual(['math', 'bib'])
  })

  // A .studio authored on a build where music/media shipped, opened on one where they have not:
  // the unbuilt buttons must drop out, and the row must still be six real ones.
  it('a config naming buttons this build does not have still yields a full, real row', () => {
    const read = readToolbarConfig({ v: 1, row: ['music', 'clock', 'bib'] })
    if (read.kind !== 'found') throw new Error('expected found')
    expect(read.row).toHaveLength(ROW_SLOTS)
    expect(read.row[0]).toBe('bib')
    for (const id of read.row) expect(livePopulation()).toContain(id)
  })

  // THE LOAD-BEARING NEGATIVE — this is the 2026-07-15 shape. `catch { return null }` made a
  // FAILED read indistinguishable from an ABSENT one and cost Peter a day of real thesis
  // annotations. Mutation-proved: make any of these return { kind: 'absent' } and this fails.
  it('BROKEN is never ABSENT — a config we cannot read says so', () => {
    const broken: unknown[] = [
      { v: 2, row: ['bib'] },        // a version from the future
      { v: 1, row: 'bib' },          // row is not an array
      { v: 1 },                      // no row at all
      'nonsense',                    // not an object
      42,
      { row: ['bib'] },              // unversioned
    ]
    for (const raw of broken) {
      const read = readToolbarConfig(raw)
      expect(read.kind, `raw=${JSON.stringify(raw)}`).toBe('error')
      expect(read.kind === 'error' && read.reason.length > 0).toBe(true)
    }
  })

  // The distinction has to CHANGE something or it is decoration. It changes what we WRITE.
  it('a failed read forbids the write-back; absent and found permit it', () => {
    expect(mayPersistConfig(readToolbarConfig({ v: 9 }))).toBe(false)
    expect(mayPersistConfig(readToolbarConfig(null))).toBe(true)
    expect(mayPersistConfig(readToolbarConfig({ v: 1, row: [...FIRST_RUN] }))).toBe(true)
  })
})

describe('resolveToolbarRow — the chain, and what a received document may do', () => {
  const GLOBAL: SlotId[] = ['bib', 'guide', 'math', 'page', 'style', 'settings']

  it('the document’s layout wins — the toolbar follows the doc', () => {
    const read = readToolbarConfig({ v: 1, row: ['math', 'page'] })
    expect(resolveToolbarRow(read, GLOBAL).slice(0, 2)).toEqual(['math', 'page'])
  })

  // The case that must not regress: every document that exists today carries no config.
  it('a document with NO config uses YOUR order, never a stranger’s', () => {
    expect(resolveToolbarRow({ kind: 'absent' }, GLOBAL)).toEqual(GLOBAL)
  })

  it('a BROKEN config still renders a working toolbar (it only forbids the write-back)', () => {
    expect(resolveToolbarRow({ kind: 'error', reason: 'x' }, GLOBAL)).toEqual(GLOBAL)
  })

  // First-ever window / incognito — the ONLY place the first-run six is used.
  it('no config and no global — a brand new writer gets the first-run six', () => {
    expect(resolveToolbarRow({ kind: 'absent' }, null)).toEqual(FIRST_RUN)
    expect(resolveToolbarRow({ kind: 'error', reason: 'x' }, null)).toEqual(FIRST_RUN)
  })

  it('a stale global order is migrated too — it is never trusted raw', () => {
    expect(resolveToolbarRow({ kind: 'absent' }, ['bib', 'guide'])).toHaveLength(ROW_SLOTS)
  })
})
