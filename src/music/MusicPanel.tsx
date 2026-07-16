// The MusicXML path's surface (build spec §B2/§B3/§B6).
//
// EVERYTHING heavy hangs off this module — OSMD (323 kB gzip), the parser, the player. It is only
// ever reached through a dynamic import from `routes/Music.tsx`, so with the flag off none of it is
// fetched or parsed. `chunk.test.ts` asserts that against the real build manifest.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ScoreView } from './ScoreView'
import { importMaster, listMasters, loadMasterXml, type MasterMeta } from './master'
import { parseMusicXml } from './parse'
import { makeTransclusion, resolveTransclusion, type ResolvedExcerpt, type Transclusion } from './transclusion'
import { ScorePlayer } from './player'
import { SIMPLE_SCALE } from './scoreFixtures'
import type { Score } from './score'

const muted = { color: 'var(--iw-pill-fg, #78716c)' }
const ink = { color: 'var(--iw-ink, #5c2d8a)' }

export function MusicPanel({ demo = false }: { demo?: boolean }) {
  const [masters, setMasters] = useState<MasterMeta[]>([])
  const [active, setActive] = useState<{ meta: MasterMeta | null; xml: string; score: Score } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [excerpts, setExcerpts] = useState<ResolvedExcerpt[]>([])

  const refresh = useCallback(async () => {
    try { setMasters(await listMasters()) } catch { /* no OPFS → the list stays empty */ }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // `?music=demo` renders the LABELLED synthetic fixture — never a real score, and never silently.
  useEffect(() => {
    if (!demo || active) return
    try {
      setActive({ meta: null, xml: SIMPLE_SCALE, score: parseMusicXml(SIMPLE_SCALE) })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The demo score failed to load.')
    }
  }, [demo, active])

  const onFile = async (file: File) => {
    setError(null)
    try {
      const { meta, deduped } = await importMaster(file, { fileName: file.name })
      await refresh()
      const xml = await loadMasterXml(meta.id)
      if (!xml) throw new Error('The score was imported but could not be read back.')
      setActive({ meta, xml, score: parseMusicXml(xml) })
      if (deduped) setError(`You already had “${meta.title || meta.fileName}” — opening your copy.`)
    } catch (e) {
      // Loud, specific, and actionable — never a silent empty view.
      setError(e instanceof Error ? e.message : 'That file could not be imported.')
    }
  }

  const openMaster = async (meta: MasterMeta) => {
    setError(null)
    try {
      const xml = await loadMasterXml(meta.id)
      if (!xml) throw new Error(`“${meta.title || meta.fileName}” is listed but missing on this device.`)
      setActive({ meta, xml, score: parseMusicXml(xml) })
      setExcerpts([])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That score could not be opened.')
    }
  }

  const addExcerpt = async (tx: Transclusion) => {
    try {
      setExcerpts(prev => [...prev, ...[]]) // keep referential churn obvious
      const resolved = await resolveTransclusion(tx)
      setExcerpts(prev => [...prev, resolved])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That excerpt could not be inserted.')
    }
  }

  return (
    <div className="iw-nightable max-w-4xl mx-auto p-4 rounded-lg" style={{ background: 'var(--iw-score-paper, #fff)' }}>
      <header className="mb-4">
        <h1 className="font-serif text-xl" style={ink}>Score</h1>
        <p className="text-xs font-serif" style={muted}>
          Import a MusicXML export from Sibelius, MuseScore, Dorico or Finale. Inkwave shows, plays
          and annotates it — it never edits your notation.
        </p>
        {/* Zero-retention is REAL (nothing leaves the device). Encryption at rest is NOT — the spec
            says it is, and it isn't: storage/opfs.ts writes plaintext JSON. So this line says the
            true thing and no more. Do not "improve" it into a claim about encryption. */}
        <p className="text-xs font-serif mt-1" style={muted}>
          Your score stays on your device — we never hold it.
        </p>
      </header>

      {demo && (
        <p className="text-xs font-serif mb-3 px-2 py-1 rounded" style={{ ...ink, border: '1px solid var(--iw-nightable-border, #d6d3d1)' }}>
          Demo — a synthetic four-bar scale written for the test suite, not a real score.
        </p>
      )}

      <ImportRow onFile={onFile} />

      {error && (
        <p role="alert" className="text-xs font-serif my-2" style={{ color: 'var(--iw-badge-ai, #b45309)' }}>{error}</p>
      )}

      {masters.length > 0 && (
        <MasterList masters={masters} activeId={active?.meta?.id ?? null} onOpen={openMaster} />
      )}

      {active && (
        <>
          {active.score.warnings.map(w => (
            <p key={w} className="text-xs font-serif my-1" style={muted}>{w}</p>
          ))}
          <ScoreStage xml={active.xml} score={active.score} />
          {active.meta && (
            <ExcerptMaker
              score={active.score}
              masterId={active.meta.id}
              onInsert={tx => void addExcerpt(tx)}
            />
          )}
        </>
      )}

      {excerpts.map(x => <ExcerptView key={x.transclusion.id} excerpt={x} />)}
    </div>
  )
}

function ImportRow({ onFile }: { onFile: (f: File) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm font-serif cursor-pointer px-3 py-1.5 rounded"
      style={{ border: '1px solid var(--iw-nightable-border, #d6d3d1)', ...ink }}>
      Import a score
      <input
        type="file"
        // Accept both forms (§B2). The CONTENT is sniffed regardless (mxl.ts) — this only filters
        // the picker.
        accept=".musicxml,.mxl,.xml,application/vnd.recordare.musicxml,application/vnd.recordare.musicxml+xml"
        className="sr-only"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }}
      />
    </label>
  )
}

