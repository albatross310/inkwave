import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
import { readDocument, saveDocument, emptyTiptapDoc, flushPendingSave, listOpfsDocumentsStrict, StorageReadError } from '../storage/opfs'
import { listMeta, upsertMeta } from '../storage/indexeddb'
import { withScasDefaults } from '../scas/defaults'
import { resolveTabDocId, claimTabDoc, claimDocLock, releaseDocLock, switchTabToDocument, isExplicitDocIntent, isBlankUntitledDocument } from '../storage/tabDoc'
import { installHolder, requestSwitch, takeOverHere } from '../storage/singleOpen'
import { StorageUnavailable } from '../components/StorageUnavailable'
import { DocumentOpenElsewhere, SurrenderedBanner } from '../components/DocumentOpenElsewhere'
import { duplicateEmailAsNew } from '../email/duplicateEmail'
import { setOpenDocListenerReady, waitForStudioFileLaunch, STUDIO_FILE_ACTION_PARAM } from '../pwa/fileLaunch'
import { LoadingTip } from '../components/LoadingTip'
import { currentDocIds } from '../storage/currentDocs'
import type { MailboxDraft } from '../email/mailbox'
import { WorkspaceNavigation } from '../components/WorkspaceNavigation'
import { pushWorkspacePanelHistory, replaceWorkspacePanelHistory } from '../workspace/history'
import { runWorkspacePanelTransition } from '../workspace/transition'
import { capturePaintedWorkspacePreview } from '../workspace/paintedPreview'
import { captureWorkspaceViewState } from '../workspace/viewState'
import { carryWorkspaceWaterMotion } from '../workspace/waterMotion'
import {
  activateWorkspaceItem,
  openLeftOfActive,
  readWorkspaceSequence,
  workspaceNeighbourId,
  writeWorkspaceSequence,
  type WorkspaceDirection,
  type WorkspaceSequence,
} from '../workspace/sequence'

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
  // W3 local spatial sequence. It contains only ordinary document ids and lives per tab; exactly
  // one id below is ever mounted as a live editor. Immediate neighbours are inert previews.
  const [workspace, setWorkspace] = useState<WorkspaceSequence | null>(null)
  const workspaceRef = useRef<WorkspaceSequence | null>(null)
  const [workspaceNeighbours, setWorkspaceNeighbours] = useState<{
    left: InkwaveDocument | null
    right: InkwaveDocument | null
  }>({ left: null, right: null })
  const [autoRevealDocumentId, setAutoRevealDocumentId] = useState<string | null>(null)
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
  // The loading tip shares the water's first-paint gate, but has its own END boundary: it vanishes
  // exactly when the page starts revealing. On phone the opaque water shell deliberately remains
  // through the coast, so tying the tip to shell unmount would leave it sitting over the page.
  const [tipUp, setTipUp] = useState(true)
  const [loadReady, setLoadReady] = useState(false)
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
      setTipUp(false)
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
    const onWatchdog = () => { setTipUp(false); setShellUp('down') }
    const onReady = () => setLoadReady(true)
    // PER-LOAD RESET (2026-07-11, the OPEN-DOC white-out): these closure vars live for the
    // component's whole life, but they describe ONE load — stale reveal/rest state (or a live
    // timer) from the previous load must never act on the next one's covering shell. Every open
    // starts a fresh choreography.
    const onBegin = () => {
      setTipUp(true)
      setLoadReady(false)
      revealedAt = 0
      restSeen = false
      clearTimeout(t2)
    }
    window.addEventListener('inkwave:open-begin', onBegin)
    window.addEventListener('inkwave:editor-load-ready', onReady)
    window.addEventListener('inkwave:editor-revealed', onRevealed)
    window.addEventListener('inkwave:wave-rest', onRest)
    window.addEventListener('inkwave:load-watchdog', onWatchdog)
    // ASK as well as subscribe. The editor graph loads independently and HMR/busy commits can
    // announce readiness before this parent effect is listening; a one-shot event alone would
    // strand the loading screen forever.
    if ((window as unknown as { __iwEditorLoadReady?: boolean }).__iwEditorLoadReady) onReady()
    return () => {
      clearTimeout(t2)
      window.removeEventListener('inkwave:open-begin', onBegin)
      window.removeEventListener('inkwave:editor-load-ready', onReady)
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
        // An installed desktop PWA can be launched by double-clicking a `.studio` file. The OS
        // navigates to this one-shot action URL while LaunchQueue delivers the actual file on a
        // separate clock. Do not open Recent (or mint a blank) underneath it: wait briefly for the
        // launch coordinator, then let the ordinary open-doc event own the first document.
        const launchUrl = new URL(window.location.href)
        const expectsStudioFile = launchUrl.searchParams.get(STUDIO_FILE_ACTION_PARAM) === '1'
        if (expectsStudioFile) {
          // Keep the marker through the await. In development StrictMode cleans up and remounts
          // this effect; consuming it before yielding let invocation two miss the OS intent and
          // open a blank over the imported file. Only the live invocation consumes the marker.
          const launched = await waitForStudioFileLaunch()
          if (cancelled) return
          launchUrl.searchParams.delete(STUDIO_FILE_ACTION_PARAM)
          window.history.replaceState(window.history.state, '', launchUrl.toString())
          if (launched) return
        }
        // "New blank" is an explicit new-window intent. `noopener` gives it no session identity,
        // and this flag tells it not to walk Current docs before minting its blank document.
        const forceFresh = new URL(window.location.href).searchParams.get('blank') === '1'
        if (forceFresh) {
          // React StrictMode replays this startup effect. Yield BEFORE consuming the one-shot URL
          // or minting an id, so the discarded invocation reaches its cleanup and cancels here.
          // Without this boundary pass one minted blank A, removed `blank=1`, then pass two found
          // A's session identity before A had saved any bytes and minted blank B as well.
          await Promise.resolve()
          if (cancelled) return
          // Consume the one-shot intent before claimTabDoc reflects the new id. Leaving `blank=1`
          // in the address would mint another blank on every refresh of this same window.
          const cleanUrl = new URL(window.location.href)
          cleanUrl.searchParams.delete('blank')
          window.history.replaceState(window.history.state, '', cleanUrl.toString())
          openFresh()
          return
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

        // 2. Open the most recently updated document that no live window holds. This is one
        // lock-aware N-window rule, not special cases for the first/second/third launch: listMeta()
        // is newest-first, a zero-wait claim skips each live holder, and the first available OPFS
        // document wins. A tab identity/explicit URL was already honoured in step 1, so this walk
        // is only the sensible default for a genuinely fresh window or recovery from an absent id.
        // Peter, 2026-09-06: first window resumes recent work; each additional window resumes the
        // next-most-recent unheld document; only an exhausted list opens blank.
        let sawReadFailure = false
        const tryCandidates = async (
          ids: string[],
          diskById: Map<string, InkwaveDocument> = new Map(),
        ): Promise<boolean> => {
          for (const id of currentDocIds(ids)) {
            if (cancelled) return true
            // This candidate was not explicitly requested, so do not pay the reload-race grace
            // period for it: if another window holds it now, immediately consider the next one.
            if (!(await claimDocLock(id, 0))) continue
            claimedId = id
            if (cancelled) { releaseDocLock(id); claimedId = null; return true }
            // One unreadable document must not end the search — the NEXT one may be perfectly
            // readable, and opening the writer's real work beats any error screen. But remember
            // the failure: it forbids the later inference that this writer has no documents.
            const diskDoc = diskById.get(id)
            const r = diskDoc ? { kind: 'found' as const, doc: diskDoc } : await readDocument(id)
            if (cancelled) { releaseDocLock(id); claimedId = null; return true }
            if (r.kind === 'error') {
              sawReadFailure = true
              console.error('[inkwave] init: could not read an indexed document:', id, r.error)
              releaseDocLock(id)
              claimedId = null
              continue
            }
            if (r.kind === 'found') {
              await upsertMeta({ id: r.doc.id, title: r.doc.title, updatedAt: r.doc.updatedAt })
              claimTabDoc(r.doc.id)
              claimedId = null // committed
              setDoc(migrateDocument(r.doc))
              return true
            }
            releaseDocLock(id) // indexed but not in OPFS — don't sit on a claim we can't use
            claimedId = null
          }
          return false
        }

        // FAST PATH: IndexedDB is a tiny newest-first metadata index. Read only the first available
        // document instead of serially reading + JSON-parsing EVERY OPFS document before opening
        // any of them (especially costly in Safari standalone windows with no session identity).
        const metas = await listMeta()
        if (await tryCandidates(metas.map((meta) => meta.id))) return

        // RECOVERY FALLBACK ONLY: the direct scan catches orphaned documents whose metadata index
        // was lost. This call is strict because a failed OPFS root read is UNKNOWN, never "empty".
        const onDisk = await listOpfsDocumentsStrict()
        if (onDisk.some((entry) => !entry.doc)) sawReadFailure = true
        onDisk.sort((a, b) => {
          const at = a.doc?.updatedAt ? Date.parse(a.doc.updatedAt) || a.lastModified : a.lastModified
          const bt = b.doc?.updatedAt ? Date.parse(b.doc.updatedAt) || b.lastModified : b.lastModified
          return bt - at
        })
        const diskById = new Map(onDisk.filter((entry) => entry.doc).map((entry) => [entry.id, entry.doc!]))
        if (await tryCandidates(onDisk.map((entry) => entry.id), diskById)) return

        // 3. Create a fresh document. REACHABLE ONLY FROM ABSENCE — every step above either opened
        //    a document or established that every readable document is currently held/absent.
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

  const commitWorkspace = useCallback((next: WorkspaceSequence) => {
    workspaceRef.current = next
    writeWorkspaceSequence(next)
    setWorkspace(next)
  }, [])

  // Bootstrap/repair the per-tab sequence after the storage loader establishes the active ordinary
  // document. This runs on id changes only; typing never rewrites presentation state.
  useEffect(() => {
    if (!doc?.id) return
    const current = workspaceRef.current ?? readWorkspaceSequence(doc.id)
    commitWorkspace(activateWorkspaceItem(current, doc.id))
  }, [doc?.id, commitWorkspace])

  // The URL remains a reflection, not document identity. Marking the current browser entry gives
  // Back/Forward a panel target without a reload; successful in-place switches push the next entry.
  useEffect(() => {
    if (doc?.id) replaceWorkspacePanelHistory(doc.id)
  }, [doc?.id])

  useEffect(() => {
    if (!workspace || !doc) { setWorkspaceNeighbours({ left: null, right: null }); return }
    let cancelled = false
    const readNeighbour = async (direction: WorkspaceDirection): Promise<InkwaveDocument | null> => {
      const id = workspaceNeighbourId(workspace, direction)
      if (!id) return null
      const result = await readDocument(id)
      if (result.kind === 'found') return migrateDocument(result.doc)
      if (result.kind === 'error') console.error('[inkwave] workspace: could not read neighbour', id, result.error)
      return null
    }
    void Promise.all([readNeighbour(-1), readNeighbour(1)]).then(([left, right]) => {
      if (!cancelled) setWorkspaceNeighbours({ left, right })
    })
    return () => { cancelled = true }
  }, [workspace, doc?.id])

  /**
   * Transfer the one live-editor/write-lock ownership without reloading. The outgoing debounce is
   * flushed before the target is claimed; a failed save/read/claim leaves the current panel alive.
   */
  const openWorkspaceDocument = useCallback(async (
    target: InkwaveDocument,
    placement: 'left-of-active' | 'existing' = 'left-of-active',
    historyMode: 'push' | 'traverse' = 'push',
    transitionMode: 'snapshot' | 'interactive-preview' = 'snapshot',
  ) => {
    const outgoing = doc
    if (!outgoing || target.id === outgoing.id) return
    try {
      await flushPendingSave()
      const claimed = await claimDocLock(target.id, 0)
      if (!claimed) throw new Error(`“${target.title || 'This document'}” is already open in another Inkwave window.`)

      const current = workspaceRef.current ?? readWorkspaceSequence(outgoing.id)
      const next = placement === 'existing'
        ? activateWorkspaceItem(current, target.id)
        : openLeftOfActive(current, target.id)
      const outgoingIndex = next.order.indexOf(outgoing.id)
      const targetIndex = next.order.indexOf(target.id)
      const transitionDirection: WorkspaceDirection = targetIndex < outgoingIndex ? -1 : 1

      // The target lock is already held. Release the outgoing owner only after its save completed,
      // then reflect the new owner in the tab identity/URL and remount exactly one editor.
      if (historyMode === 'push') pushWorkspacePanelHistory(outgoing.id, target.id)
      releaseDocLock(outgoing.id)
      claimTabDoc(target.id)
      const visible = new Promise<void>((resolve) => {
        let timer = 0
        const onRevealed = (event: Event) => {
          if ((event as CustomEvent<{ id?: string }>).detail?.id !== target.id) return
          window.removeEventListener('inkwave:workspace-view-ready', onRevealed)
          clearTimeout(timer)
          resolve()
        }
        window.addEventListener('inkwave:workspace-view-ready', onRevealed)
        // A broken reveal must not hold the input latch forever. The editor's own ready cap is
        // 1.2s, so 4s is a genuine backstop rather than the normal path.
        timer = window.setTimeout(() => {
          window.removeEventListener('inkwave:workspace-view-ready', onRevealed)
          resolve()
        }, 4000)
      })
      const swapEditor = async () => {
        commitWorkspace(next)
        setSurrendered(false)
        setAutoRevealDocumentId(target.id)
        setDoc(migrateDocument(target))
        await visible
        // `inkwave:editor-revealed` is dispatched in the same task as setSettled(true). Give React
        // that task boundary so the no-fade opacity:1 replacement is committed before capture.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      // WorkspaceNavigation does not exist until a sequence has two items. Capture the outgoing
      // first page here so the very first newly-created email/document already has an exact panel
      // waiting beside it. During an interactive swipe the moving box is rejected by the cache.
      captureWorkspaceViewState(outgoing.id)
      carryWorkspaceWaterMotion()
      capturePaintedWorkspacePreview(outgoing.id, outgoing.updatedAt)
      if (transitionMode === 'interactive-preview') await swapEditor()
      else await runWorkspacePanelTransition(transitionDirection, swapEditor)
    } catch (error) {
      alert(`The panel could not be opened, so Inkwave kept you here.\n\n${error instanceof Error ? error.message : String(error)}`)
    }
  }, [doc, commitWorkspace])

  const openWorkspaceDocumentId = useCallback(async (
    id: string,
    historyMode: 'push' | 'traverse' = 'push',
    transitionMode: 'snapshot' | 'interactive-preview' = 'snapshot',
  ) => {
    if (id === doc?.id) return
    const result = await readDocument(id)
    if (result.kind === 'error') {
      alert(`The panel could not be read, so Inkwave kept you here.\n\n${result.error.message}`)
      return
    }
    if (result.kind === 'absent') {
      alert('That panel is no longer present on this device. Inkwave kept the current document open.')
      return
    }
    const existing = workspaceRef.current?.order.includes(id) ?? false
    await openWorkspaceDocument(
      migrateDocument(result.doc),
      existing ? 'existing' : 'left-of-active',
      historyMode,
      transitionMode,
    )
  }, [doc?.id, openWorkspaceDocument])

  const navigateWorkspace = useCallback(async (
    direction: WorkspaceDirection,
    options?: { interactive?: boolean },
  ) => {
    const sequence = workspaceRef.current
    if (!sequence) return
    const id = workspaceNeighbourId(sequence, direction)
    if (id) await openWorkspaceDocumentId(
      id,
      'push',
      options?.interactive ? 'interactive-preview' : 'snapshot',
    )
  }, [openWorkspaceDocumentId])

  const navigateWorkspaceHistory = useCallback(async (id: string) => {
    await openWorkspaceDocumentId(id, 'traverse')
  }, [openWorkspaceDocumentId])

  async function handleDuplicateEmail(source: InkwaveDocument) {
    // The source must exist durably before a derivative does. `source` is rebuilt from the live
    // EditorView by the caller; flushing first resolves any older queued thunk, then the explicit
    // save covers the no-pending case. A failed source write creates no copy and switches nowhere.
    await flushPendingSave()
    await saveDocument(source)
    await upsertMeta({ id: source.id, title: source.title, updatedAt: source.updatedAt })

    const duplicate = duplicateEmailAsNew(source)
    await saveDocument(duplicate)
    await upsertMeta({ id: duplicate.id, title: duplicate.title, updatedAt: duplicate.updatedAt })
    await openWorkspaceDocument(duplicate)
  }

  async function handleOpenGmailDraft(
    draft: MailboxDraft<'gmail'>,
    context: { accountEmail: string; historyId: string },
  ) {
    // Preserve the document being left before materialising remote content. Browsing alone never
    // calls this boundary; only “Edit in Inkwave” creates a document and therefore a ledger owner.
    await flushPendingSave()
    const [{ importGmailDraftDocument }, { writeGmailDraftBinding }] = await Promise.all([
      import('../email/gmailDraftDocument'),
      import('../email/gmailDraftBinding'),
    ])
    const imported = await importGmailDraftDocument({ remote: draft, ...context })
    await saveDocument(imported.document)
    await upsertMeta({
      id: imported.document.id,
      title: imported.document.title,
      updatedAt: imported.document.updatedAt,
    })
    await writeGmailDraftBinding(imported.binding)
    await openWorkspaceDocument(imported.document)
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
      setAutoRevealDocumentId(null)
      setShellUp('up') // waves-only for the whole load; fades again at the new doc's reveal
      ;(window as unknown as { __iwEditorLoadReady?: boolean }).__iwEditorLoadReady = false
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
    setOpenDocListenerReady(true)
    return () => {
      setOpenDocListenerReady(false)
      window.removeEventListener('inkwave:open-doc', onOpen as EventListener)
    }
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
        <EditorComp
          key={doc.id}
          doc={doc}
          onDocChange={handleDocChange}
          onDuplicateEmail={handleDuplicateEmail}
          onOpenGmailDraft={handleOpenGmailDraft}
          onOpenWorkspaceDocument={openWorkspaceDocument}
          onOpenWorkspaceDocumentId={openWorkspaceDocumentId}
          autoReveal={autoRevealDocumentId === doc.id}
        />
      )}
      {doc && workspace && workspace.order.length > 1 && (
        <WorkspaceNavigation
          activeId={workspace.activeId}
          activeVersion={doc.updatedAt}
          left={workspaceNeighbours.left}
          right={workspaceNeighbours.right}
          onNavigate={navigateWorkspace}
          onNavigateTo={navigateWorkspaceHistory}
        />
      )}
      {shellUp !== 'down' && (
        <>
          <Scroll phone={shellPhone} fill revealed={false} loadingTwinkles={tipUp}>
            <EmptyEditorSurface />
          </Scroll>
          {tipUp && (
            <LoadingTip
              ready={loadReady}
              onContinue={() => window.dispatchEvent(new Event('inkwave:continue-load'))}
            />
          )}
        </>
      )}
      {surrendered && <SurrenderedBanner onReload={() => window.location.reload()} />}
    </>
  )
}
