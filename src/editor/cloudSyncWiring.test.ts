// THE EDITOR'S HALF OF THE CLOUD-SYNC SEAM — ~5ms, no browser.
//
// WHY THIS FILE EXISTS. "Cloud sync and writer-held files" is ONE mechanism in TWO files: the state,
// the mirrors, the throttle and the heartbeat live in `useCloudSync.ts`; the sync pill, the pickers,
// the ⋮ menu entries, the other-device banner and the four provenance checkpoints that CALL the
// mirror are in `TiptapEditor.tsx`. A hook can be green in its own harness while the real editor
// quietly stops calling `mirrorIfActive()` after a snapshot — and the writer's OneDrive copy would
// simply fall behind, silently, with every unit test green. This pins the editor's side: the wiring
// the hook's own tests cannot see.
//
// WRITTEN BEFORE THE MOVE (2026-09-15), against the unmoved TiptapEditor.tsx, and every assertion
// held there first (12/12). It stays pointed at TiptapEditor.tsx afterwards because none of this
// text moved — only the state, the actions and the six effects did.
//
// ⚠ COMMENTS ARE STRIPPED BEFORE SCANNING. The comments beside these lines NAME the identifiers
// ("mirrorIfActive() keeps it updated as you write"), so a raw-text scan would pass on prose alone.
// Judge what the code DOES.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const CODE = strip(readFileSync(resolve(__dirname, 'TiptapEditor.tsx'), 'utf8'))
// SEAM 3 (2026-09-16): save orchestration left for useSaveOrchestration.ts and took two things this
// file pins with it — `ensureDocFresh` (the coupling) and `saveRecord` (the dispatch) — plus the
// manual snapshot's mirror call. Measured FIRST: with them moved and this file un-re-pointed, three
// tests went red (the mirror count, the ensureDocFresh body, saveRecord), so the re-point is proved
// to bite. What remains in TiptapEditor.tsx is a hoisted one-line delegate of the same name, which
// is exactly why the body must be located in the HOOK, not by name in the editor.
const SAVE = strip(readFileSync(resolve(__dirname, 'useSaveOrchestration.ts'), 'utf8'))

