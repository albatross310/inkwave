import { describe, it, expect, vi } from 'vitest'
import { WordNudgeEmitter } from './wordNudges'
import type { WordNudgeEvent } from '../types/document'

const event = (overrides: Partial<WordNudgeEvent> = {}): WordNudgeEvent => ({
  lemma: 'big',
  replacement: 'large',
  response: 'swapped',
  commitIndex: 0,
  setVersion: 1,
  trigger: 'in-S',
  deliberationMs: 1500,
  ...overrides,
})

describe('WordNudgeEmitter', () => {
  it('delivers events to a subscriber', () => {
    const emitter = new WordNudgeEmitter()
    const received: WordNudgeEvent[] = []
    emitter.on(e => received.push(e))
    const ev = event()
    emitter.emit(ev)
    expect(received).toHaveLength(1)
    expect(received[0]).toBe(ev)
  })

  it('delivers to multiple subscribers', () => {
    const emitter = new WordNudgeEmitter()
    let countA = 0, countB = 0
    emitter.on(() => countA++)
    emitter.on(() => countB++)
    emitter.emit(event())
    expect(countA).toBe(1)
    expect(countB).toBe(1)
  })

  it('stops delivering after unsubscribe', () => {
    const emitter = new WordNudgeEmitter()
    const listener = vi.fn()
    const off = emitter.on(listener)
    emitter.emit(event())
    off()
    emitter.emit(event())
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does not throw when emitting with no subscribers', () => {
    const emitter = new WordNudgeEmitter()
    expect(() => emitter.emit(event())).not.toThrow()
  })

  it('returns distinct unsubscribe functions for each subscriber', () => {
    const emitter = new WordNudgeEmitter()
    const a = vi.fn(), b = vi.fn()
    const offA = emitter.on(a)
    emitter.on(b)
    offA()
    emitter.emit(event())
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })
})
