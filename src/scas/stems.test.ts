import { describe, it, expect } from 'vitest'
import { getStems } from './stems'

// ── getStems ──────────────────────────────────────────────────────────────────
describe('getStems', () => {
  it('always includes the word itself', () => {
    expect(getStems('philosophy')).toContain('philosophy')
  })

  it('-ing: removes suffix and un-doubles final consonant', () => {
    expect(getStems('working')).toContain('work')
    expect(getStems('running')).toContain('run')   // doubling: running → run
    expect(getStems('making')).toContain('make')   // silent e: making → make
  })

  it('-ed: removes suffix', () => {
    expect(getStems('worked')).toContain('work')
    expect(getStems('stopped')).toContain('stop')  // doubling: stopped → stop
    expect(getStems('loved')).toContain('love')    // silent e: loved → love
  })

  it('-es: removes suffix', () => {
    expect(getStems('watches')).toContain('watch')
    expect(getStems('makes')).toContain('make')
  })

  it('-s plural: removes -s (but not -ss)', () => {
    expect(getStems('runs')).toContain('run')
    expect(getStems('glass')).not.toContain('glas') // -ss words not stripped
  })

  it('-ly: removes adverb suffix', () => {
    expect(getStems('quickly')).toContain('quick')
    expect(getStems('happily')).toContain('happy')  // -ily path
  })

  it('-ies: converts to -y', () => {
    expect(getStems('libraries')).toContain('library')
  })

  it('-ier/-iest: converts to -y', () => {
    expect(getStems('easier')).toContain('easy')
    expect(getStems('easiest')).toContain('easy')
  })

  it('-er/-est comparative', () => {
    expect(getStems('faster')).toContain('fast')
    expect(getStems('bigger')).toContain('big')    // doubling: bigger → big
  })

  it('-ness: removes suffix', () => {
    expect(getStems('darkness')).toContain('dark')
  })

  it('-ment: removes suffix and tries silent-e form', () => {
    expect(getStems('movement')).toContain('move')
  })

  it('-ation: strips suffix, word itself is always included', () => {
    // 'organisation' → base = 'organis' (slice(0,-5)), so stems include 'organis' and 'organise'
    const stems = getStems('organisation')
    expect(stems).toContain('organisation') // original
    expect(stems).toContain('organis')      // base without -ation
    expect(stems).toContain('organise')     // base + e
  })

  it('-tion: strips suffix and adds silent-e form', () => {
    // 'calculation' → base = slice(0,-5) = 'calcul', so: 'calcul', 'calcule', ...
    const stems = getStems('calculation')
    expect(stems).toContain('calcul')
    expect(stems).toContain('calcule')
  })

  it('-ise/-ize cross-spelling normalisation', () => {
    expect(getStems('standardised')).toContain('standardize')
    expect(getStems('standardized')).toContain('standardise')
    expect(getStems('organise')).toContain('organize')
    expect(getStems('organize')).toContain('organise')
  })

  it('agent nouns: -er → silent-e base', () => {
    expect(getStems('writer')).toContain('write')
    expect(getStems('teacher')).toContain('teach')
  })

  it('lowercases input', () => {
    expect(getStems('Running')).toContain('running')
    expect(getStems('WORK')).toContain('work')
  })

  it('short words: returns at least the word itself', () => {
    expect(getStems('in')).toEqual(['in'])
    expect(getStems('at')).toEqual(['at'])
  })
})