function MasterList({ masters, activeId, onOpen }: {
  masters: MasterMeta[]; activeId: string | null; onOpen: (m: MasterMeta) => void
}) {
  return (
    <ul className="my-3 text-sm font-serif">
      {masters.map(m => (
        <li key={m.id}>
          <button
            onClick={() => onOpen(m)}
            className="text-left w-full py-1 hover:bg-stone-50 rounded px-2"
            style={m.id === activeId ? ink : undefined}
          >
            {m.title || m.fileName}
            {m.composer && <span style={muted}> · {m.composer}</span>}
            <span style={muted}> · {m.measureCount} bars</span>
            {/* §B7: attribution travels with a library score, because the licence requires it. */}
            {m.attribution && (
              <span style={muted}> · {m.attribution.corpus} ({m.attribution.licence})</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}

/** The score plus its transport — the "easy win": automatic cursor, no tap-sync (§B3). */
function ScoreStage({ xml, score, from, to, showTitle = true }: {
  xml: string; score: Score; from?: number; to?: number; showTitle?: boolean
}) {
  const [measure, setMeasure] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [tempoScale, setTempoScale] = useState(1)
  const playerRef = useRef<ScorePlayer | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)

  const opts = useMemo(() => ({
    tempoScale,
    fromMeasureIndex: from !== undefined ? from - 1 : undefined,
    toMeasureIndex: to !== undefined ? to - 1 : undefined,
    rebase: from !== undefined,
  }), [tempoScale, from, to])

  useEffect(() => {
    return () => { playerRef.current?.dispose(); void ctxRef.current?.close() }
  }, [])

  const player = () => {
    if (!playerRef.current) {
      // Created on the first press, never at mount: constructing an AudioContext before a user
      // gesture leaves it suspended (and Safari warns), and it is real work no one asked for.
      ctxRef.current ??= new AudioContext()
      const p = new ScorePlayer(score, ctxRef.current, opts)
      p.onMeasure(setMeasure)
      p.onStateChange(setPlaying)
      playerRef.current = p
    }
    return playerRef.current
  }

  const toggle = () => {
    const p = player()
    if (p.playing) p.pause(); else void p.play()
  }

  const changeTempo = (scale: number) => {
    setTempoScale(scale)
    playerRef.current?.setTempoScale(scale)
  }

  return (
    <div className="my-3">
      <div className="flex items-center gap-3 mb-2 text-sm font-serif">
        <button onClick={toggle} className="px-3 py-1 rounded"
          style={{ border: '1px solid var(--iw-nightable-border, #d6d3d1)', ...ink }}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <label className="flex items-center gap-1 text-xs" style={muted}>
          Speed
          <select value={tempoScale} onChange={e => changeTempo(Number(e.target.value))} className="text-xs">
            <option value={0.5}>50%</option>
            <option value={0.75}>75%</option>
            <option value={1}>100%</option>
          </select>
        </label>
        {measure !== null && <span className="text-xs" style={muted}>bar {score.parts[0]?.measures[measure]?.number ?? measure + 1}</span>}
      </div>
      <ScoreView
        xml={xml}
        fromMeasureNumber={from}
        toMeasureNumber={to}
        cursorMeasureIndex={measure}
        showTitle={showTitle}
      />
    </div>
  )
}

/** Select a bar range and insert it as a TRANSCLUSION (§B6) — never a copy. */
function ExcerptMaker({ score, masterId, onInsert }: {
  score: Score; masterId: string; onInsert: (tx: Transclusion) => void
}) {
  const bars = score.parts[0]?.measures.map(m => m.number) ?? []
  const [start, setStart] = useState(bars[0] ?? '1')
  const [end, setEnd] = useState(bars[Math.min(1, bars.length - 1)] ?? '1')

  return (
    <div className="my-3 pt-3 text-sm font-serif" style={{ borderTop: '1px solid var(--iw-nightable-border, #e7e5e4)' }}>
      <span className="text-xs" style={muted}>Insert bars </span>
      <BarSelect bars={bars} value={start} onChange={setStart} label="first bar" />
      <span className="text-xs" style={muted}> to </span>
      <BarSelect bars={bars} value={end} onChange={setEnd} label="last bar" />
      <button
        onClick={() => onInsert(makeTransclusion(masterId, start, end))}
        className="ml-2 px-2 py-1 rounded text-xs"
        style={{ border: '1px solid var(--iw-nightable-border, #d6d3d1)', ...ink }}
      >
        Insert excerpt
      </button>
      <p className="text-xs mt-1" style={muted}>
        The excerpt stays linked to this score. Re-import a corrected version and every excerpt updates.
      </p>
    </div>
  )
}

function BarSelect({ bars, value, onChange, label }: {
  bars: string[]; value: string; onChange: (v: string) => void; label: string
}) {
  return (
    <select aria-label={label} value={value} onChange={e => onChange(e.target.value)} className="text-xs mx-1">
      {bars.map((b, i) => <option key={`${b}-${i}`} value={b}>{b}</option>)}
    </select>
  )
}

/** A rendered, playable excerpt — markup-only, never editable (§0/§B6). */
function ExcerptView({ excerpt }: { excerpt: ResolvedExcerpt }) {
  const { transclusion: tx, meta, score, osmdFrom, osmdTo } = excerpt
  // The MASTER's xml — the excerpt holds no notation of its own. Re-rendered from the master on
  // every resolve, which is what makes "fix the master, every excerpt updates" true (§B6).
  const [xml, setXml] = useState<string | null>(null)
  useEffect(() => { void loadMasterXml(tx.masterId).then(setXml) }, [tx.masterId])

  return (
    <figure className="my-4 p-3 rounded" style={{ border: '1px solid var(--iw-nightable-border, #e7e5e4)' }}>
      <figcaption className="text-xs font-serif mb-2" style={muted}>
        {meta.title || meta.fileName} — bars {tx.barStart}–{tx.barEnd}
        {meta.attribution && <> · {meta.attribution.corpus} ({meta.attribution.licence})</>}
      </figcaption>
      {xml && <ScoreStage xml={xml} score={score} from={osmdFrom} to={osmdTo} showTitle={false} />}
    </figure>
  )
}

export default MusicPanel
