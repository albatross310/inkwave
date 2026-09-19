// Types for jcs.mjs. A sibling .d.mts wins over the `declare module '*.mjs'` wildcard in
// src/mjs-modules.d.ts, so hash.ts can re-export a typed `canonicalize` rather than `any`.

/** RFC 8785 (JCS) canonical serialisation. Throws on non-finite numbers, bigint, and non-JSON types. */
export function canonicalize(value: unknown): string
