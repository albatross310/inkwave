// Math menu popup — the ∑ footer button: insert inline/block math, block alignment, the MathLive
// shortcut reference, and the writer’s custom \symbol table. Extracted verbatim from
// TiptapEditor.tsx (2026-07-08) — communicates only via the editor prop + two window events
// ('inkwave-math-align', 'inkwave-symbols-changed'), which is why the cut is clean.

import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/core'
import { getSymbols, deleteSymbol, setSymbol as saveSymbol, PRESETS, type MathSymbol } from '../editor/extensions/mathSymbols'

const MATH_ITEMS = [
  { label: 'Inline math',  hint: 'Alt+=',    action: (e: Editor) => e.commands.insertMathInline() },
  { label: 'Block math',   hint: 'Alt+⇧+=',  action: (e: Editor) => e.commands.insertMathBlock()  },
] as const

const INK = '#302438'

// MathLive inline shortcuts reference — type sequence then space to expand
// [sequence, rendered symbol or name, description]
const ML_SHORTCUT_SECTIONS: { title: string; rows: [string, string, string][] }[] = [
  { title: 'Greek (+ space)', rows: [
    ['alpha',   'α', ''], ['beta',    'β', ''], ['gamma',  'γ', ''], ['delta',  'δ', ''],
    ['epsilon', 'ε', ''], ['zeta',    'ζ', ''], ['eta',    'η', ''], ['theta',  'θ', ''],
    ['iota',    'ι', ''], ['kappa',   'κ', ''], ['lambda', 'λ', ''], ['mu',     'μ', ''],
    ['nu',      'ν', ''], ['xi',      'ξ', ''], ['pi',     'π', ''], ['rho',    'ρ', ''],
    ['sigma',   'σ', ''], ['tau',     'τ', ''], ['phi',    'φ', ''], ['chi',    'χ', ''],
    ['psi',     'ψ', ''], ['omega',   'ω', ''],
    ['Gamma',   'Γ', ''], ['Delta',   'Δ', ''], ['Theta',  'Θ', ''], ['Lambda', 'Λ', ''],
    ['Xi',      'Ξ', ''], ['Pi',      'Π', ''], ['Sigma',  'Σ', ''], ['Phi',    'Φ', ''],
    ['Psi',     'Ψ', ''], ['Omega',   'Ω', ''],
  ]},
  { title: 'Common symbols', rows: [
    ['oo',   '∞',  'infinity'],       ['+-',  '±',  'plus-minus'],
    ['xx',   '×',  'times'],          ['÷',   '÷',  'divide'],
    ['~~',   '≈',  'approx'],         ['!=',  '≠',  'not equal'],
    ['<=',   '≤',  'less or equal'],  ['>=',  '≥',  'greater or equal'],
    ['<<',   '≪',  'much less'],      ['>>',  '≫',  'much greater'],
    ['...',  '…',  'ellipsis'],       ['°',   '°',  'degree'],
    ['ii',   'i',  'imaginary i'],    ['ee',  'e',  "Euler's e"],
  ]},
  { title: 'Arrows', rows: [
    ['->',   '→',  ''],  ['<-',   '←',  ''],
    ['=>',   '⇒',  ''],  ['<=>',  '⟺',  'iff'],
    ['|->',  '↦',  'maps to'], ['uarr', '↑', ''], ['darr', '↓', ''],
  ]},
  { title: 'Sets & logic', rows: [
    ['in',   '∈',  ''],  ['!in',  '∉',  ''],
    ['uu',   '∪',  'union'],          ['nn',  '∩',  'intersect'],
    ['sub',  '⊂',  'subset'],         ['sup', '⊃',  'superset'],
    ['AA',   '∀',  'for all'],        ['EE',  '∃',  'exists'],
    ['!',    '¬',  'not'],
  ]},
  { title: 'Calculus', rows: [
    ['sum',   '∑',  ''],  ['int',   '∫',  ''],  ['prod',  '∏',  ''],
    ['del',   '∂',  ''],  ['nabla', '∇',  ''],
    ['lim',   'lim',''],  ['sqrt',  '√',  ''],
  ]},
  { title: 'Fractions & accents', rows: [
    ['1/2',  '½',  ''],   ['1/3',  '⅓',  ''],  ['2/3',  '⅔',  ''],
    ['1/4',  '¼',  ''],   ['3/4',  '¾',  ''],
    ['bar',  'x̄',  'overline'],  ['hat', 'x̂', ''],
    ['vec',  'x⃗',  ''],  ['dot',  'ẋ',  ''],
  ]},
  { title: 'Functions (expand on space)', rows: [
    ['sin','sin',''], ['cos','cos',''], ['tan','tan',''], ['log','log',''],
    ['ln','ln',''],   ['exp','exp',''], ['det','det',''], ['max','max',''],
    ['min','min',''], ['gcd','gcd',''],
  ]},
]

