import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
// CRITICAL-PATH SPLIT: the editor graph (Tiptap/PM, KaTeX, the 30k-word list, citations, Clerk)
// is the bulk of the app's JS. Lazy-loading it means the tiny shell chunk hydrates immediately —
// waves + drift on screen — while the editor chunk downloads IN PARALLEL with the OPFS document
// read, instead of everything executing serially before anything can mount.
// The import is kicked EAGERLY at module scope (2026-07-11): `lazy(() => import(...))` alone only
// starts the fetch on the component's FIRST RENDER — i.e. after setDoc — so the chunk fetch+eval
// was actually SERIALIZED behind the whole storage read (measured on Chromium: chunk request at
// 4.0s, the moment the doc resolved). Kicking it here restores the designed parallelism: the
// fetch+eval overlap the OPFS/IndexedDB load, and any storage stall no longer adds to boot.
// (browser only: the prerender/SSR pass must not eval the editor graph at module scope)
const tiptapEditorImport = typeof window !== 'undefined' ? import('../editor/TiptapEditor') : null
const TiptapEditor = lazy(() => (tiptapEditorImport ?? import('../editor/TiptapEditor')).then(m => ({ default: m.TiptapEditor })))
import { Scroll, EmptyEditorSurface, isTouchDevice } from '../editor/Scroll'
import type { InkwaveDocument } from '../types/document'
import { loadDocument, emptyTiptapDoc } from '../storage/opfs'
import { listMeta } from '../storage/indexeddb'
import { withScasDefaults } from '../scas/defaults'

// The active document ID is persisted in localStorage so the same document
// reopens on refresh. (Content itself is in OPFS — this is just the pointer.)
const ACTIVE_DOC_KEY = 'inkwave:activeDocumentId'

