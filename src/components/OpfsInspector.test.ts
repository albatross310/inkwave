// The OPFS inspector's LOAD-BEARING PROPERTIES, kept true cheaply.
//
// WHY THIS FILE EXISTS (CLAUDE.md, "A GREEN GATE IS NOT A GUARD"): the inspector was proved in a
// real browser — scripts/opfs-inspector-probe/probe.mjs seeds an orphaned document into OPFS and
// drives the built app to show it being listed and recovered. That probe is the in-browser truth,
// and it is NOT a guard: six weeks from now a hand-run probe that convinced everyone once is
// indistinguishable from one that never ran, and `pnpm test` says green either way.
//
// So the properties that a browser is not required to check are checked HERE, structurally, in
// ~milliseconds. Each was demonstrated to FAIL against a deliberately broken variant (both were
// built and probed, 2026-07-17):
//   · sourcing the listing from `listMeta()` instead of OPFS ⇒ the orphan vanished from the panel
//   · removing the "Storage" menu item ⇒ the panel was unreachable
// These tests fire on the first of those without launching a browser.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, 'OpfsInspector.tsx'), 'utf8')
const MENU = readFileSync(join(__dirname, 'OptionsMenu.tsx'), 'utf8')

// The JSX/logic body, minus comments — so the prose ABOUT the rules can name the very things the
// rules forbid (this file's own header does exactly that) without tripping them.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the listing comes from STORAGE, not the index', () => {
  // This is the whole point of the panel. An orphaned document is BY DEFINITION one that OPFS has
  // and the IndexedDB index does not surface, so a listing built from the index could never show
  // the documents this panel exists to recover.
  it('enumerates OPFS directly via listOpfsDocuments', () => {
    expect(CODE).toMatch(/const entries = await listOpfsDocuments\(\)/)
  })

  it('never builds its rows from listMeta — the index is CHECKED, never the source', () => {
    // listMeta may appear only in the `indexed` set used to decide the orphan badge.
    const metaCalls = [...CODE.matchAll(/await listMeta\(\)/g)]
    expect(metaCalls.length).toBe(1)
    expect(CODE).toMatch(/indexed = new Set\(\(await listMeta\(\)\)\.map/)
  })

  it('flags a row as orphaned exactly when the index does not have it', () => {
    expect(CODE).toMatch(/orphaned: !indexed\.has\(e\.id\)/)
  })
})

describe('recovery actions', () => {
  it('Open goes through the ONE guarded switch path (flush-first, abort-on-failure)', () => {
    // switchTabToDocument (tabDoc.ts) owns the 2026-07-10 data-loss guard. Re-implementing the
    // reload here would let the two paths drift and drop a pending save.
    expect(CODE).toMatch(/switchTabToDocument\(r\.id\)/)
    expect(CODE).not.toMatch(/window\.location\.reload/)
  })

  it('Download reuses the real export bundle path, not a bespoke blob', () => {
    expect(CODE).toMatch(/buildExportBundleWithPdfs/)
    expect(CODE).toMatch(/downloadBundle\(bundle, bundleFilename\(row\.doc\)\)/)
  })

  it('offers NO delete action — a destructive control on a recovery surface is the bug', () => {
    expect(CODE).not.toMatch(/deleteMeta|removeEntry|deleteSnapshot|\bDelete\b/i)
  })
})

describe('theming (CLAUDE.md — a panel without iw-nightable is white-on-white in night mode)', () => {
  it('puts iw-nightable and iw-touch-guard on the panel', () => {
    expect(CODE).toMatch(/iw-nightable/)
    expect(CODE).toMatch(/iw-touch-guard/) // portaled footer panel — else taps retract the iOS keyboard
  })

  it('every inline colour is a theme token with a day fallback, never a bare hex', () => {
    // Bare hex in a style value is the failure this rule exists to prevent. `const INK` is the
    // sole allowed literal (it feeds the day fallback of the panel border, matching the other
    // migrated panels); every other colour must read `var(--iw-…, #fallback)`.
    const styleHexes = [...CODE.matchAll(/(?:color|background|border\w*|fill|stroke)\s*:\s*[^,;}\n]*/gi)]
      .map(m => m[0])
      .filter(s => /#[0-9a-f]{3,8}\b/i.test(s))
      .filter(s => !/var\(--iw-/.test(s)) // a hex INSIDE var(--token, #hex) is the required shape
      .filter(s => !/\$\{INK\}/.test(s))
    expect(styleHexes).toEqual([])
  })
})

describe('the entry point exists', () => {
  it('the hamburger (OptionsMenu) has a Storage item that opens the inspector', () => {
    expect(MENU).toMatch(/label: 'Storage', run: \(\) => setInspector\(true\)/)
    expect(MENU).toMatch(/<OpfsInspector onClose=/)
  })
})
