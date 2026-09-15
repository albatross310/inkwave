// THE ONE JCS CANONICALISER — RFC 8785 subset, shared by the client and the signing server.
//
// ⚠ ONE COPY, TWO CALLERS. `src/provenance/hash.ts` (the app, /verify, bundles) and
// `api/_provenance-core.mjs` (the Vercel signing functions + the dev middleware) both import THIS
// file. A signature is Ed25519 over this string; a verifier recomputes it. One byte of drift between
// two copies makes every receipt ever signed unverifiable, which is why there are no longer two.
// `jcs.test.ts` pins the exact output from both entry points.
//
// ⚠ FREE OF NODE IMPORTS AND OF TYPES, deliberately: it must load in the browser bundle, in vitest,
// and in Node at Vercel build time with no transform (the reader's `extract.mjs` precedent). Its
// TS shape lives in `jcs.d.mts` beside it.
//
// ⚠ NEVER CHANGE THE OUTPUT. Numbers use the ECMAScript Number→String form, which IS RFC 8785
// §3.2.2.3; keys sort by UTF-16 code unit (§3.2.3); strings escape per JSON (§3.2.2.2). Three
// behaviours outside the RFC are pinned-not-endorsed in the test (sparse holes, non-JSON objects,
// lone surrogates); none can arrive over the wire. A "fix" re-hashes every receipt ever signed.

/**
 * RFC 8785 (JCS) canonical serialisation of a JSON value.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalize(value) {
  if (value === null) return 'null'
  const t = typeof value
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new Error('JCS: non-finite number')
    return JSON.stringify(value) // ECMAScript Number→String = JCS §3.2.2.3
  }
  if (t === 'boolean' || t === 'string') return JSON.stringify(value)
  if (t === 'bigint') throw new Error('JCS: bigint not supported')
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalize(v === undefined ? null : v)).join(',') + ']'
  }
  if (t === 'object') {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined) // JSON/JCS omit undefined members
      .sort() // default sort = UTF-16 code-unit order, which JCS specifies
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}'
  }
  throw new Error(`JCS: unsupported type ${t}`)
}
