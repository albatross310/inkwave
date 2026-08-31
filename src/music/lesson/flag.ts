// The music lesson layer's feature flag — DEFAULT OFF (the module ships dark).
//
//   ?lesson / ?lesson=1   enable (sticky)
//   ?lesson=off           disable + clear
//
// UNSET ⇒ OFF. SSR/prerender has no localStorage/location → false.
//
// ─── `onParam: 'present'` IS THE ONE NON-DEFAULT, AND IT IS NOT COSMETIC ─────────────────────
// This flag enables on mere PRESENCE, so `?lesson`, `?lesson=1` and even `?lesson=yes` all turn it
// on — while `?musicXml` two directories up requires an exact '1' and ignores a bare param
// entirely. Same URL shape, opposite answers, and until the shared core neither module said so.
// `off` is still checked FIRST, so `?lesson=off` clears rather than enabling; swap that order and
// off becomes on, which is why the core fixes the order in one place instead of nine.
import { stickyFlag } from '../../flags/stickyFlag'

const flag = stickyFlag({
  key: 'inkwave:lesson',
  param: 'lesson',
  defaultOn: false,
  onParam: 'present',
  override: '__iwLesson',
})

/** Whether the lesson layer is available at all. Default OFF. */
export function lessonEnabled(): boolean { return flag.enabled() }

/** Test-only: forget the resolved value so a fresh URL/localStorage state can be read. */
export function resetLessonFlagForTests(): void { flag.reset() }
