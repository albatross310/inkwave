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
