#!/usr/bin/env bash
# MUTATION PROOF for the cloud write-back guard.
#
# A green suite is not a guard. Each mutant below breaks ONE line this lane claims is load-bearing;
# a mutant that SURVIVES is a line no test can see, and it gets reported as one rather than quietly
# dropped. Restores the tree after every run.
set -uo pipefail
cd "$(dirname "$0")/.."

SUITE="src/storage/cloudWriteback.test.ts src/storage/cloudLocalRead.test.ts src/storage/archiveWriteback.test.ts src/storage/folder.test.ts src/provenance/archiveReadFail.test.ts"

run_mutant() { # name file 'python replace expr'
  local name="$1" file="$2" py="$3"
  cp "$file" /tmp/mut.bak
  python3 - "$file" <<PY
import sys
p=sys.argv[1]; s=open(p).read()
$py
open(p,'w').write(s)
PY
  local out; out=$(npx vitest run $SUITE 2>&1 | grep -E '^\s+(Tests|Test Files)\s')
  local failed; failed=$(echo "$out" | grep -oE '[0-9]+ failed' | head -1)
  if [ -n "$failed" ]; then echo "  DIED   ($failed)  ← $name"
  else echo "  SURVIVED          ← $name   *** REPORT THIS ***"; fi
  cp /tmp/mut.bak "$file"
}