describe('the editor wires the cloud-sync hook', () => {
  // VOID GUARD. Every assertion below is about a file located by path and stripped. If the strip ate
  // the file or the path moved, "contains X" would be false for the wrong reason — but "does not
  // contain Y" would be TRUE and meaningless. Pin that the scan is looking at the editor.
  it('the scan found the editor', () => {
    expect(CODE.length).toBeGreaterThan(50_000)
    expect(CODE).toContain('<SyncStatus compact={isTouch}')
    expect(CODE).toContain('mirrorIfActive')
  })

  // THE FOUR PROVENANCE CHECKPOINTS. A mirror happens only when something worth mirroring has been
  // recorded: the paragraph snapshot, the word-nudge snapshot, the manual "save version", and the
  // signing period's receipt. Each calls `mirrorIfActive()` — a call, not the definition (the
  // lookbehind excludes `function mirrorIfActive()`), and exactly four of them.
  it('exactly four call sites mirror: three after a stamped snapshot, one after the signed period', () => {
    // Since seam 3 the manual "save version" lives in the save hook; the other three are still here.
    const calls = [...CODE.matchAll(/(?<!function )\bmirrorIfActive\(\)/g)]
    expect(calls.length).toBe(3)
    const hookCalls = [...SAVE.matchAll(/\bmirrorIfActive\(\)/g)]
    expect(hookCalls.length).toBe(1)
    // Three follow `stampSnapshot(...)` + the metadata patch (two here, one in the hook); the fourth
    // follows the period commit.
    const stampThenMirror = /stampSnapshot\(snap\.documentId, snap\.id\)[^\n]*\n[^\n]*\n\s*mirrorIfActive\(\)/g
    expect([...CODE.matchAll(stampThenMirror)].length).toBe(2)
    expect([...SAVE.matchAll(stampThenMirror)].length).toBe(1)
    expect(CODE).toMatch(/scasReceipts: allReceipts,\s*\}\s*commitDoc\(updated\)\s*mirrorIfActive\(\)/)
  })

  // THE UNSYNCED NOTICE READS SYNC STATE — it never awaits it. Its "is any destination live?" input
  // is derived from exactly the four flags the hook reports, in this exact form: a linked local file
  // counts only while write permission holds; a OneDrive ACCOUNT (not a completed sync) counts; the
  // Drive flag counts. Widen or narrow this and the five-minute warning lies in one direction.
  it('syncActive is derived from the four hook flags, read not awaited', () => {
    expect(CODE).toContain('const syncActive = (!!fileName && !needsReconnect) || !!oneDriveAcct || gdriveActive')
    expect(CODE).toMatch(/<UnsyncedNotice\s+show=\{warnUnsynced\}/)
  })

  // THE COUPLING, PINNED. `ensureDocFresh` (save orchestration — in useSaveOrchestration.ts since
  // seam 3) marks a rebuilt document as not-yet-mirrored by clearing all three "last sync" times.
  // Drop one and that pill claims "Synced" over content it has never seen. The editor keeps a
  // one-line hoisted delegate of the same name for the cloud hook's input; the BODY is in the hook.
  it('ensureDocFresh clears all three last-sync times when it rebuilds the document', () => {
    const body = /function ensureDocFresh\(\): InkwaveDocument \{[\s\S]*?\n  \}/.exec(SAVE)?.[0] ?? ''
    expect(body, 'ensureDocFresh body not located in the save hook').not.toBe('')
    expect(body).toMatch(/setLastFileSave\(null\)\s*setLastSync\(null\)\s*setLastGdriveSync\(null\)/)
    // ...and the editor still hands the cloud hook a function of that name (the delegate).
    expect(CODE).toContain('function ensureDocFresh(): InkwaveDocument { return save.ensureDocFresh() }')
    expect(CODE).toContain('useCloudSync({ docRef, docId: doc.id, ensureDocFresh, snapshotsForAction, runWhenQuiet })')
  })

  // THE PILL'S BRANCHES. Chromium (File System Access) → the local folder pill in its three honest
  // states; otherwise Google Drive once connected; otherwise OneDrive (signed in / not); otherwise
  // nothing. The order is the rule: a Chromium writer never sees the cloud pill.
  it('the sync pill branches folder → Drive → OneDrive with the hook state and actions', () => {
    const pill = /const syncProps = isTouch[\s\S]*?\}\)\(\)\}/.exec(CODE)?.[0] ?? ''
    expect(pill, 'pill block not located').not.toBe('')
    const order = ['if (fileSaveAvailable())', 'if (needsReconnect)', 'onClick={() => void reconnectFolder()}',
      "label={lastFileSave ? 'Synced to folder' : 'Sync pending'}", 'onShowInFolder={showInFolder}', 'onChangeFolder={saveAsFile}',
      'onClick={() => void saveToFile()}', 'if (gdriveActive)', "label={lastGdriveSync ? 'Synced to Google Drive' : '▴ Sync pending'}",
      'webUrl={gdriveUrl}', 'if (!oneDriveConfigured()) return null', 'return oneDriveAcct ? (',
      "label={lastSync ? 'Synced to OneDrive' : '☁ Sync pending'}", 'path={oneDrivePath(doc)}', 'webUrl={oneDriveUrl}',
      'onChangeFolder={chooseOneDriveFolder}', 'onClick={lastSync ? undefined : syncOneDrive}', 'onClick={syncOneDrive}']
    let at = -1
    for (const s of order) {
      const i = pill.indexOf(s, at + 1)
      expect(i, `missing or out of order: ${s}`).toBeGreaterThan(at)
      at = i
    }
  })

  // The phone's ☁ toolbar button colours by the SAME precedence (folder → Drive → OneDrive).
  it('the phone ☁ button reads the same precedence', () => {
    expect(CODE).toContain("(fileSaveAvailable() ? !!lastFileSave && !needsReconnect : gdriveActive ? !!lastGdriveSync : !!lastSync) ? '#6b7280' : '#b45309'")
    expect(CODE).toContain('{isTouch && (fileSaveAvailable() || gdriveActive || oneDriveConfigured()) && (')
  })

  // The pickers and openers MOUNT on the hook's booleans and hand back to its callbacks.
  it('pickers and openers mount on hook state and call back into the hook', () => {
    expect(CODE).toMatch(/\{gdrivePickerOpen && \(\s*<GoogleDriveFolderPicker[\s\S]*?onRename=\{renameGdriveFileNow\}\s*onPick=\{onGdriveFolderPicked\}\s*onClose=\{\(\) => setGdrivePickerOpen\(false\)\}/)
    expect(CODE).toMatch(/\{gdriveOpenerOpen && \(\s*<GoogleDriveFileOpener onOpen=\{onGdriveFileOpen\} onClose=\{\(\) => setGdriveOpenerOpen\(false\)\}/)
    expect(CODE).toMatch(/\{odOpenerOpen && \(\s*<OneDriveFileOpener onOpen=\{onOneDriveFileOpen\} onClose=\{\(\) => setOdOpenerOpen\(false\)\}/)
    expect(CODE).toMatch(/\{folderPickerOpen && \(\s*<OneDriveFolderPicker[\s\S]*?onRename=\{renameOneDriveFileNow\}\s*onPick=\{onFolderPicked\} onClose=\{\(\) => setFolderPickerOpen\(false\)\}/)
  })

  // The ⋮ menu gets every cloud action, each gated on its provider being configured — an unconfigured
  // provider passes `undefined`, and the menu hides the entry.
  it('the ⋮ menu receives the cloud actions gated on configuration', () => {
    for (const p of [
      'onSave={saveRecord}', 'onSaveAs={fileSaveAvailable() ? saveAsFile : undefined}', 'folderName={fileName}',
      'onSyncOneDrive={oneDriveConfigured() ? syncOneDrive : undefined}', 'onChooseOneDriveFolder={chooseOneDriveFolder}',
      'onSaveAsOneDrive={oneDriveConfigured() ? saveAsOneDrive : undefined}', 'oneDriveAccount={oneDriveAcct}',
      'onSyncGoogleDrive={googleDriveConfigured() ? syncGoogleDrive : undefined}',
      'onSaveAsGoogleDrive={googleDriveConfigured() ? saveAsGoogleDrive : undefined}',
      'onChooseGoogleDriveFolder={googleDriveConfigured() ? chooseGoogleDriveFolder : undefined}',
      'onUploadGoogleDrive={googleDriveConfigured() ? uploadFromGoogleDrive : undefined}',
      'onUploadOneDrive={oneDriveConfigured() ? uploadFromOneDrive : undefined}', 'googleDriveActive={gdriveActive}',
    ]) expect(CODE, p).toContain(p)
  })

  // "Save" is one button with two honest behaviours: Chromium writes the linked file, everyone else
  // downloads the record. It dispatches; it does not re-implement either.
  it('saveRecord dispatches to saveToFile or exportBundle', () => {
    expect(SAVE).toMatch(/function saveRecord\(\) \{\s*if \(fileSaveAvailable\(\)\) void saveToFile\(\)\s*else exportBundle\(\)\s*\}/)
  })

  // The other-device banner shows on the heartbeat verdict and is dismissed through the hook's setter.
  it('the other-device banner reads otherDevice/conflictDismissed and dismisses through the hook', () => {
    expect(CODE).toContain('{otherDevice && !conflictDismissed && (')
    expect(CODE).toContain('onClick={() => setConflictDismissed(true)}')
  })

  // The tab title prefers the linked file's name, then the OneDrive file's, then the content title.
  it('the tab title reads fileName, then the OneDrive filename, then the title', () => {
    expect(CODE).toMatch(/const local = fileName\?\.replace\([^\n]*\n\s*const cloud = oneDriveFilename\(doc\.id\)\?\.replace\([^\n]*\n\s*const tabName = local \|\| cloud \|\| \(doc\.title/)
  })

  // The write funnel: nothing in the editor calls a cloud writer directly. Every `syncToOneDrive` /
  // `syncToGoogleDrive` / `writeBundleToFile` call goes through the hook — the editor has ZERO.
  // MEASURED on the unmoved file, not assumed: 10 (a first draft said 8 and failed on the original —
  // the corollary working). After the move the editor's own count is 0; any other number is a
  // second write path that does not read the archive through the hook's guard.
  it('the editor never calls a cloud writer outside the hook', () => {
    const direct = [...CODE.matchAll(/\b(syncToOneDrive|syncToGoogleDrive|writeBundleToFile)\(/g)].length
    expect([0, 10]).toContain(direct)
  })
})
