import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(new URL('./Edit.tsx', import.meta.url), 'utf8')

describe('fresh-window document startup', () => {
  it('opens from the lightweight metadata index before falling back to a full OPFS scan', () => {
    const metadataOpen = SOURCE.indexOf('tryCandidates(metas.map((meta) => meta.id))')
    const directScan = SOURCE.indexOf('await listOpfsDocumentsStrict()')

    expect(metadataOpen).toBeGreaterThan(-1)
    expect(directScan).toBeGreaterThan(metadataOpen)
  })

  it('uses the strict direct scan so a storage failure cannot mint a blank document', () => {
    expect(SOURCE).toContain('listOpfsDocumentsStrict')
    expect(SOURCE).not.toMatch(/await listOpfsDocuments\(\)/)
  })

  it('lets the discarded StrictMode pass cancel before consuming a blank launch', () => {
    const blankStart = SOURCE.indexOf("const forceFresh = new URL(window.location.href).searchParams.get('blank') === '1'")
    const replayBoundary = SOURCE.indexOf('await Promise.resolve()', blankStart)
    const cancellation = SOURCE.indexOf('if (cancelled) return', replayBoundary)
    const consumeIntent = SOURCE.indexOf("cleanUrl.searchParams.delete('blank')", blankStart)
    const mintBlank = SOURCE.indexOf('openFresh()', consumeIntent)

    expect(blankStart).toBeGreaterThan(-1)
    expect(replayBoundary).toBeGreaterThan(blankStart)
    expect(cancellation).toBeGreaterThan(replayBoundary)
    expect(consumeIntent).toBeGreaterThan(cancellation)
    expect(mintBlank).toBeGreaterThan(consumeIntent)
  })
})
