// PER-TYPE FIXTURES — one document per text type Inkwave supports, built to be ABLE to fail.
//
// Peter's bar: "make them perfectly accurate across all text types we currently support and if not
// possible then give the reason". So the fixtures must be enumerated from the SCHEMA (17 nodes / 11
// marks, read live via `typeCensus()`), not from anyone's memory of the list.
//
// THREE RULES THESE FIXTURES EXIST TO OBEY, each one a bug this project already paid for:
//
// 1. A RATE CANNOT SEE A RARE EVENT. Inline math measured 0 mid-line breaks even UNFIXED — not
//    "no phantom", just "no break happened to land on one" (24 pills, 9 breaks). So each fixture is
//    LONG (≈13k words ⇒ ~55 pages ⇒ ~54 breaks) and DENSE in its type, so breaks land ON the type
//    under test many times over. A type appearing twice in a 55-page document certifies nothing.
//
// 2. STRUCTURALLY BLIND FIXTURES. A one-line-block fixture makes the buggy branch a no-op. Inline
//    atoms go MID-paragraph in MULTI-line paragraphs; math is sub/superscript- and fraction-heavy
//    (a plain `x+1` pill has no off-baseline interior and reproduces nothing).
//
// 3. THE COMBINATION IS THE TARGET, NOT THE TYPE. lists+headings diverged at break 2 by −80 while
//    headings ALONE were byte-identical — an interaction. Certifying types one at a time and calling
//    the set proved is exactly the error that hid it, so the matrix carries pairs and the full set.

const SRC = ('philosophy leibniz universal language calculus ratiocinator characteristica argument thesis chapter ' +
  'section evidence claims analysis synthesis method critique framework ontology epistemology reason judgment ' +
  'perception substance monad harmony preestablished contingent necessary truth predicate office affluent finds ' +
  'difficult waffles first fifth flourish effigy scaffold inference semantics formal notation encyclopaedia ' +
  'combinatorial mathesis universalis rational grammar concept primitive alphabet thought demonstration').split(/\s+/)

const AUTHORS = [['Couturat', 'Louis'], ['Rescher', 'Nicholas'], ['Mates', 'Benson'], ['Adams', 'Robert'], ['Mercer', 'Christia']]
const KEYS = AUTHORS.map(([f], i) => `${f.toLowerCase()}${1990 + i}`)

function rng(seed = 20260718) { let s = seed; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648 }

// Formulas with real off-baseline interiors — sub/superscripts and fractions. `x+1` would reproduce
// nothing (rule 2).
const FORMULAS = ['\\frac{a^2+b^2}{c_{i}}', 'x_{i}^{2} + \\sum_{n=1}^{k} a_n', '\\frac{\\partial f}{\\partial x_j}', 'e^{i\\pi} + 1 = 0']

/**
 * Build a document containing prose PLUS the named types, at real density.
 * `types` is a Set/array of schema node or mark names.
 */
