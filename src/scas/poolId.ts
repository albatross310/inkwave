// The pool identity as a FROZEN constant, so modules that only need the id (document defaults,
// bundle metadata) don't drag the 30k-word frequency list + pool derivation into their chunk —
// that import chain (Edit → scas/state → pool → wordFrequency) was 292KB of preloaded JS on the
// shell's critical path. pool.ts asserts at test time that this matches the derived value
// (poolId.test.ts), so a pool change can't silently drift the id.
export const POOL_ID_STATIC = 'inkwave-pool-norvig-v1:4500:dd350482'
