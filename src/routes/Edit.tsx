import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
// ⚠ CRITICAL-PATH SPLIT, and the import is kicked EAGERLY at module scope. The editor graph
// (Tiptap/PM, KaTeX, the 30k-word list, citations, Clerk) is the bulk of the app's JS; `lazy()`
// alone starts the fetch on the FIRST RENDER, i.e. after setDoc, which SERIALIZED the chunk behind
// the whole storage read (measured: chunk request at 4.0s, the moment the doc resolved). Browser
// only — the prerender pass must not eval the editor graph at module scope.
// ⚠ CONSUMED VIA STATE, NEVER React.lazy/Suspense. `lazy` suspends its first render and React
// retries at TRANSITION priority — a TIME-SLICED render — and @tiptap/react creates the editor
// synchronously inside it, so its 1ms scheduleDestroy fired between slices: two ~950ms creations
// and every [editor]-keyed effect (the whole reveal chain) running TWICE per load.
// → docs/archive/panels-and-popovers.md#edit-critical-path-split
const tiptapEditorImport = typeof window !== 'undefined' ? import('../editor/TiptapEditor') : null
import { Scroll, EmptyEditorSurface, isTouchDevice } from '../editor/Scroll'
import type { InkwaveDocument } from '../types/document'
import { readDocument, saveDocument, emptyTiptapDoc, StorageReadError } from '../storage/opfs'
import { listMeta, upsertMeta } from '../storage/indexeddb'
import { withScasDefaults } from '../scas/defaults'
import { resolveTabDocId, claimTabDoc, claimDocLock, releaseDocLock, switchTabToDocument, isExplicitDocIntent, isBlankUntitledDocument } from '../storage/tabDoc'
import { installHolder, requestSwitch, takeOverHere } from '../storage/singleOpen'
import { StorageUnavailable } from '../components/StorageUnavailable'
import { DocumentOpenElsewhere, SurrenderedBanner } from '../components/DocumentOpenElsewhere'

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

// "Open a copy" — clone a held document under a NEW id so the original can never diverge. The copy
// carries the prose and everything that makes it usable (bibliography, headers, media refs, toolbar),
// but DELIBERATELY drops the identity-bound provenance: the signed receipt chain, the SCAS engine
// state and green anchors attest the ORIGINAL document's history, and carrying them to a fresh id
// would let a copy masquerade as the thing it was cloned from. A new id also means no snapshot
// archive and no cloud binding travel with it — exactly the isolation "no divergence" requires.
function cloneForCopy(base: InkwaveDocument): InkwaveDocument {
  const now = new Date().toISOString()
  const { scasReceipts: _r, scasState: _s, scasGreenAnchors: _g, ...rest } = base
  void _r; void _s; void _g
  return migrateDocument(withScasDefaults({
    ...rest,
    id: uuidv4(),
    title: `${base.title || 'Untitled'} (copy)`,
    createdAt: now,
    updatedAt: now,
    scasSessionSeed: uuidv4(),
  }))
}