export function buildTypeDoc({ types = [], words = 13000, id = 'typedoc' } = {}) {
  const T = new Set(types)
  const rnd = rng()
  const content = []
  let w = 0
  let n = 0

  const words_ = (k) => { const o = []; for (let i = 0; i < k; i++) o.push(SRC[Math.floor(rnd() * SRC.length)]); return o.join(' ') }
  const sentence = (k) => { const t = words_(k); return t[0].toUpperCase() + t.slice(1) + '.' }

  // A mark-carrying text node, when that mark is under test.
  const markedText = (text) => {
    const marks = []
    if (T.has('bold')) marks.push({ type: 'bold' })
    if (T.has('italic')) marks.push({ type: 'italic' })
    if (T.has('underline')) marks.push({ type: 'underline' })
    if (T.has('strike')) marks.push({ type: 'strike' })
    if (T.has('code')) marks.push({ type: 'code' })
    if (T.has('highlight')) marks.push({ type: 'highlight', attrs: { color: '#fde68a' } })
    // A CERTIFIED, SELF-HOSTED STACK — one of StyleBar's own FONTS entries, i.e. something a user
    // can actually pick. The first cut used 'Georgia, serif' and every marked block DEFERRED: Georgia
    // is not shipped (it survives only as a fallback TAIL), so fontLoaded() said false and the model
    // correctly refused to guess. That is CLAUDE.md's "a font we don't ship" trap, walked into by my
    // own fixture — it measured the self-healing gate and called it a probe failure.
    if (T.has('textStyle:fontFamily')) marks.push({ type: 'textStyle', attrs: { fontFamily: "'Crimson Pro', 'Times New Roman', serif" } })
    // …and the OPPOSITE case, kept deliberately: an UNSHIPPED family MUST defer rather than wrap on
    // metrics we don't have. That is correct behaviour and worth certifying as such.
    if (T.has('textStyle:unshippedFont')) marks.push({ type: 'textStyle', attrs: { fontFamily: 'Georgia, serif' } })
    if (T.has('textStyle:fontSize')) marks.push({ type: 'textStyle', attrs: { fontSize: '20px' } })
    if (T.has('scasSlot')) marks.push({ type: 'scasSlot', attrs: {} })
    if (T.has('comment')) marks.push({ type: 'comment', attrs: {} })
    if (T.has('insertion')) marks.push({ type: 'insertion', attrs: {} })
    if (T.has('deletion')) marks.push({ type: 'deletion', attrs: {} })
    return marks.length ? { type: 'text', text, marks } : { type: 'text', text }
  }

  // A paragraph — multi-line by construction, with inline atoms MID-paragraph (rule 2).
  const para = () => {
    const kids = []
    kids.push(markedText(sentence(26) + ' '))
    if (T.has('citation')) { kids.push({ type: 'citation', attrs: { citekeys: [KEYS[n % KEYS.length]], prefix: '', suffix: '', locator: '' } }); kids.push({ type: 'text', text: ' ' }) }
    if (T.has('mathInline')) { kids.push({ type: 'mathInline', attrs: { latex: FORMULAS[n % FORMULAS.length] } }); kids.push({ type: 'text', text: ' ' }) }
    if (T.has('hardBreak')) { kids.push({ type: 'text', text: words_(8) }); kids.push({ type: 'hardBreak' }) }
    kids.push(markedText(sentence(28)))
    w += 60; n++
    return { type: 'paragraph', content: kids }
  }

  const listItems = (k) => Array.from({ length: k }, () => ({ type: 'listItem', content: [{ type: 'paragraph', content: [markedText(sentence(14))] }] }))
  const taskItems = (k) => Array.from({ length: k }, (_, i) => ({ type: 'taskItem', attrs: { checked: i % 2 === 0 }, content: [{ type: 'paragraph', content: [markedText(sentence(14))] }] }))

  let block = 0
  while (w < words) {
    // Prose is the carrier; every other type is interleaved densely enough that many breaks land on
    // it. `block % k` cadences are chosen so each type appears dozens of times in ~55 pages.
    if (T.has('heading') && block % 6 === 0) content.push({ type: 'heading', attrs: { level: 2 }, content: [markedText(`Chapter ${block}: ${words_(4)}`)] })
    content.push(para())
    if (T.has('bulletList') && block % 5 === 2) { content.push({ type: 'bulletList', content: listItems(3) }); w += 42 }
    if (T.has('orderedList') && block % 5 === 3) { content.push({ type: 'orderedList', content: listItems(3) }); w += 42 }
    if (T.has('taskList') && block % 5 === 4) { content.push({ type: 'taskList', content: taskItems(3) }); w += 42 }
    if (T.has('blockquote') && block % 7 === 1) { content.push({ type: 'blockquote', content: [{ type: 'paragraph', content: [markedText(sentence(30))] }] }); w += 30 }
    if (T.has('codeBlock') && block % 9 === 4) { content.push({ type: 'codeBlock', content: [{ type: 'text', text: `const ${words_(1)} = ${block} // ${words_(6)}` }] }); w += 10 }
    if (T.has('horizontalRule') && block % 8 === 5) content.push({ type: 'horizontalRule' })
    if (T.has('mathBlock') && block % 8 === 6) content.push({ type: 'mathBlock', attrs: { latex: FORMULAS[block % FORMULAS.length] } })
    block++
  }
  if (T.has('referenceList')) content.push({ type: 'referenceList', attrs: { mode: 'cited' } })

  const entries = KEYS.map((k, i) => {
    const [family, given] = AUTHORS[i % AUTHORS.length]
    return { id: k, type: 'book', title: sentence(6), author: [{ family, given }], issued: { 'date-parts': [[1990 + i]] }, 'container-title': sentence(3) }
  })
  return {
    id, title: 'type fixture', contentJson: { type: 'doc', content },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    schemaVersion: 1, scasLimitN: 'infinite', scasSessionSeed: 'fixture', citationStyle: 'apa',
    bibliography: { source: 'manual', entries, generatedAt: new Date().toISOString(), style: 'apa' },
  }
}

/** Count how many nodes/marks of each named type a doc actually contains — the discrimination check. */
export function countTypes(contentJson) {
  const counts = {}
  const walk = (nd) => {
    if (!nd || typeof nd !== 'object') return
    if (nd.type) counts[nd.type] = (counts[nd.type] || 0) + 1
    for (const m of nd.marks ?? []) counts[`mark:${m.type}`] = (counts[`mark:${m.type}`] || 0) + 1
    for (const c of nd.content ?? []) walk(c)
  }
  walk(contentJson)
  return counts
}
