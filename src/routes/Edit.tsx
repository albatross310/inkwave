import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
// CRITICAL-PATH SPLIT: the editor graph (Tiptap/PM, KaTeX, the 30k-word list, citations, Clerk)
// is the bulk of the app's JS. Lazy-loading it means the tiny shell chunk hydrates immediately —
// waves + drift on screen — while the editor chunk downloads IN PARALLEL with the OPFS document
// read, instead of everything executing serially before anything can mount.
const TiptapEditor = lazy(() => import('../editor/TiptapEditor').then(m => ({ default: m.TiptapEditor })))
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
  const [shellUp, setShellUp] = useState(true)
  useEffect(() => {
    const onRevealed = () => setShellUp(false)
    window.addEventListener('inkwave:editor-revealed', onRevealed)
    return () => window.removeEventListener('inkwave:editor-revealed', onRevealed)
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
      setShellUp(true) // waves-only for the whole load; drops again at the new doc's reveal
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
      const id = (e as CustomEvent<{ id: string }>).detail?.id
      if (!id) return
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
      {shellUp && (
        <Scroll phone={isTouchDevice()} fill revealed={false}>
          <EmptyEditorSurface />
        </Scroll>
      )}
    </>
  )
}