export function Edit() {
  const [doc, setDoc] = useState<InkwaveDocument | null>(null)
  // A read FAILED (not "there is nothing here"). Never null-and-blank: see the catch in init().
  const [loadError, setLoadError] = useState<StorageReadError | null>(null)
  // This tab tried to open a document another window on this device already holds. We do NOT open it
  // (two writers on one file blind-overwrite each other); we show the choose-how-to-continue screen.
  const [blocked, setBlocked] = useState<{ id: string; title: string } | null>(null)
  // This tab HELD a document and another window took it over. Its writes are already frozen at the
  // storage funnel; this flag surfaces the read-only banner so the writer isn't confused by an editor
  // that silently stopped saving.
  const [surrendered, setSurrendered] = useState(false)
  // The editor component, held in state once its chunk resolves (see the double-mount note at
  // the top of the file). null until then — the loading shell covers either way.
  const [EditorComp, setEditorComp] = useState<typeof import('../editor/TiptapEditor').TiptapEditor | null>(null)
  useEffect(() => {
    let alive = true
    void tiptapEditorImport?.then((m) => { if (alive) setEditorComp(() => m.TiptapEditor) })
    return () => { alive = false }
  }, [])
  // ⚠ ONE PERSISTENT LOADING SHELL. Rendering the waves surface in three tree positions across a
  // load remounted `.inkwave-editor-surface` each swap and recreated the wave pseudo-layers — the
  // two flashes. One instance spans !doc + the editor chunk + the pre-reveal settle, renders ON TOP
  // of the mounting editor, and unmounts in the SAME React commit the desktop editor reveals.
  // → docs/archive/panels-and-popovers.md#edit-one-shell
  // Do not cross-fade the two water surfaces. Even when their spatial clocks are identical, two
  // translucent copies change the marks' brightness; fading the shell then makes the marks vanish
  // before the editor copy returns. Desktop swaps ownership atomically. Phone deliberately keeps
  // the shell until wave-rest (the separate ordering guard below).
  const [shellUp, setShellUp] = useState<'up' | 'down'>('up')
  // ⚠ THE SHELL IS PRERENDERED (no window ⇒ phone=false) and React production hydration does NOT
  // correct attribute mismatches, so a phone ran the whole load DESKTOP-classed and switched the
  // wave rule-set under a RUNNING animation at reveal. Correct the class in the first
  // post-hydration commit, while the water is still display-gated.
  const [shellPhone, setShellPhone] = useState(false)
  // LAYOUT effect: the correction must land before the first post-hydration paint — if it raced
  // the atomic-water gate (slow cold hydration), the desktop→phone rule swap would land mid-drift
  // and restart the running wave animations.
  useLayoutEffect(() => { setShellPhone(isTouchDevice()) }, [])
  useEffect(() => {
    let t2 = 0
    let revealedAt = 0 // when the editor's 0.8s paper fade STARTED (phone ordering guard below)
    let restSeen = false
    const onRevealed = () => {
      revealedAt = performance.now()
      // ⚠ PHONE: ONE VISIBLE WATER UNTIL REST, and the shell must NOT fade — fading the only water
      // exposed the body parchment through the transparent covered editor MID-COAST (the iOS "goes
      // white"). The shell stays OPAQUE and the covered editor sits ABOVE it, so parchment + chrome
      // fade in OVER the decelerating water; at wave-rest both swap in one commit.
      if (isTouchDevice()) {
        if (restSeen) { clearTimeout(t2); t2 = window.setTimeout(() => setShellUp('down'), 850) } // rest landed first (starved boot): drop once the fade completes
        return
      }
      // The editor's setSettled(true) and this event occur in one task, so React commits the
      // shell removal and editor-water uncover together. The page itself still performs its own
      // 1s opacity reveal over that single, uninterrupted water owner.
      setShellUp('down')
    }
    // ⚠ ORDERING GUARD: wave-rest is compositor-clocked while the reveal is a main-thread timer, so
    // on a slow phone the coast can END mid-fade and dropping the shell would flash parchment. Wait
    // for BOTH — waves at rest AND the fade complete.
    const onRest = () => {
      if (!isTouchDevice()) return
      restSeen = true
      if (!revealedAt) return // reveal hasn't landed — onRevealed drops once its fade completes
      const wait = Math.max(0, revealedAt + 850 - performance.now())
      if (wait === 0) setShellUp('down')
      else { clearTimeout(t2); t2 = window.setTimeout(() => setShellUp('down'), wait) }
    }
    // THE WATCHDOG (the one backstop — Scroll.tsx fires it if SETTLE never arrived): log-and-
    // force. Never fires on a healthy load.
    const onWatchdog = () => setShellUp('down')
    // PER-LOAD RESET (2026-07-11, the OPEN-DOC white-out): these closure vars live for the
    // component's whole life, but they describe ONE load — stale reveal/rest state (or a live
    // timer) from the previous load must never act on the next one's covering shell. Every open
    // starts a fresh choreography.
    const onBegin = () => {
      revealedAt = 0
      restSeen = false
      clearTimeout(t2)
    }
    window.addEventListener('inkwave:open-begin', onBegin)
    window.addEventListener('inkwave:editor-revealed', onRevealed)
    window.addEventListener('inkwave:wave-rest', onRest)
    window.addEventListener('inkwave:load-watchdog', onWatchdog)
    return () => {
      clearTimeout(t2)
      window.removeEventListener('inkwave:open-begin', onBegin)
      window.removeEventListener('inkwave:editor-revealed', onRevealed)
      window.removeEventListener('inkwave:wave-rest', onRest)
      window.removeEventListener('inkwave:load-watchdog', onWatchdog)
    }
  }, [])

  useEffect(() => {
    // ⚠ AN EFFECT THAT TAKES A LOCK NEEDS A TOKEN THAT ALSO RELEASES IT. StrictMode's
    // mount→cleanup→remount is a real second claimant, and this effect had no cleanup: a new tab
    // minted TWO documents and orphaned the first one's lock forever, while a reload RACED itself
    // for one lock and the loser's "another session is open" screen could win the final render,
    // permanently. Skipping the stale setState alone does NOT fix the leak. `claimedId` tracks what
    // THIS invocation holds; every commit point clears it and every exit path releases it first.
    // → docs/archive/panels-and-popovers.md#edit-strictmode-lock-race
    let cancelled = false
    let claimedId: string | null = null

    async function init() {
      try {
        const openFresh = () => {
          const fresh = newDocument()
          claimTabDoc(fresh.id)
          claimedId = null
          setDoc(fresh)
        }
        // 1. THIS TAB's own document — `?doc=`, else the per-tab sessionStorage identity, else
        //    (brand-new tab only) the last-doc hint. See storage/tabDoc.ts for why the per-tab
        //    identity is authoritative and the URL is not: OneDrive's sign-in redirect returns to a
        //    bare `/`, so a tab must be able to remember its document with no help from the URL.
        //    This is what stops another tab's document switch from re-pointing this tab on reload.
        const { id: storedId, source } = resolveTabDocId()
        if (storedId) {
          // ⚠ ONE LIVE TAB PER DOCUMENT (tabDoc.ts): `saveDocument` writes the whole file with no
          // union and no generation check, so two tabs blind-autosave over each other. A plain
          // reload re-claims normally (claimDocLock retries past the unload race), so this only
          // fires for a genuinely concurrent second tab.
          const mine = await claimDocLock(storedId)
          if (mine) claimedId = storedId
          if (cancelled) { if (mine) releaseDocLock(storedId); return }
          if (!mine) {
            // ⚠ ONLY AN EXPLICIT REQUEST EARNS THE BLOCKED SCREEN — a `?doc=` link or this tab's own
            // remembered identity. A fresh tab that merely inherited the origin-wide hint had no
            // opinion about this file and falls through, so it is never blocked on a doc it did not
            // choose. → docs/archive/panels-and-popovers.md#edit-tab-identity
            if (isExplicitDocIntent(source)) {
              // Only a title for a banner — the one place a failed read may be shrugged off, because
              // nothing is written on the strength of it.
              const busy = await readDocument(storedId)
              if (cancelled) return
              // A duplicated tab inherits the source tab's URL/session identity. If that identity
              // names a brand-new untouched page, the lock is protecting no writing: silently give
              // this tab its own blank id. The held blank remains untouched in the original tab.
              // A written-but-still-named-Untitled document does NOT qualify (predicate is structural).
              if (busy.kind === 'absent' || (busy.kind === 'found' && isBlankUntitledDocument(busy.doc))) {
                openFresh()
                return
              }
              setBlocked({ id: storedId, title: busy.kind === 'found' ? busy.doc.title : 'This document' })
              return
            }
            // last-hint: fall through to step 2 (walk to the next document no live tab holds).
          } else {
            const r = await readDocument(storedId)
            if (cancelled) { releaseDocLock(storedId); claimedId = null; return }
            // 'error' is NOT 'absent'. Falling through to step 3 on a failed read is what handed
            // Peter a blank page where his thesis had been (11:19:40) and repointed the pointer at
            // it. The compiler now makes ignoring this case impossible to do by accident.
            if (r.kind === 'error') throw r.error
            if (r.kind === 'found') {
              claimTabDoc(r.doc.id) // pin to THIS tab (a `?doc=`/hint boot has not claimed it yet)
              claimedId = null // committed — the tab owns this for real now, not this closure's job
              setDoc(migrateDocument(r.doc))
              return
            }
            // 'absent' ⇒ genuinely nothing under this id; fall through and keep looking.
            releaseDocLock(storedId)
            claimedId = null
          }
        }

        // 2. Fall back to the most recently updated document in IndexedDB that no live tab holds.
        //
        // ⚠ NOT FOR A BRAND-NEW TAB — this walk is what made every new tab revert to the same
        // document (Peter, 2026-08-28: "new tabs to open as blank"). It stays right for what it was
        // written for: a tab that HAD an identity and found that document gone is RECOVERING, and a
        // recovery should try. A fresh tab is not recovering from anything.
        // → docs/archive/panels-and-popovers.md#edit-fresh-tab-blank
        const freshTab = source === 'none'
        let sawReadFailure = false
        for (const meta of freshTab ? [] : await listMeta()) {
          if (cancelled) return
          if (!(await claimDocLock(meta.id))) continue // open in another tab — keep looking
          claimedId = meta.id
          if (cancelled) { releaseDocLock(meta.id); claimedId = null; return }
          // One unreadable document must not end the search — the NEXT one may be perfectly
          // readable, and opening the writer's real work beats any error screen. But we remember
          // that a read FAILED, because that changes what step 3 is allowed to conclude.
          const r = await readDocument(meta.id)
          if (cancelled) { releaseDocLock(meta.id); claimedId = null; return }
          if (r.kind === 'error') {
            sawReadFailure = true
            console.error('[inkwave] init: could not read an indexed document:', meta.id, r.error)
            releaseDocLock(meta.id)
            claimedId = null
            continue
          }
          if (r.kind === 'found') {
            claimTabDoc(r.doc.id)
            claimedId = null // committed
            setDoc(migrateDocument(r.doc))
            return
          }
          releaseDocLock(meta.id) // indexed but not in OPFS — don't sit on a claim we can't use
          claimedId = null
        }

        // 3. Create a fresh document. REACHABLE ONLY FROM ABSENCE — every step above either opened
        //    a document or established that there is genuinely nothing there to open — or, for a
        //    brand-new tab, deliberately declined to look (step 2's note).
        //    If ANY read failed along the way we do not get to conclude "this writer has nothing":
        //    that inference, drawn from a failure, is the whole 2026-07-15 bug. Fail loudly instead.
        if (sawReadFailure) throw new StorageReadError('documents', new Error('one or more documents could not be read'))
        if (cancelled) return
        openFresh()
      } catch (err) {
        if (cancelled) return
        // ⚠ A READ FAILURE IS NOT AN ABSENT DOCUMENT (R1). Never mint a document — a blank page IS
        // the bug, telling the writer wordlessly that their thesis is gone — never touch the
        // active-doc pointer, say what happened, and put the recovery surface one click away.
        // → docs/archive/panels-and-popovers.md#edit-read-failure
        console.error('[inkwave] init: could not read this device\'s storage:', err)
        setLoadError(err instanceof StorageReadError ? err : new StorageReadError('storage', err))
      }
    }

    void init()
    return () => {
      cancelled = true
      // Backstop for any commit point above that isn't reachable synchronously from here (e.g. this
      // fires while init() is mid-`await` and hasn't reached its own cancelled-check yet) — whatever
      // this invocation currently holds and hasn't committed to a setDoc gets released, never leaked.
      if (claimedId) { releaseDocLock(claimedId); claimedId = null }
    }
  }, [])

  function handleDocChange(updated: InkwaveDocument) {
    setDoc(updated)
  }

  // SINGLE-OPEN, holder side: while this tab holds a document, listen for another window on this
  // device asking to switch to it or take it over. installHolder also arms the freeze-on-steal
  // backstop. Re-runs on every document this tab comes to hold — a normal open, a take-over, a copy.
  useEffect(() => {
    if (!doc?.id) return
    return installHolder(doc.id)
  }, [doc?.id])

  // SINGLE-OPEN, loser side: another window took this document over. The write freeze already
  // stopped this tab persisting (storage/opfs.ts); reflect it so the writer sees read-only rather
  // than an editor that silently drops their keystrokes.
  useEffect(() => {
    const onSurrendered = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id
      if (id && id === doc?.id) setSurrendered(true)
    }
    window.addEventListener('inkwave:doc-surrendered', onSurrendered as EventListener)
    return () => window.removeEventListener('inkwave:doc-surrendered', onSurrendered as EventListener)
  }, [doc?.id])

  // "Open a copy" — clone the held document under a new id and switch this tab to it (claim + reload).
  // The original is never touched; the reload lands cleanly on the copy (which no tab holds).
  async function handleOpenCopy(sourceId: string) {
    const r = await readDocument(sourceId)
    const copy = r.kind === 'found' ? cloneForCopy(r.doc) : newDocument()
    await saveDocument(copy)
    await upsertMeta({ id: copy.id, title: copy.title, updatedAt: copy.updatedAt })
    switchTabToDocument(copy.id)
  }

  // "Take over here" — the safe handshake: the holder freezes + flushes and ACKs BEFORE this returns
  // (storage/singleOpen.ts), and only then does this tab read the freshest body and open it in place.
  // No reload, so the stolen lock this tab now holds is kept.
  async function handleTakeOver(id: string) {
    await takeOverHere(id)
    const r = await readDocument(id)
    if (r.kind === 'error') throw r.error
    if (r.kind === 'absent') throw new Error('the document could not be found after taking over')
    claimTabDoc(r.doc.id)
    setDoc(migrateDocument(r.doc))
    setBlocked(null)
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
      void readDocument(id).then((r) => {
        if (r.kind === 'found') setDoc(migrateDocument(r.doc))
        // Nothing to recover in either failure: the dispatcher already holds the parsed doc. But
        // they are still different facts and are still reported as such.
        else if (r.kind === 'absent') console.warn('[inkwave] open-doc: document not found in OPFS after import:', id)
        else console.error('[inkwave] open-doc: could not read the imported document:', id, r.error)
      })
    }
    window.addEventListener('inkwave:open-doc', onOpen as EventListener)
    return () => window.removeEventListener('inkwave:open-doc', onOpen as EventListener)
  }, [])

  // The persistent shell is the SHARED empty-editor facsimile (the same Scroll chrome + an empty
  // .ProseMirror), so the prerendered landing page is a direct CSS function of the editor and the
  // editor reveals under it with no visual jump. key={doc.id} remounts cleanly on a doc switch.
  // ⚠ No Suspense here — see the double-mount note at the top of the file.
  //
  // ⚠ A READ FAILED. Show what happened, never a blank page: that conclusion is what sent Peter to
  // a backup file, which then overwrote the real thing. Storage — the surface that can SEE and
  // export every document on the device — goes right here, not buried in a menu.
  // → docs/archive/panels-and-popovers.md#edit-read-failure
  if (loadError) {
    return (
      <StorageUnavailable
        error={loadError}
        onRetry={() => window.location.reload()}
      />
    )
  }

  // This document is open in another window on this device. Offer the three ways forward rather than
  // silently opening something else (see init()).
  if (blocked) {
    return (
      <DocumentOpenElsewhere
        title={blocked.title}
        onSwitch={() => requestSwitch(blocked.id)}
        onOpenCopy={() => handleOpenCopy(blocked.id)}
        onTakeOver={() => handleTakeOver(blocked.id)}
      />
    )
  }

  return (
    <>
      {doc && EditorComp && (
        <EditorComp key={doc.id} doc={doc} onDocChange={handleDocChange} />
      )}
      {shellUp !== 'down' && (
        <Scroll phone={shellPhone} fill revealed={false}>
          <EmptyEditorSurface />
        </Scroll>
      )}
      {surrendered && <SurrenderedBanner onReload={() => window.location.reload()} />}
    </>
  )
}