echo "=== THE RULE (planWriteback) ==="
run_mutant "M1 planWriteback: an 'error' writes local anyway (the 2026-07-15 collapse)" \
  src/storage/archiveWriteback.ts \
  "old=\"\"\"  if (read.status === 'error') {
    return { write: false, reason: \`archive unreadable (\${read.reason}) — not writing (local is safe)\` }
  }\"\"\"
assert old in s; s=s.replace(old,'')"

run_mutant "M2 THE OUTAGE MUTANT — planWriteback refuses a genuine 'absent' (guard clamped shut)" \
  src/storage/archiveWriteback.ts \
  "old=\"  if (read.status === 'absent') {\n    return { write: true, snapshots: local }\n  }\"
new=\"  if (read.status === 'absent') {\n    return { write: false, reason: 'absent' }\n  }\"
assert old in s; s=s.replace(old,new)"

echo "=== THE PROVIDER FAULT MAPPING ==="
run_mutant "M3 mapGraphReadStatus: everything-not-2xx ⇒ absent (a failure in an absence's clothes)" \
  src/storage/onedrive.ts \
  "old=\"  if (status === 404) return 'absent'\n  if (status >= 200 && status < 300) return 'ok'\n  return 'error'\"
new=\"  if (status >= 200 && status < 300) return 'ok'\n  return 'absent'\"
assert old in s; s=s.replace(old,new)"

run_mutant "M4 THE OUTAGE MUTANT — readRemoteArchive: a 0-byte body is a parse ERROR, not an absence" \
  src/storage/onedrive.ts \
  "old=\"    if (!text.trim()) return { status: 'absent' }\"
assert old in s; s=s.replace(old,'',1)"

run_mutant "M5 readDriveArchive: a 500 reads as absent" \
  src/storage/gdrive.ts \
  "old=\"    if (!res.ok) return { status: 'error', reason: \`Drive GET \${res.status}\` }\"
new=\"    if (!res.ok) return { status: 'absent' }\"
assert old in s; s=s.replace(old,new)"

echo "=== THE SHAPE PREDICATE (this lane's finding #2) ==="
run_mutant "M6 archiveSnapshotsOf: a non-record parses as an empty archive (the pre-fix line)" \
  src/storage/archiveWriteback.ts \
  "old=\"  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null\"
new=\"  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []\"
assert old in s; s=s.replace(old,new)"

run_mutant "M7 archiveSnapshotsOf: drop the non-array check (?? [] passes a string through)" \
  src/storage/archiveWriteback.ts \
  "old=\"  if (!Array.isArray(snaps)) return null\"
assert old in s; s=s.replace(old,'')"

run_mutant "M8 THE OUTAGE MUTANT — archiveSnapshotsOf: an absent snapshots field is a refusal" \
  src/storage/archiveWriteback.ts \
  "old=\"  if (snaps === undefined || snaps === null) return [] // a record with no history — established, safe\"
new=\"  if (snaps === undefined || snaps === null) return null\"
assert old in s; s=s.replace(old,new)"

echo "=== THE MERGE GATE (this lane's finding #1 — the live bug) ==="
run_mutant "M9 preMergeGDrive: close the gate on a failed read (auditor B's bug, restored verbatim)" \
  src/storage/gdrive.ts \
  "old=\"    console.info(\`[inkwave] Drive warm merge skipped: \${read.reason} — the next sync retries the read\`)\n    return // THE LOAD-BEARING LINE: we established nothing, so the gate MUST stay open.\"
new=\"    markWritebackMerged(key); return\"
assert old in s; s=s.replace(old,new)"

run_mutant "M10 preMergeRemote: close the gate on a failed read" \
  src/storage/onedrive.ts \
  "old=\"    console.info(\`[inkwave] OneDrive warm merge skipped: \${read.reason} — the next sync retries the read\`)\n    return // THE LOAD-BEARING LINE: we established nothing, so the gate MUST stay open.\"
new=\"    markWritebackMerged(key); return\"
assert old in s; s=s.replace(old,new)"

run_mutant "M11 THE OUTAGE MUTANT — preMergeGDrive never closes the gate (a re-download every sync)" \
  src/storage/gdrive.ts \
  "old=\"  markWritebackMerged(key) // 'absent' or a merged 'ok' — both are facts we established.\"
assert old in s; s=s.replace(old,'')"

# M12 WAS AN EQUIVALENT MUTANT AND IS RECORDED AS ONE, not deleted. It swapped
#   `merged = plan.snapshots` with `markWritebackMerged(key)` — two independent statements that are
#   BOTH reached only after `if (!plan.write) return`. Reordering them cannot change behaviour, so
#   its survival said nothing about the tests. A mutant that cannot fail is not evidence; the real
#   ordering hazard is closing the gate BEFORE the refusal is checked, which is M12b.
run_mutant "M12b syncToOneDrive: close the merge gate BEFORE the plan's refusal is honoured" \
  src/storage/onedrive.ts \
  "old=\"  if (needsWritebackMerge(key)) {\n    const plan = planWriteback(await readRemoteArchive(token, studioName), snapshots)\"
new=\"  if (needsWritebackMerge(key)) {\n    markWritebackMerged(key)\n    const plan = planWriteback(await readRemoteArchive(token, studioName), snapshots)\"
assert old in s; s=s.replace(old,new)"

run_mutant "M12c syncToGoogleDrive: close the merge gate BEFORE the plan's refusal is honoured" \
  src/storage/gdrive.ts \
  "old=\"  if (fileId && needsWritebackMerge(key)) {\n    const plan = planWriteback(await readDriveArchive(fileId), snapshots)\"
new=\"  if (fileId && needsWritebackMerge(key)) {\n    markWritebackMerged(key)\n    const plan = planWriteback(await readDriveArchive(fileId), snapshots)\"
assert old in s; s=s.replace(old,new)"

echo "=== THE POST-SYNC HEAL (this lane's finding #3) ==="
run_mutant "M14 syncToOneDrive: \`void\` the heal again (an unhandled rejection escapes)" \
  src/storage/onedrive.ts \
  "i=s.index('    if (merged.length > snapshots.length) {')
j=s.index('    }\n    return { ok: true, webUrl }')+6
s=s[:i]+'    if (merged.length > snapshots.length) void restoreSnapshotsFromBundle(doc.id, merged)\n'+s[j:]"

echo "=== THE LOCAL READ (the claim under test: is the TiptapEditor guard load-bearing?) ==="
run_mutant "M13 readSnapshotsFromDisk: catch ⇒ return [] (the archive read's own collapse)" \
  src/provenance/snapshots.ts \
  "old=\"    if (legacy) return [] // ← the bug, on demand: a corrupt gzip / non-array parse answered \\\"no history\\\"\n    throw new StorageReadError(path, err)\"
new=\"    return []\"
assert old in s; s=s.replace(old,new)"
