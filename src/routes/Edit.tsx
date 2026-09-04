import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
//
// DOUBLE-MOUNT FIX (2026-07-11, "the editor mounts TWICE per load"): the module is consumed via
// STATE below, NOT React.lazy/Suspense. lazy always suspends its first render (even with the
// promise long resolved), and React retries suspended boundaries at TRANSITION priority — a
// TIME-SLICED render. @tiptap/react's useEditor (default immediatelyRender) creates the editor
// synchronously inside that sliced render, and its 1ms not-yet-mounted safety timer
// (scheduleDestroy) fired between slices: editor #1 destroyed mid-render, the mount effect built
// editor #2 — two ~950ms creations and every [editor]-keyed effect (the whole reveal chain,
// pagination-ready, reveal-imminent, editor-revealed) running TWICE per load. Holding the
// resolved component in state mounts it in ONE default-lane (non-interruptible) render+commit
// task, so the timer can never interleave — one editor, one reveal chain, and creation still
// starts early (in-render). Do not reintroduce lazy/Suspense here.
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
      // mid-motion swap. (wave-rest ALWAYS arrives: the rest handoff is a resolved-clock timer
      // over compositor-only playback; the 30s load watchdog in Scroll.tsx is the one backstop.)
      if (isTouchDevice()) {
        if (restSeen) { clearTimeout(t2); t2 = window.setTimeout(() => setShellUp('down'), 850) } // rest landed first (starved boot): drop once the fade completes
        return
      }
      setShellUp('fading')
      t = window.setTimeout(() => setShellUp('down'), 1030) // 1s desktop fade
    }
    // ORDERING GUARD (2026-07-11): wave-rest is compositor-clocked while the reveal is a
    // main-thread timer + React commit — on a slow phone the coast can END before the paper
    // above has finished its 0.8s fade-in. Dropping the shell then would flash parchment through
    // the half-faded paper. So the drop waits for BOTH: the waves at rest AND the fade complete
    // (revealedAt + 850ms). The still water lingering a few hundred ms is invisible next to a
    // pale flash.
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
      clearTimeout(t)
      clearTimeout(t2)
    }
    window.addEventListener('inkwave:open-begin', onBegin)
    window.addEventListener('inkwave:editor-revealed', onRevealed)
    window.addEventListener('inkwave:wave-rest', onRest)
    window.addEventListener('inkwave:load-watchdog', onWatchdog)
    return () => {
      clearTimeout(t)
      clearTimeout(t2)
      window.removeEventListener('inkwave:open-begin', onBegin)
      window.removeEventListener('inkwave:editor-revealed', onRevealed)
      window.removeEventListener('inkwave:wave-rest', onRest)
      window.removeEventListener('inkwave:load-watchdog', onWatchdog)
    }
  }, [])

  useEffect(() => {
    // ⚠ 2026-08-20 — STRICTMODE DOUBLE-INVOKE RACE, the actual cause behind "another session is
    // open" appearing after a completely ordinary refresh with only one real tab involved (reproduced
    // 100% of the time in isolated single-tab headless testing — no second tab, no other browser
    // context, nothing else running). entry.client.tsx wraps the app in <StrictMode>, which in DEV
    // deliberately mount→cleanup→remounts every effect once to surface exactly this class of bug —
    // and this effect had no cleanup at all, so BOTH invocations ran their full async claim sequence
    // for real. TWO consequences, both observed directly via navigator.locks.query():
    //  (a) On a brand-new tab (no stored id yet), each invocation calls newDocument() independently
    //      and claims its OWN fresh random id — so the tab ends up holding TWO document locks at
    //      once, with only the SECOND invocation's id ever written to sessionStorage. The first id's
    //      lock is now an ORPHAN: nothing releases it, ever, for the rest of that page's life.
    //  (b) On a reload (both invocations resolve the SAME stored id from sessionStorage), they RACE
    //      for that one lock via claimDocLock's `{ifAvailable:true}` request — Web Locks does not
    //      special-case "same page", so the loser sees it as unavailable exactly as it would from a
    //      genuine second tab, and calls setBlocked(...). Whichever invocation's setState call lands
    //      LAST wins the final render — so even though the winner ALSO successfully opened the
    //      document, the loser's blocked screen can still be what's on screen, PERMANENTLY (nothing
    //      ever retries after this point; matches the 8+ second observed persistence).
    // FIX: standard React cancellation-token pattern, but it has to do more than skip stale setState
    // calls — it must also RELEASE any lock a cancelled invocation already claimed, or (a)'s leak
    // still happens even with mismatched UI state avoided. `claimedId` tracks whatever THIS
    // invocation currently holds; every commit point clears it (the claim is now "real", owned by the
    // component for its lifetime) and every early-exit / cancellation path releases it first.
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
          // ONE LIVE TAB PER DOCUMENT (tabDoc.ts): two tabs on one file blind-autosave over each
          // other and one tab's words are destroyed — `saveDocument` writes the whole file with no
          // union and no generation check. So if another LIVE tab is already editing this document,
          // this tab does NOT open it. A plain reload re-claims normally (the lock follows the page,
          // and claimDocLock retries past the unload race), so this only ever fires for a genuinely
          // concurrent second tab.
          const mine = await claimDocLock(storedId)
          if (mine) claimedId = storedId
          if (cancelled) { if (mine) releaseDocLock(storedId); return }
          if (!mine) {
            // WHO GETS THE BLOCKED SCREEN. Only an EXPLICIT request for this document — a `?doc=`
            // link/bookmark, or this tab's own remembered identity — earns the choose-how screen: the
            // writer meant THIS document, so silently opening a different one would be the wrong-doc
            // switch this whole mechanism exists to stop. A brand-new tab that merely inherited the
            // origin-wide last-doc hint had no opinion about this file, so it falls through to open
            // the next document no live tab holds (never block a fresh tab on a doc it didn't choose).
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
        // ⚠ NOT FOR A BRAND-NEW TAB (2026-08-28, Peter: "when I open a new tab it always keeps
        // reverting to this one thing Honours Proposal … what we need is for new tabs to open as
        // blank"). This walk is what actually did the reverting — removing the last-document hint
        // was necessary and not sufficient, because a tab with no identity fell through to here and
        // opened the most recent free document, which is the same document every time.
        //
        // The walk is still right for the case it was written for: a tab that HAD an identity and
        // found that document gone (deleted, or never synced to this device) should land on the
        // writer's next-most-recent work rather than a blank page. That is a recovery, and a
        // recovery should try. A fresh tab is not recovering from anything — it has no opinion about
        // any document, and answering it with someone's thesis is a guess that collides with
        // whichever tab already has it open.
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
        // A READ FAILED. We do NOT know that the writer has no work — we know the opposite is
        // possible, and their document may be sitting on disk perfectly intact. So:
        //   · never mint a document (a blank page IS the bug: it tells them, wordlessly, that their
        //     thesis is gone),
        //   · never touch the active-doc pointer (repointing it at a blank is how the real one gets
        //     lost from view),
        //   · say so, and put the recovery surface one click away.
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

  // The persistent shell (see shellUp above) is the SHARED empty-editor facsimile — the same Scroll
  // chrome + an empty .ProseMirror the live editor uses — so the prerendered landing page (doc=null,
  // shellUp=true → shell only) is a direct CSS function of the editor, and the editor reveals under
  // it with no visual jump.
  // key={doc.id} → switching documents in place cleanly remounts the editor (sessions, snapshots,
  // sync reconnect all re-run for the new doc). No Suspense here — the shell on top provides the
  // loading visuals, and the editor must mount in a default-lane render (see the double-mount
  // note at the top of the file).
  // A READ FAILED. The writer's document may be perfectly intact on disk — we simply could not get
  // at it this time. The one thing we must not do is show a blank page and let them conclude their
  // work is gone (that conclusion is what sent Peter to a backup file, which then overwrote the
  // real thing). Say what happened, offer the retry that usually works, and put Storage — the
  // recovery surface that can SEE and export every document on the device — right here rather than
  // buried in a menu they have no reason to trust right now.
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
        <Scroll phone={shellPhone} fill revealed={false} fadingOut={shellUp === 'fading'}>
          <EmptyEditorSurface />
        </Scroll>
      )}
      {surrendered && <SurrenderedBanner onReload={() => window.location.reload()} />}
    </>
  )
}
