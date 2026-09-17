# docs/rules — the rules, split by area

`CLAUDE.md` carries only what EVERY session must obey, plus a routing table. This directory carries
the rules that matter only to a session touching one subsystem. `docs/archive/` carries the
narrative: the measurement rounds, the refuted hypotheses, the incident forensics, the build history.

Three destinations, one test each:

| If a rule is… | it lives in |
| --- | --- |
| something any session could violate (git, the gate, a write path, the channel, Peter's prose) | `CLAUDE.md` |
| something only a session working on that subsystem could violate | `docs/rules/<area>.md` |
| why a rule exists — numbers, incidents, hypotheses that lost | `docs/archive/<area>.md` |

**Read the area file for what you are about to change, and nothing else.** Anything you read enters
your context and is re-sent on every subsequent turn of your session, so reading an area you are not
touching costs Peter tokens on every turn, all day. That cost is the whole reason for this split.

A rule must keep NAMING what it forbids: source scans in this repo strip comments deliberately so a
rule can name a forbidden API without a guard firing on its own documentation. Never paraphrase an
identifier, header or API into a vague gesture.
