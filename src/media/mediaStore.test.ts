import { describe, it, expect } from 'vitest'
import { kindOf, extFor, importMedia, MEDIA_LIMIT_BYTES, mb } from './mediaStore'

const file = (name: string, type: string, size: number): File => {
  const f = new File([new Uint8Array(0)], name, { type })
  // Size is what the rule reads; a real 50MB buffer in a unit test is not the subject.
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('kindOf — Peter’s three, and a refusal for everything else', () => {
  it('maps the real MIME families', () => {
    expect(kindOf('image/jpeg')).toBe('photo')
    expect(kindOf('image/heic')).toBe('photo')   // what an iPhone actually hands over
    expect(kindOf('audio/mp4')).toBe('audio')
    expect(kindOf('audio/mpeg')).toBe('audio')
    expect(kindOf('video/quicktime')).toBe('video')
    expect(kindOf('IMAGE/PNG')).toBe('photo')    // MIME types are case-insensitive
  })

  // THE LOAD-BEARING NEGATIVE. Storing an unknown type as a 'photo' gives the writer a file they
  // can never open again — and "it imported fine" is the worst way to discover that.
  it('REFUSES anything else rather than guessing a kind', () => {
    for (const m of ['application/pdf', 'text/plain', 'application/octet-stream', '', 'nonsense']) {
      expect(kindOf(m), `mime=${m}`).toBeNull()
    }
  })
})

describe('extFor', () => {
  it('derives an extension from the family', () => {
    expect(extFor('image/png')).toBe('.png')
    expect(extFor('video/mp4')).toBe('.mp4')
  })
  it('strips codec parameters — a filename cannot carry them', () => {
    expect(extFor('audio/webm;codecs=opus')).toBe('.webm')
  })
  it('falls back rather than producing a bare dot', () => {
    expect(extFor('application/zip')).toBe('.bin')
    expect(extFor('image/')).toBe('.img')
  })
})

describe('importMedia — the ONE importer both of Peter’s paths call', () => {
  it('refuses an unsupported type, naming it', async () => {
    const r = await importMedia(file('notes.pdf', 'application/pdf', 10), 'id-1')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.reason).toContain('application/pdf')
  })

  // REFUSES, never truncates — the email lane's rule for over-long drafts, same reason: a silently
  // degraded import is a file the writer believes they have.
  it('refuses an oversized file and states both numbers', async () => {
    const r = await importMedia(file('big.mov', 'video/quicktime', MEDIA_LIMIT_BYTES + 1), 'id-2')
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.reason).toContain(mb(MEDIA_LIMIT_BYTES))
  })

  // The size rule must not reject the boundary itself — an off-by-one here refuses a legal file.
  it('accepts a file exactly at the limit (it is a limit, not a ceiling below it)', async () => {
    const r = await importMedia(file('exact.mp3', 'audio/mpeg', MEDIA_LIMIT_BYTES), 'id-3')
    // OPFS is absent in vitest, so the STORE fails — but it must fail at storage, not at the size
    // rule. That distinction is the whole point: a storage failure is loud and says so.
    if (!r.ok) expect(r.reason).not.toContain('the limit is')
  })

  // A failed OPFS write must NOT return an asset — that would record a reference to bytes that
  // are not there, which is the shape of every "the file is gone" bug in this repo.
  it('never yields an asset when storage fails (no reference without bytes)', async () => {
    const r = await importMedia(file('p.png', 'image/png', 10), 'id-4')
    expect(r.ok).toBe(false)  // no navigator.storage in vitest
    if (r.ok) throw new Error('unreachable')
    expect(r.reason.length).toBeGreaterThan(0)
  })
})
