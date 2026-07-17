// §A5b — the writer's goal, rough plan, and TIMELINE. PURE.
//
// ─── WHERE GOALS LIVE, AND WHY THERE IS NO STORAGE IN THIS FILE ──────────────────────────────
// Goals are a DOCUMENT property (`types/document.ts` DocGoals), declared once by the report lane.
// An earlier cut of this module kept its own `inkwave-goals.json` — which meant the UI wrote goals
// the report's seam (which reads `doc.goals`) could never see: a feature that looks finished and is
// structurally incapable of working. Two stores for one question, the disease this codebase keeps
// getting burned by. So this file computes; the DOCUMENT stores, through the editor's own autosave,
// which is also what makes it race-free (one writer, not two).
//
// ─── WHY THIS IS LEGITIMATE, AND THE LINE IT MUST NOT CROSS ──────────────────────────────────
// §A5b: **guilt is a standard imposed on the writer; accountability is a goal the writer set.**
// Everything here is the writer's own words about their own intent — which is what licenses the
// report's wry tone about a missed date: HE wrote the date. It does not license grading the writing,
// and nothing here reads the prose.
//
// ─── §A6.4 APPLIES TO GOALS ──────────────────────────────────────────────────────────────────
// Whether a dated milestone was MET is a MEASURED fact: a comparison of two dates the writer
// supplied. It is computed HERE, deterministically, and shipped as a verdict — never as two dates
// for the model to compare. LLMs silently tidy numbers, and "did I hit my deadline" is exactly the
// claim that must not be re-derived by a narrator.

import { v4 as uuidv4 } from 'uuid'
import type { DocGoals, DocMilestone } from '../types/document'
import { cleanText, localDayOf } from './sessionLogic'

export type GoalStatus = 'met' | 'met-late' | 'missed' | 'due-today' | 'upcoming' | 'undated'

/** Whole days from `from` to `to` (both 'YYYY-MM-DD'). Negative = `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/**
 * The verdict on one milestone, as of `todayLocal`. Pure, measured, deterministic.
 *
 * `met-late` is deliberate and is NOT `met`: done, but after the date the writer set. Collapsing
 * them would hide the only thing a tracking report has to be honest about — while a separate
 * `missed` (still undone) keeps "late but finished" from reading as failure.
 */
export function milestoneStatus(m: DocMilestone, todayLocal: string): { status: GoalStatus; days_remaining?: number } {
  const done = !!m.done_at
  if (!m.due) return { status: done ? 'met' : 'undated' }

  const days = daysBetween(todayLocal, m.due)
  if (done) {
    // The writer's LOCAL day, not the UTC one: done at 08:00 on the 21st in Brisbane is 22:00 on the
    // 20th UTC, and judging by UTC would call a late finish on-time.
    return { status: localDayOf(m.done_at!) <= m.due ? 'met' : 'met-late', days_remaining: days }
  }
  if (days < 0) return { status: 'missed', days_remaining: days }
  if (days === 0) return { status: 'due-today', days_remaining: 0 }
  return { status: 'upcoming', days_remaining: days }
}

/** True when the writer has actually said something. `undefined` and "all blank" are both nothing. */
export function hasGoals(g: DocGoals | undefined): boolean {
  if (!g) return false
  return !!cleanText(g.goal) || !!cleanText(g.plan) || (g.milestones ?? []).some((m) => cleanText(m.text))
}

// ─── Pure mutators — the UI hands the result to the editor's autosave ────────

const stamp = (g: DocGoals, nowIso: string): DocGoals => ({ ...g, updatedAt: nowIso })

export function setGoal(g: DocGoals | undefined, goal: string, nowIso: string): DocGoals {
  return stamp({ ...(g ?? {}), goal: cleanText(goal, 500) }, nowIso)
}

export function setPlan(g: DocGoals | undefined, plan: string, nowIso: string): DocGoals {
  return stamp({ ...(g ?? {}), plan: cleanText(plan, 2000) }, nowIso)
}

export function addMilestone(g: DocGoals | undefined, text: string, due: string | undefined, nowIso: string): DocGoals {
  const clean = cleanText(text, 300)
  if (!clean) return g ?? {}
  const m: DocMilestone = { id: uuidv4(), text: clean, ...(due ? { due } : {}) }
  return stamp({ ...(g ?? {}), milestones: [...((g ?? {}).milestones ?? []), m] }, nowIso)
}

export function updateMilestone(
  g: DocGoals | undefined, id: string, patch: { text?: string; due?: string }, nowIso: string,
): DocGoals {
  return stamp({
    ...(g ?? {}),
    milestones: ((g ?? {}).milestones ?? []).map((m) => {
      if (m.id !== id) return m
      const next: DocMilestone = { ...m }
      if (patch.text !== undefined) next.text = cleanText(patch.text, 300) ?? m.text
      // An empty due CLEARS the date (they removed their deadline) — omit it, never store ''.
      if (patch.due !== undefined) { if (patch.due) next.due = patch.due; else delete next.due }
      return next
    }),
  }, nowIso)
}

/** Tick off / un-tick. Records WHEN, because that is what `met` vs `met-late` reads. */
export function toggleMilestone(g: DocGoals | undefined, id: string, nowIso: string): DocGoals {
  return stamp({
    ...(g ?? {}),
    milestones: ((g ?? {}).milestones ?? []).map((m) => {
      if (m.id !== id) return m
      const next: DocMilestone = { ...m }
      if (next.done_at) delete next.done_at
      else next.done_at = nowIso
      return next
    }),
  }, nowIso)
}

export function removeMilestone(g: DocGoals | undefined, id: string, nowIso: string): DocGoals {
  return stamp({ ...(g ?? {}), milestones: ((g ?? {}).milestones ?? []).filter((m) => m.id !== id) }, nowIso)
}
