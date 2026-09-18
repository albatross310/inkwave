# Merged branches, recorded before deletion

A branch that is merged is already archived — its commits are permanently in
master's history and nothing is lost by deleting the ref. What IS lost is the
NAME, and with it the ability to ask "where did the compression-anim work go".
Four of the branches below were merged by direct push with no merge commit and
no PR, so this file was the only place their names could be kept.

Recover any of them:  `git checkout -b <name> <tip>`

| branch | tip | last commit | recorded elsewhere |
|---|---|---|---|
| `archive/pre-rewrite-history` | `57c8c4a53782c136bcc8e2021ff5612594f1e3f3` | 2026-08-21 | **nowhere — this file only** |
| `feat/bijection-fencepost` | `5868df1339e2185101507817483200c4fdb5b390` | 2026-07-10 | merge commit `7adecce4` |
| `feat/compression-anim` | `f48be9e0812a744407ff69344c8f9918195bad8b` | 2026-06-17 | **nowhere — this file only** |
| `feat/csp-nonce` | `8c4a6df4394da0f164b558cc509060f00e148c72` | 2026-06-17 | **nowhere — this file only** |
| `feat/followups` | `24e171d46bb5b636739897bb44227ed554d9fa0d` | 2026-07-08 | **nowhere — this file only** |
| `feat/native-citations` | `f93c85b50add99c78d15b0cfea0f9b6f24210551` | 2026-07-01 | **nowhere — this file only** |
| `feat/review` | `8ba6f02cef06a5ed4689058e3d064b57356084ce` | 2026-07-07 | merge commit `d383f0e5` |
| `fix/mac-ui-and-snapshot-links` | `57c8c4a53782c136bcc8e2021ff5612594f1e3f3` | 2026-08-21 | **nowhere — this file only** |
| `claude/commit-stamps` | `46a0e6fb143fa014b41bcd483592d473a33721a3` | 2026-09-18 | PR #29, merge commit `4a61a4d7` |
| `max/phone-menus` | `572f69288ecf4c5d233846a1249cf3331e1cb018` | 2026-09-18 | PR #24, merge commit `44700d5a` |

All ten verified with `git rev-list --count origin/<b> --not origin/master` = 0
at the time of writing, on a FULL clone. A shallow clone answers this question
wrongly and silently: it presents its cut as the root, so `git merge-base`
returns nothing for anything that forked earlier and a fully merged branch
reads as an unrelated history. Check `ls .git/shallow` before trusting it.

## Superseded, not merged — recorded 2026-09-18 by Nigel, on Peter's yes

These four are NOT reachable from master. `git rev-list --count origin/<b> --not origin/master` is
1, 1, 4 and 2 — not 0. What makes them safe to delete is a different test: `git cherry origin/master
origin/<b>` reports every commit as already applied by patch, or the branch's files are byte-for-byte
identical to master's, because the work landed rebased, squashed, or rewritten by a later
implementation. **The commits themselves exist on no other ref, so these tips are the only pointer to
them.** That is why the shas are here and why the row says what replaced the work.

Recover any of them:  `git checkout -b <name> <tip>`

| branch | tip | last commit | what replaced it |
|---|---|---|---|
| `fix/firefox-favicon` | `384a9f1c83fb9ac3488c6229fdab0e7b30e3b4ad` | 2026-07-08 | patch-identical in master (`git cherry` = `-`) |
| `claude/lane-seeds` | `3267f4748948c705d9e2b3d0d8ce351dbc3a83e3` | 2026-09-16 | patch-identical in master (`git cherry` = `-`) |
| `claude/seed-history` | `910b9235d4d79bee5b900fee48945449439c6953` | 2026-09-16 | landed as PR #16, `4e4e7f18`; `src/dev/seedDocument.ts` and its test are byte-identical to master's |
| `claude/lane-favicon` | `d355765f3edfc90ff1b40077bc6812b7d21c8a55` | 2026-09-16 | superseded by `c8a5f23`; its `laneIcon.mjs` covers lanes A–L, master's covers A–Z, and master's version of every file it touches is a strict superset |

⚠ All four read as **unrelated orphan histories** on the shallow clone a cloud container starts with
— `git diff master...branch` answers `fatal: no merge base` and the ahead-counts come back in the
hundreds. `ls .git/shallow`, then `git fetch --unshallow origin`, before believing any of it.

