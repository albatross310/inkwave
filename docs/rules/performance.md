<!-- Area rules. CLAUDE.md routes here; it does not repeat this. Narrative + measurements: docs/archive/. -->

## Performance — keep startup and typing fast

Ablation matrices and numbers: `docs/archive/editor-surface.md`, `docs/archive/pagination-rounds.md`.

- **Nothing that reads/parses/encodes the whole `.studio`, or hits the network per-snapshot, may run
  synchronously on load.** Stamp on creation, sweep on demand, cache encodes, read metadata not bodies.
- **Do NOT mount auth for the free tier** — `authEnabled()` needs an explicit sticky opt-in (`?auth`;
  `?auth=off` clears) and `entry.client` mounts `ClerkProvider` only then.
- **The OTS sweep runs only when the ReceiptPanel OPENS** (`onOpened` → `runOtsSweep`), only if
  something is unstamped/pending, throttled once per 15 min.
- **Heartbeats read METADATA, never content** (`readLocalHeartbeat` compares `lastModified`;
  `readRemoteHeartbeat` uses a Graph metadata GET).
- **`blobToBase64` uses native `FileReader.readAsDataURL`** + a per-PDF cache keyed by `pdfVersion`.
- **The grow-only write-back merge runs once per session per target**
  (`needsWritebackMerge`/`markWritebackMerged`).
- **`shouldRerenderOnTransaction: false` on `useEditor` must stay.** So the render body must NEVER
  read `editor.state`/`editor.isActive` — mirror what it needs into React state from an editor-event
  subscription. StyleBar force-updates only while `barVisible`; ReviewBar/CommentNotes self-subscribe.
- **The editor mounts ONCE per load** — Edit.tsx holds the eagerly-imported module in STATE. Do NOT
  reintroduce `React.lazy`/Suspense around the editor.
- **Keydown-synchronous typing** (`editorProps.handleKeyDown`, flag `inkwave:kdSync`, unset = ON for
  non-touch, OFF on touch — never intercept the virtual keyboard/autocorrect). Guards: no modifiers,
  no composition, no open word-cycle, TextSelection only.
- **SCAS scans ride the per-paragraph WeakMap cache** (`scas/controller.ts scanCommitted`): the
  cursor's paragraph is never cached and full-scan SEMANTICS are preserved. Don't undo the cache.
- **All citation doc-walks go through the memoised per-doc citation index** (`citationNav.ts`
  `citationNodes`); node-view rebuilds must NOT call `editor.getJSON()` — use
  `referenceListKeysFromDoc(editor.state.doc)`.
- **Word count runs ONLY while the ◈ panel is open**, both platforms.
- **Zoom step-cache precompute waits for GENUINE idle** — held while any input (1.5s) or reveal-chain
  event (3s) is recent. A cold cache stays correct; `onZoomStep` measures a miss live.
- **Known residual (next target):** with SCAS decorations on, steady-state keystroke cost is dominated
  by ProseMirror DecorationSet mapping/redraw, O(decorated words) per transaction. The fix is
  viewport-windowed decoration RENDERING — verdict state stays doc-wide, only visible ranges get
  Decoration objects.

