# docs/archive — the WHY, moved out of the code

Source files in `src/` carry **rules** as short imperative comments with a pointer here. This
directory carries the **reasoning**: the incident, the measurement, the hypothesis that was refuted.

The split exists for the reader that matters most now — a future session, human or AI, that has to
hold a file in view to change it safely. A rule it can act on in one line; a story it has to read
and then discard. Both are kept; only one lives beside the code.

**Convention.** A source comment says *what must stay true* and ends with `→ docs/archive/<file>.md#<anchor>`.
The archive entry says *why*, with the numbers. If you delete the rule, the bug comes back — six of
this project's data-loss incidents were re-introductions of a rule whose reason had been filed away.
If you delete the story, nothing breaks today; someone re-measures it in six months.

One file per area. Lanes write their own file and never a shared one.
