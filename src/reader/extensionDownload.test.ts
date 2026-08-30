// "GET THE EXTENSION" — the install card in the source reader. LIVE, default-on.
//
// Peter, 2026-08-30: **"this is for others not us: we need to host the file on our github and give
// instructions on how the user downloads it on github and then installs with developer mode."** The
// card had been telling readers to run `pnpm ext:build`, which assumes a clone, a toolchain and a
// package manager — an instruction only its authors can execute, inside a card whose own header
// rule is "NO DEAD DOWNLOAD BUTTON". This keeps that fixed: copy rots silently and nothing else in
// the gate reads this card.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { EXTENSION_RELEASES_URL, EXTENSION_UNPACKED_DIR, EXTENSION_ZIP_URL } from './extensionDownload'

const SRC = resolve(__dirname, '..')
const PANEL = resolve(__dirname, '../components/SourceBrowser.tsx')

/**
 * ⚠ COMMENTS ARE STRIPPED, AND A URL IS NOT A COMMENT.
 *
 * This repo's guards must strip comments or they fire on their own documentation — the fix's own
 * comment NAMES `pnpm ext:build` in order to explain why it must not be an instruction, and a
 * raw-text check would read that as the violation. But the usual `//[^\n]*` stripper eats
 * `https://…`, which would delete the very link this file is about. So line comments are removed
 * only where `//` opens a line, which is this repo's style everywhere and cannot match a URL.
 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '')

const panelCode = () => stripComments(readFileSync(PANEL, 'utf8'))

describe('the download link', () => {
  it('names the real asset, and a second door beside it', () => {
    expect(EXTENSION_ZIP_URL).toMatch(
      /^https:\/\/github\.com\/albatross310\/inkwave\/releases\/download\/v\d+\.\d+\.\d+\/inkwave-extension-\d+\.\d+\.\d+-chrome\.zip$/)
    // The releases page is kept BESIDE the asset, never instead of it: it carries the honest limits
    // the card is too small to hold, and it is the live route if the pinned link ever goes wrong.
    expect(EXTENSION_RELEASES_URL).toBe('https://github.com/albatross310/inkwave/releases')
  })

  it('⚠ IS PINNED TO THE VERSION THAT IS ACTUALLY BUILT — the whole reason this file has a test', () => {
    // The link is pinned BY HAND rather than derived, on purpose: a derived URL moves the instant
    // somebody edits the version and points at a release nobody has uploaded yet — a 404, which is
    // the dead-button failure with a delay. A pinned one can only go STALE, and a stale zip still
    // installs. This is what makes the staleness cost a red suite at home instead of a 404 in front
    // of a writer: cut a release, forget this line, and the gate says so.
    const extPkg = JSON.parse(readFileSync(resolve(SRC, '../extension-src/package.json'), 'utf8')) as { version: string }
    expect(EXTENSION_ZIP_URL).toContain(`/v${extPkg.version}/`)
    expect(EXTENSION_ZIP_URL).toContain(`inkwave-extension-${extPkg.version}-chrome.zip`)
  })

  it('is written down in exactly ONE place, so a store listing is one edit', () => {
    // Peter's own framing of the fix, and it matters more now the URL carries a VERSION: three
    // copies is three chances for one of them to be a release behind.
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e)
        if (statSync(p).isDirectory()) { walk(p); continue }
        if (!/\.(ts|tsx)$/.test(e) || /\.test\.tsx?$/.test(e)) continue
        if (readFileSync(p, 'utf8').includes('github.com/albatross310/inkwave/releases')) hits.push(p)
      }
    }
    walk(SRC)
    expect(hits.map((p) => p.slice(SRC.length + 1))).toEqual(['reader/extensionDownload.ts'])
  })

  it('is what the card actually renders', () => {
    // The constant existing proves nothing about the card; a card that imports it does.
    expect(panelCode()).toContain('EXTENSION_ZIP_URL')
    expect(panelCode()).toContain('EXTENSION_RELEASES_URL')
    expect(panelCode()).toMatch(/from '\.\.\/reader\/extensionDownload'/)
  })
})

describe('the instructions a reader can follow', () => {
  it('no longer tells them to build it from a repository they do not have', () => {
    const code = panelCode()
    expect(code).not.toContain('pnpm ext:build')
    expect(code).not.toContain('extension-src/.output')
  })

  it('and the guard SURVIVES ITS OWN DOCUMENTATION — the pair, asserted', () => {
    // The fix's comment has to NAME `pnpm ext:build` in order to explain why it must never be an
    // instruction again. A raw-text guard would fire on that sentence, and the tempting fix is to
    // delete the sentence — the corrosion this repo keeps writing up. So: the phrase IS in the
    // file (or the check above is passing for the wrong reason, and would go on passing after
    // somebody removed the explanation) and is NOT in what the card renders.
    expect(readFileSync(PANEL, 'utf8')).toContain('pnpm ext:build')
    expect(panelCode()).not.toContain('pnpm ext:build')
  })

  it('names the four real steps: download, developer mode, load unpacked, grant', () => {
    const code = panelCode()
    expect(code).toMatch(/Download the zip/)
    expect(code).toContain('chrome://extensions')
    expect(code).toContain('Developer mode')
    expect(code).toContain('Load unpacked')
    // The step that used to be hidden and is the one that makes the feature work at all.
    expect(code).toContain('Fetch pages for the reader')
  })

  it('names the folder they must pick, because unzipping makes a folder in a folder', () => {
    expect(EXTENSION_UNPACKED_DIR).toBe('chrome-mv3')
    expect(panelCode()).toContain('EXTENSION_UNPACKED_DIR')
  })

  it('says what Developer mode costs them, rather than reassuring them', () => {
    // A writer who meets Chrome's startup warning without having been told will reasonably assume
    // something went wrong. This is a description, not a promise — §C1.4's sweep owns the rest.
    const code = panelCode()
    expect(code).toMatch(/Developer mode because/)
    expect(code).toMatch(/each time you start the browser/)
    expect(code).toMatch(/remove it/)
  })
})

describe('cutting a release is one command', () => {
  it('pnpm ext:release exists and builds rather than publishing', () => {
    const pkg = JSON.parse(readFileSync(resolve(SRC, '../package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts['ext:release']).toBe('node scripts/ext-release.mjs')
    const script = readFileSync(resolve(SRC, '../scripts/ext-release.mjs'), 'utf8')
    // Publishing is a decision, not a side effect — and the script holds no token to do it with.
    expect(stripComments(script)).not.toMatch(/gh release|api\.github\.com|--upload/)
    // …and it must report an absent artifact AS absent, never with a cheerful line either way.
    expect(script).toMatch(/process\.exit\(1\)/)
  })
})