function newDocument(): InkwaveDocument {
  return withScasDefaults({
    id: uuidv4(),
    title: 'Untitled',
    contentJson: emptyTiptapDoc(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    schemaVersion: '0.1.0',
    scasLimitN: 'infinite',
    scasSessionSeed: uuidv4(),
  })
}

// Fill in fields for documents saved before they existed (incl. the SCAS engine state).
function migrateDocument(doc: InkwaveDocument): InkwaveDocument {
  return withScasDefaults(Object.assign({ scasLimitN: 'infinite', scasSessionSeed: uuidv4() }, doc))
}

export function Edit() {
  const [doc, setDoc] = useState<InkwaveDocument | null>(null)
  // ONE persistent loading shell (the waves). The old shape rendered the waves surface in THREE
  // tree positions across a load — the !doc return, the Suspense fallback, then the editor's own
  // surface — and each swap REMOUNTED .inkwave-editor-surface, recreating the wave pseudo-layers:
  // the two predictable flashes during load. Now a single shell instance spans !doc + the lazy
  // editor chunk + the editor's pre-reveal settle. It renders AFTER (so on top of) the mounting
  // editor — both are opaque fixed surfaces, DOM order stacks them; the editor's floating chrome
  // keeps its explicit z-indexes above, exactly as before — and unmounts in the SAME React commit
  // the editor reveals ('inkwave:editor-revealed' is dispatched in the same task as setSettled(true),
  // so React batches shell-unmount + reveal + the wave coast start into one paint). The editor's
  // surface underneath is phase-synced to the same wall clock (--wave-phase, set pre-paint), so the
  // swap is pixel-identical.
  // 'up' → covering; 'fading' → 0.5s opacity cross-fade (doc/text/pills fade in atomically
  // underneath, over the still-coasting waves); 'down' → unmounted.
  const [shellUp, setShellUp] = useState<'up' | 'fading' | 'down'>('up')
  // The shell is PRERENDERED (build-time: no window → phone=false), and React production
  // hydration does NOT correct attribute mismatches — so on a phone the shell used to run the
  // whole load DESKTOP-classed and only gained .is-phone when shellUp changed at reveal: the
  // wave rule-set (coast duration/distance vars) switched under a RUNNING animation mid-coast →
  // position jump, early animationend, early shell drop (Peter's "jumps to the last section",
  // 2026-07-10). Correct the class in the first post-hydration commit instead — the water is
  // still display-gated (.iw-water-ready decode) then, so the swap can never be seen.
  const [shellPhone, setShellPhone] = useState(false)
  // LAYOUT effect: the correction must land before the first post-hydration paint — if it raced
  // the atomic-water gate (slow cold hydration), the desktop→phone rule swap would land mid-drift
  // and restart the running wave animations.
  useLayoutEffect(() => { setShellPhone(isTouchDevice()) }, [])
  useEffect(() => {
    let t = 0
    let t2 = 0
    let revealedAt = 0 // when the editor's 0.8s paper fade STARTED (phone ordering guard below)
    let restSeen = false
    const onRevealed = () => {
      revealedAt = performance.now()
      // PHONE (2026-07-11, the iOS "goes white" fix): ONE visible water until rest, and the
      // shell must NOT fade — fading the only water exposed the body parchment through the
      // transparent covered editor MID-COAST. Instead the shell stays fully OPAQUE ('up') and
      // the covered editor sits ABOVE it (z-raised, transparent — .iw-wave-covered.is-phone), so
      // the parchment + chrome fade in OVER the still-decelerating water. At 'inkwave:wave-rest'
      // the shell drops and the editor uncovers in one commit — parchment-to-parchment, no
      // mid-motion swap. A CAP forces the drop 4s after reveal even if wave-rest never fires
      // (bulletproof: the shell may never persist forever).
      if (isTouchDevice()) {
        clearTimeout(t)
        t = window.setTimeout(() => setShellUp('down'), 4000) // safety net only — wave-rest is the real trigger
        return
      }
      setShellUp('fading')
      t = window.setTimeout(() => setShellUp('down'), 1030) // 1s desktop fade
    }
    // ORDERING GUARD (2026-07-11): wave-rest is compositor-clocked (animationend ~2s after the
    // freeze) while the reveal is a main-thread timer + React commit — on a slow phone the coast
    // can END before the paper above has finished its 0.8s fade-in. Dropping the shell then would
    // flash parchment through the half-faded paper (a paler echo of the white-out). So the drop
    // waits for BOTH: the waves at rest AND the fade complete (revealedAt + 850ms). The still
    // water lingering a few hundred ms is invisible next to a pale flash. The 4s post-reveal cap
    // (onRevealed above) is unchanged — the shell can still never persist forever.
    const onRest = () => {
      if (!isTouchDevice()) return
      restSeen = true
      const wait = revealedAt ? Math.max(0, revealedAt + 850 - performance.now()) : 0
      if (!revealedAt) return // reveal hasn't landed — onRevealed's cap (or the drop below) covers it
      if (wait === 0) setShellUp('down')
      else { clearTimeout(t2); t2 = window.setTimeout(() => setShellUp('down'), wait) }
    }
    // If rest arrived BEFORE the reveal (heavily starved boot), drop once the fade completes.
    const onRevealedLate = () => {
      if (isTouchDevice() && restSeen) { clearTimeout(t2); t2 = window.setTimeout(() => setShellUp('down'), 850) }
    }
    window.addEventListener('inkwave:editor-revealed', onRevealed)
    window.addEventListener('inkwave:editor-revealed', onRevealedLate)
    window.addEventListener('inkwave:wave-rest', onRest)
    return () => {
      clearTimeout(t)
      clearTimeout(t2)
      window.removeEventListener('inkwave:editor-revealed', onRevealed)
      window.removeEventListener('inkwave:editor-revealed', onRevealedLate)
      window.removeEventListener('inkwave:wave-rest', onRest)
    }
  }, [])

  useEffect(() => {
    async function init() {
      try {
        // 1. Try to restore the last active document from OPFS.
        const storedId = localStorage.getItem(ACTIVE_DOC_KEY)
        if (storedId) {
          const loaded = await loadDocument(storedId)
          if (loaded) {
            setDoc(migrateDocument(loaded))
            return
          }
        }

        // 2. Fall back to the most recently updated document in IndexedDB.
        const metas = await listMeta()
        if (metas.length > 0) {
          const loaded = await loadDocument(metas[0].id)
          if (loaded) {
            localStorage.setItem(ACTIVE_DOC_KEY, loaded.id)
            setDoc(migrateDocument(loaded))
            return
          }
        }

        // 3. Create a fresh document.
        const fresh = newDocument()
        localStorage.setItem(ACTIVE_DOC_KEY, fresh.id)
        setDoc(fresh)
      } catch (err) {
        console.error('[inkwave] init failed:', err)
        // Never strand the writer on the blank placeholder. Fall back to a fresh
        // in-memory document under a NEW id, so no existing file is ever overwritten.
        // localStorage can throw (private mode), so guard it on its own.
        const fresh = newDocument()
        try { localStorage.setItem(ACTIVE_DOC_KEY, fresh.id) } catch { /* private mode */ }
        setDoc(fresh)
      }
    }

    void init()
  }, [])

  function handleDocChange(updated: InkwaveDocument) {
    setDoc(updated)
  }

  // OPEN CHOREOGRAPHY: the instant an open starts, hide the current page (doc → null renders the
  // waves-only loading shell, drift running) for the WHOLE load; the new doc then reveals
  // atomically via the normal settled gate. A failed open restores the stashed doc — never a
  // stranded blank shell.
  const stashedDocRef = useRef<InkwaveDocument | null>(null)
  useEffect(() => {
    const onBegin = () => {
      setShellUp('up') // waves-only for the whole load; fades again at the new doc's reveal
      setDoc((d) => { if (d) stashedDocRef.current = d; return null })
    }
    const onFailed = () => setDoc((d) => d ?? stashedDocRef.current)
    window.addEventListener('inkwave:open-begin', onBegin)
    window.addEventListener('inkwave:open-failed', onFailed)
    return () => {
      window.removeEventListener('inkwave:open-begin', onBegin)
      window.removeEventListener('inkwave:open-failed', onFailed)
    }
  }, [])

  // Switch documents IN PLACE (no full reload) when asked — used by "Open…" with a writable file
  // handle, so the just-granted file permission survives (a reload would drop it → no auto-save).
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ id: string; doc?: InkwaveDocument }>).detail
      const id = detail?.id
      if (!id) return
      // openInkwaveFile passes the just-parsed document in the event — use it directly instead of
      // re-reading + JSON.parsing the same (possibly multi-MB) file it just wrote to OPFS. The
      // OPFS read stays as the fallback for any dispatcher that only sends an id.
      if (detail.doc && detail.doc.id === id) { setDoc(migrateDocument(detail.doc)); return }
      void loadDocument(id).then((loaded) => {
        if (loaded) setDoc(migrateDocument(loaded))
        else console.warn('[inkwave] open-doc: document not found in OPFS after import:', id)
      })
    }
    window.addEventListener('inkwave:open-doc', onOpen as EventListener)
    return () => window.removeEventListener('inkwave:open-doc', onOpen as EventListener)
  }, [])

  // The persistent shell (see shellUp above) is the SHARED empty-editor facsimile — the same Scroll
  // chrome + an empty .ProseMirror the live editor uses — so the prerendered landing page (doc=null,
  // shellUp=true → shell only) is a direct CSS function of the editor, and the editor reveals under
  // it with no visual jump.
  // key={doc.id} → switching documents in place cleanly remounts the editor (sessions, snapshots,
  // sync reconnect all re-run for the new doc). fallback={null}: the shell on top already provides
  // the loading visuals — a fallback surface here would be a second instance that remounts on every
  // suspend (one of the old load flashes).
  return (
    <>
      {doc && (
        <Suspense fallback={null}>
          <TiptapEditor key={doc.id} doc={doc} onDocChange={handleDocChange} />
        </Suspense>
      )}
      {shellUp !== 'down' && (
        <Scroll phone={shellPhone} fill revealed={false} fadingOut={shellUp === 'fading'}>
          <EmptyEditorSurface />
        </Scroll>
      )}
    </>
  )
}
