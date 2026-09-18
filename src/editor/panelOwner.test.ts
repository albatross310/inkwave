// @vitest-environment jsdom
// Rule (a) of the panel contract (toolbarContract.ts, Population 3): which pointerdowns close the
// open panel. Needs a DOM for `closest`, hence its own jsdom file.
import { describe, it, expect, afterEach } from 'vitest'
import { tapClosesPanel, PANEL_ATTR, PANEL_TRIGGER_ATTR } from './toolbarContract'

describe('tapClosesPanel — rule (a), the outside tap', () => {
  const build = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d); return d }
  afterEach(() => { document.body.innerHTML = '' })

  it('a tap inside the open panel does not close it', () => {
    const d = build(`<div ${PANEL_ATTR}="page"><button id="chip">Low</button></div>`)
    expect(tapClosesPanel(d.querySelector('#chip'), 'page')).toBe(false)
  })
  it('a tap on the panel’s own trigger does not close it (the click toggles instead)', () => {
    const d = build(`<button ${PANEL_TRIGGER_ATTR}="page"><span id="p">P</span></button>`)
    expect(tapClosesPanel(d.querySelector('#p'), 'page')).toBe(false)
  })
  it('a tap on ANOTHER panel’s trigger closes it (that click then opens its own)', () => {
    const d = build(`<button ${PANEL_TRIGGER_ATTR}="settings"><span id="s">⚙</span></button>`)
    expect(tapClosesPanel(d.querySelector('#s'), 'page')).toBe(true)
  })
  it('a tap on the paper, the water, or a different panel closes it', () => {
    const d = build(`<p id="text">prose</p><div ${PANEL_ATTR}="settings"><span id="row"/></div>`)
    expect(tapClosesPanel(d.querySelector('#text'), 'page')).toBe(true)
    expect(tapClosesPanel(d.querySelector('#row'), 'page')).toBe(true)
    expect(tapClosesPanel(null, 'page')).toBe(true)
  })
})