const ALIGN_OPTS = [
  { value: 'aligned', label: '=',  title: 'Block alignment — align at =' },
  { value: 'center',  label: '⊙', title: 'Block alignment — centre'     },
  { value: 'left',    label: '◁',  title: 'Block alignment — left'       },
] as const

export function MathMenuButton({ editor }: { editor: Editor | null }) {
  const [open, setOpen]           = useState(false)
  const [view, setView]           = useState<'menu' | 'symbols' | 'info'>('menu')
  const [symbols, setSymbols]     = useState<MathSymbol[]>([])
  const [newKey, setNewKey]       = useState('')
  const [newLatex, setNewLatex]   = useState('')
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos]             = useState({ x: 0, y: 0 })

  const reload = () => setSymbols(getSymbols())

  const openMenu = useCallback(() => {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ x: r.left + r.width / 2, y: r.top })
    reload()
    setView('menu')
    setOpen(true)
  }, [])

  // Outside-close is a portal BACKDROP (below, same model as SettingsMenu), NOT a document
  // mousedown listener: React delegates events on document too, so the trigger's stopPropagation
  // couldn't block a sibling document listener — mousedown closed the menu, then the click
  // re-opened it, and the ∑ button never toggled shut.
  useEffect(() => {
    if (!open) return
    // Close on PAGE scroll only from the short main menu; the info/symbols sub-views scroll internally, so
    // scrolling their lists must NOT dismiss the popup (that was the "panel hides when you scroll" bug).
    const closeOnScroll = () => { if (view === 'menu') setOpen(false) }
    window.addEventListener('scroll', closeOnScroll, { passive: true, capture: true })
    return () => { window.removeEventListener('scroll', closeOnScroll, { capture: true } as EventListenerOptions) }
  }, [open, view])

  // Listen for symbol changes from the math input boxes.
  useEffect(() => {
    const handler = () => reload()
    window.addEventListener('inkwave-symbols-changed', handler)
    return () => window.removeEventListener('inkwave-symbols-changed', handler)
  }, [])

  const addSymbol = () => {
    if (!newKey.trim() || !newLatex.trim()) return
    saveSymbol(newKey.trim(), newLatex.trim())
    setNewKey('')
    setNewLatex('')
    reload()
  }

  const removeSymbol = (key: string) => {
    deleteSymbol(key)
    reload()
  }

  // Shortcut hints live in the hover tooltip (title), not the row — keeps the menu narrow (Peter, 2026-07-10).
  const btn = (label: string, hint: string, onClick: () => void) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      title={hint ? `${label}  ·  ${hint}` : label}
      style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '6px 10px', borderRadius: '5px', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(72, 73, 101, 0.08)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ fontFamily: 'IM Fell DW Pica, EB Garamond, Georgia, serif', fontSize: '15px', color: '#57534e' }}>{label}</span>
    </button>
  )

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        onMouseDown={e => { e.preventDefault(); e.stopPropagation() }}
        className={`flex items-center justify-center min-w-[44px] min-h-[44px] transition-colors ${open ? 'text-[#302438]' : 'text-stone-400 hover:text-[#302438]'}`}
        title="Insert math"
      >
        <span className="flex items-center justify-center w-9 h-9 rounded-full border-[1.5px] border-current text-[15px] leading-none" style={{ fontFamily: 'serif' }}>Σ</span>
      </button>

      {open && createPortal(
        <>
        {/* Backdrop — dismiss on outside press. Pressing ∑ again lands here too, so it CLOSES
            (the trigger's onClick never fires while open — exactly how SettingsMenu toggles). */}
        <div className="fixed inset-0 z-[199]" aria-hidden="true" onMouseDown={() => setOpen(false)} />
        <div
          className="iw-nightable iw-touch-guard"
          onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}
          style={{ position: 'fixed', left: pos.x, top: pos.y - 8, transform: 'translate(-50%, -100%)', background: 'white', border: '1px solid rgb(var(--iw-ink-rgb) / 0.75)', borderRadius: '10px', boxShadow: '0 4px 20px rgba(0,0,0,0.12)', padding: '4px', zIndex: 200, minWidth: view === 'symbols' ? '280px' : '118px' }}
        >
          {view === 'menu' && (
            <>
              {MATH_ITEMS.map(item => btn(item.label, item.hint, () => { setOpen(false); if (editor) item.action(editor) }))}
              <div style={{ height: '1px', background: 'rgba(72, 73, 101, 0.12)', margin: '4px 6px' }} />
              {/* Block alignment — the label lives in each button's hover toast (title), not a header */}
              <div style={{ padding: '2px 8px 4px' }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                  {ALIGN_OPTS.map(o => {
                    const cur = editor?.getAttributes('mathBlock').align
                    const active = cur === o.value
                    return (
                      <button key={o.value} type="button" title={o.title}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => {
                          // Dispatch custom event so the active math block picks it up
                          // even when ProseMirror's selection has moved to the math-field.
                          window.dispatchEvent(new CustomEvent('inkwave-math-align', { detail: { align: o.value } }))
                          // Also try via Tiptap selection (fallback for when no block is active)
                          editor?.chain().updateAttributes('mathBlock', { align: o.value }).run()
                          setOpen(false)
                        }}
                        style={{ fontSize: '0.72rem', padding: '2px 8px', border: `1px solid ${active ? INK : 'rgba(72, 73, 101, 0.22)'}`, borderRadius: '4px', background: active ? 'rgba(72, 73, 101, 0.10)' : 'transparent', color: active ? INK : '#8a7d74', cursor: 'pointer', fontFamily: 'ui-monospace, monospace' }}
                      >{o.label}</button>
                    )
                  })}
                </div>
              </div>
              <div style={{ height: '1px', background: 'rgba(72, 73, 101, 0.12)', margin: '4px 6px' }} />
              {btn('Shortcuts', '', () => setView('info'))}
            </>
          )}

          {view === 'info' && (
            <div style={{ padding: '4px 4px', minWidth: '340px' }}>
              {/* Top bar removed — a subtle back arrow floats at the top-right. */}
              <button type="button" onClick={() => setView('menu')} title="Back"
                style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#a89d96', fontSize: '1rem', padding: '0 2px', lineHeight: 1 }}>←</button>
              <div style={{ maxHeight: 'min(70vh, 420px)', overflowY: 'auto', padding: '4px 0' }}>
                {ML_SHORTCUT_SECTIONS.map(({ title, rows }) => (
                  <div key={title} style={{ marginBottom: '12px' }}>
                    <div style={{ padding: '4px 10px 3px', fontSize: '0.72rem', color: '#a89a86', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</div>
                    {rows.map(([k, sym, d]) => (
                      <div key={k} style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', columnGap: '10px', padding: '2px 10px', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.82rem', color: '#7a6e65', whiteSpace: 'nowrap' }}>{k}</span>
                        <span style={{ fontSize: '1rem', color: INK, minWidth: '1.2em', textAlign: 'center' }}>{sym}</span>
                        <span style={{ fontSize: '0.9rem', color: '#6b6058' }}>{d}</span>
                      </div>
                    ))}
                  </div>
                ))}
                <div style={{ borderTop: `1px solid ${INK}12`, marginTop: '4px', padding: '8px 10px 4px' }}>
                  <div style={{ fontSize: '0.62rem', color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>Inkwave keys</div>
                  {([
                    ['hold CapsLock', 'Gk', 'Greek mode while held'],
                    ['//',  '\\frac',  'fraction'],
                    ['`',   '\\textsc','small caps'],
                    ['"',   '\\text', 'enter/exit text mode'],
                    ['space space', '·', 'text space'],
                    ['"name=\\cmd', '', 'define custom symbol'],
                    ['Ctrl+Q/E/L', '', 'block alignment'],
                  ] as [string, string, string][]).map(([k, sym, d]) => (
                    <div key={k} style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', columnGap: '8px', padding: '1px 0', alignItems: 'center' }}>
                      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.68rem', color: '#7a6e65', whiteSpace: 'nowrap' }}>{k}</span>
                      <span style={{ fontSize: '0.78rem', color: INK, minWidth: '1.2em', textAlign: 'center', fontFamily: 'ui-monospace,monospace' }}>{sym}</span>
                      <span style={{ fontSize: '0.72rem', color: '#a89d96' }}>{d}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {view === 'symbols' && (
            <div style={{ padding: '6px 4px 4px' }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0 6px 6px', borderBottom: `1px solid ${INK}18` }}>
                <button type="button" onClick={() => setView('menu')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a89d96', fontSize: '0.8rem', padding: '0 2px' }}>←</button>
                <span style={{ fontSize: '0.75rem', color: INK, fontFamily: 'ui-monospace, monospace' }}>symbols</span>
              </div>

              {/* User-defined symbols */}
              <div style={{ maxHeight: '180px', overflowY: 'auto', padding: '4px 0' }}>
                {symbols.length === 0 && (
                  <div style={{ padding: '6px 10px', fontSize: '0.8rem', color: '#c0b8b0', fontStyle: 'italic' }}>none yet</div>
                )}
                {symbols.map(s => (
                  <div key={s.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 8px', gap: '8px' }}>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.8rem', color: INK }}>{s.key}</span>
                    <span style={{ fontSize: '0.75rem', color: '#7a6e65', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.latex}</span>
                    <button type="button" onClick={() => removeSymbol(s.key)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0b8b0', fontSize: '0.85rem', padding: '0 2px' }}>×</button>
                  </div>
                ))}
              </div>

              {/* Presets */}
              <div style={{ borderTop: `1px solid ${INK}12`, padding: '4px 0' }}>
                <div style={{ padding: '2px 8px', fontSize: '0.62rem', color: '#b0a898', textTransform: 'uppercase', letterSpacing: '0.06em' }}>presets</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '4px 8px' }}>
                  {PRESETS.map(p => (
                    <button
                      key={p.key}
                      type="button"
                      title={p.latex}
                      onClick={() => { saveSymbol(p.key, p.latex); reload() }}
                      style={{ fontSize: '0.72rem', padding: '2px 7px', border: `1px solid ${symbols.some(s => s.key === p.key) ? INK : 'rgba(72, 73, 101, 0.2)'}`, borderRadius: '4px', background: symbols.some(s => s.key === p.key) ? 'rgba(72, 73, 101, 0.10)' : 'transparent', color: symbols.some(s => s.key === p.key) ? INK : '#8a7d74', cursor: 'pointer', fontFamily: 'ui-monospace, monospace' }}
                    >{p.key}</button>
                  ))}
                </div>
              </div>

              {/* Add new */}
              <div style={{ borderTop: `1px solid ${INK}12`, padding: '6px 8px 2px', display: 'flex', gap: '4px', alignItems: 'center' }}>
                <input
                  value={newKey}
                  onChange={e => setNewKey(e.target.value)}
                  placeholder="key"
                  onKeyDown={e => { if (e.key === 'Enter') addSymbol() }}
                  style={{ width: '56px', fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', border: `1px solid ${INK}33`, borderRadius: '4px', padding: '3px 5px', outline: 'none' }}
                />
                <span style={{ color: '#b0a898', fontSize: '0.8rem' }}>=</span>
                <input
                  value={newLatex}
                  onChange={e => setNewLatex(e.target.value)}
                  placeholder="LaTeX"
                  onKeyDown={e => { if (e.key === 'Enter') addSymbol() }}
                  style={{ flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', border: `1px solid ${INK}33`, borderRadius: '4px', padding: '3px 5px', outline: 'none' }}
                />
                <button type="button" onClick={addSymbol}
                  style={{ background: INK, color: 'white', border: 'none', borderRadius: '4px', padding: '3px 8px', fontSize: '0.78rem', cursor: 'pointer', whiteSpace: 'nowrap' }}>+</button>
              </div>
            </div>
          )}
        </div>
        </>,
        document.body,
      )}
    </>
  )
}
